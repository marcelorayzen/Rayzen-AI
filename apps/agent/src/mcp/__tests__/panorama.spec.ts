import { readFileSync } from 'fs'
import { join } from 'path'

/** `rayzen_project_overview` (17/11): uma ida em vez de 5–6, sem inchar o contexto e sem inventar. */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { montarPanorama, CORTE, MAX_ARQUIVOS_NA_ARVORE } = require('../panorama.js') as {
  montarPanorama: (p: Record<string, unknown>) => Record<string, Record<string, unknown>>
  CORTE: { readme: number }
  MAX_ARQUIVOS_NA_ARVORE: number
}

const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')
const HERMES = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'infra', 'hermes', 'config.yaml'), 'utf8')
const okP = (v: unknown) => ({ ok: true, v })

describe('montarPanorama', () => {
  const base = {
    estado: okP({ objective: 'Editor de marcenaria', stage: 'building', nextSteps: ['x'], segredo: 'nao-vaza' }),
    lista: okP({ total: 3, fonte: 'servidor', arquivos: [{ path: 'README.md' }, { path: 'src/a.ts' }, { path: 'src/b.ts' }] }),
    readme: okP({ existe: true, conteudo: '# Projeto' }),
    pkg: okP({ existe: true, conteudo: JSON.stringify({ name: 'm', scripts: { test: 'vitest run' }, dependencies: { react: '1' }, engines: { node: '>=22' } }) }),
    agents: okP({ existe: false }),
    estadoDoc: { ok: false, erro: 'agent offline' },
  }

  it('junta tudo numa resposta: estado, árvore por pasta, scripts e textos', () => {
    const r = montarPanorama(base)
    expect(r.estado).toEqual({ objective: 'Editor de marcenaria', stage: 'building', nextSteps: ['x'], blockers: undefined, activeFocus: undefined })
    expect(r.arvore).toMatchObject({ total: 3, porPasta: { '.': 1, src: 2 }, fonte: 'servidor' })
    expect(r.packageJson).toMatchObject({ scripts: { test: 'vitest run' }, dependencies: ['react'], engines: { node: '>=22' } })
    expect(r.readme).toEqual({ conteudo: '# Projeto' })
  })

  it('arquivo ausente é dito como ausente; parte que falhou é dita como falha — nunca confundidas', () => {
    const r = montarPanorama(base)
    expect(r.agentsMd).toEqual({ existe: false })
    expect(r.estadoDoProjetoMd).toEqual({ erro: 'agent offline' })
  })

  it('corta textos longos e diz que cortou', () => {
    const longo = 'a'.repeat(CORTE.readme + 500)
    const r = montarPanorama({ ...base, readme: okP({ existe: true, conteudo: longo, bytes: longo.length }) })
    expect((r.readme.conteudo as string).length).toBe(CORTE.readme)
    expect(r.readme.truncado).toBe(true)
  })

  it('a árvore tem teto e avisa quando passa dele', () => {
    const muitos = Array.from({ length: MAX_ARQUIVOS_NA_ARVORE + 10 }, (_, i) => ({ path: `src/f${i}.ts` }))
    const r = montarPanorama({ ...base, lista: okP({ arquivos: muitos }) })
    expect((r.arvore.arquivos as string[]).length).toBe(MAX_ARQUIVOS_NA_ARVORE)
    expect(r.arvore.truncado).toBe(true)
  })

  it('segredo recusado pela leitura continua recusado no panorama', () => {
    const r = montarPanorama({ ...base, readme: okP({ path: 'README.md', recusado: 'segredo' }) })
    expect(r.readme).toEqual({ recusado: 'segredo' })
  })

  it('package.json inválido não derruba o panorama', () => {
    const r = montarPanorama({ ...base, pkg: okP({ existe: true, conteudo: '{ quebrado' }) })
    expect(r.packageJson).toEqual({ erro: 'package.json não é JSON válido' })
  })
})

describe('rayzen_project_overview no servidor MCP', () => {
  it('declarada, no escopo de LEITURA e liberada ao Hermes', () => {
    expect(FONTE).toContain("name: 'rayzen_project_overview'")
    const leitura = FONTE.slice(FONTE.indexOf('const FERRAMENTAS_DE_LEITURA'), FONTE.indexOf('const FERRAMENTAS_DE_PROPOSTA'))
    expect(leitura).toContain("'rayzen_project_overview'")
    expect(HERMES).toMatch(/-\s+rayzen_project_overview\b/)
  })
  it('exige projectId e só lê (GET), em paralelo', () => {
    const caso = FONTE.slice(FONTE.indexOf("case 'rayzen_project_overview'"), FONTE.indexOf("case 'rayzen_list_files'"))
    expect(caso).toContain('requireProjectId(args)')
    expect(caso).toContain('Promise.all(')
    expect(caso).not.toMatch(/api\('(POST|PUT|PATCH|DELETE)'/)
  })
})
