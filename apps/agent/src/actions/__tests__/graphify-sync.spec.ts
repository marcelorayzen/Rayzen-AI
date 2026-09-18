import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { extractFileLineage, detectRoute, GraphifyGraph, graphifySync } from '../graphify-sync'

/**
 * Achado colateral da varredura de 2026-09-12: o arquivo tinha um BYTE NULO literal (`\x00`)
 * substituindo o espaço em `` `${from} ${to}` `` (a chave de dedup de `extractFileLineage`) —
 * já estava assim no commit anterior, não era algo que quebrasse o TypeScript (o `key` some no
 * `Set`, funcionava por acidente), mas `git diff`/`file` passaram a tratar o arquivo inteiro
 * como binário por causa de UM byte. Corrigido para espaço normal; este teste impede a volta.
 */
it('não tem byte nulo em lugar nenhum do arquivo-fonte', () => {
  const fonte = readFileSync(join(__dirname, '..', 'graphify-sync.ts'))
  expect(fonte.includes(0)).toBe(false)
})

/**
 * Achado real: graph.edges.length era usado pra contar arestas, mas o graph.json
 * de verdade usa a chave "links", não "edges" — graph.edges era undefined e
 * jogava TypeError toda vez que jarvis:graphify_sync rodava (nunca funcionou).
 * extractFileLineage() é a parte nova: lê graph.links com relation 'imports_from'
 * e monta o lineage real de arquivo, porque é o único lugar com acesso ao
 * graphify-out/graph.json local (gitignored, nunca chega no servidor).
 */
describe('extractFileLineage', () => {
  function buildGraph(): GraphifyGraph {
    return {
      nodes: [
        { id: 'a', label: 'a.ts', source_file: 'apps\\api\\src\\modules\\qa\\a.ts' },
        { id: 'b', label: 'b.ts', source_file: 'apps\\api\\src\\modules\\qa\\b.ts' },
        { id: 'pkg', label: 'lodash', source_file: undefined },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'imports_from' },
        { source: 'a', target: 'pkg', relation: 'imports_from' }, // externo, sem source_file no target
        { source: 'a', target: 'b', relation: 'calls' }, // relation errada, deve ser ignorada
      ],
    }
  }

  it('extrai um edge from->to só para imports_from resolvidos internamente', () => {
    const result = extractFileLineage(buildGraph(), 'C:/repo')

    expect(result.edges).toEqual([
      { from: 'apps/api/src/modules/qa/a.ts', to: 'apps/api/src/modules/qa/b.ts' },
    ])
  })

  it('lista um file entry por source_file único (independente de quantos nodes apontam pra ele)', () => {
    const result = extractFileLineage(buildGraph(), 'C:/repo')

    const paths = result.files.map(f => f.path)
    expect(paths).toContain('apps/api/src/modules/qa/a.ts')
    expect(paths).toContain('apps/api/src/modules/qa/b.ts')
    expect(paths).not.toContain(undefined)
  })

  it('ignora imports_from para target sem source_file (pacote externo)', () => {
    const graph = buildGraph()
    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.some(e => e.to === 'lodash')).toBe(false)
  })

  it('deduplica edges repetidos entre o mesmo par de arquivos', () => {
    const graph = buildGraph()
    graph.links.push({ source: 'a', target: 'b', relation: 'imports_from' })

    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.filter(e => e.from === 'apps/api/src/modules/qa/a.ts' && e.to === 'apps/api/src/modules/qa/b.ts')).toHaveLength(1)
  })

  it('descarta self-loop (arquivo que "importa de si mesmo" por ruído de extração)', () => {
    const graph = buildGraph()
    graph.links.push({ source: 'a', target: 'a', relation: 'imports_from' })

    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.some(e => e.from === e.to)).toBe(false)
  })
})

describe('detectRoute', () => {
  it('marca isRoute:false para arquivo que não termina em .controller.ts', () => {
    expect(detectRoute('C:/repo', 'apps/api/src/modules/qa/qa.service.ts')).toEqual({ isRoute: false })
  })

  it('marca isRoute:true (sem prefix) quando o arquivo .controller.ts não existe em disco', () => {
    const result = detectRoute('C:/repo-inexistente', 'apps/api/src/modules/qa/qa.controller.ts')
    expect(result.isRoute).toBe(true)
  })
})

/**
 * Achado da varredura de 2026-09-12 — `graphifySync()` era o único ponto de exec que sobrava
 * fora da Fase 1 (`execSync` cru, `shell:true` por omissão) e nunca checava `cwd` contra
 * safe-root. Migrado para `executarPrograma` (`shell:false`, argv como vetor) com a mesma
 * checagem que `list-dir.ts` usa. Os dois comandos aqui são literais fixos (nunca havia
 * interpolação de valor externo na string) — o achado real era o `cwd` livre, não injeção de
 * comando.
 */
describe('graphifySync — migrado para executarPrograma, com safe-root', () => {
  it('recusa cwd fora de safe root, antes de tentar rodar git', async () => {
    const r = await graphifySync({ cwd: 'C:\\Windows\\System32' })
    expect(r).toMatch(/caminho não permitido/i)
  })

  it('diretório dentro de safe root mas fora de um repositório git', async () => {
    const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
    // No runner do CI (Linux, $HOME=/home/runner) esta pasta não existe por padrão.
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, 'rayzen-graphify-sync-teste-'))
    try {
      const r = await graphifySync({ cwd: dir })
      expect(r).toBe('Erro: não está em um repositório git')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('acha a raiz de um repositório git real via executarPrograma (git rev-parse funciona)', async () => {
    const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, 'rayzen-graphify-sync-repo-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      // Sem graphify instalado nesta máquina (confirmado na varredura) e sem graph.json —
      // a chamada real a `git rev-parse --show-toplevel` já aconteceu antes desse ponto, e é
      // isso que este teste prova: a migração não quebrou a detecção de repositório.
      const r = await graphifySync({ cwd: dir })
      expect(r).toMatch(/graph\.json não encontrado/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
