import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Um diretório vira `repoSlug` em UM lugar só: `apps/agent/src/repo-slug.mjs`.
 *
 * Os três pontos de entrada `.mjs` do agent resolviam por conta própria, com o
 * mesmo código copiado. O comentário do MCP já dizia por que precisam concordar:
 * "senão hook e MCP resolvem projetos diferentes no mesmo diretório" — mas
 * concordavam por disciplina, que é como `whitelist.ts` e `MODE_CLASS_BOOST`
 * divergiram antes.
 *
 * O defeito que motivou: `jarvis:create_project_folder` cria a pasta com o nome
 * cru e registra o projeto com o slug em kebab-case. Sem git remote o fallback é
 * o nome da pasta, que nunca casa. Medido em 2026-08-16: dois projetos criados
 * por essa ação, nenhuma das quatro grafias resolvendo contra a API.
 *
 * O teste roda o módulo em Node de verdade (é ESM, e o jest daqui é CJS) em vez
 * de asserir sobre texto — o que importa é a ORDEM dos candidatos.
 */
const RAIZ = join(__dirname, '..')

function avaliar(expressao: string): string {
  const modulo = join(RAIZ, 'repo-slug.mjs').replace(/\\/g, '/')
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import { paraSlug, candidatosDeSlug } from 'file:///${modulo}'
       console.log(JSON.stringify(${expressao}))`],
    { encoding: 'utf8', timeout: 15000 },
  ).trim()
}

/**
 * O `PostToolUse` dispara em TODA ferramenta, e cada disparo gastava até dois `execSync`
 * de git antes de consultar qualquer cache.
 *
 * Medido em 2026-09-06: **1739 ms** na primeira resolução, contra o timeout de 2000 ms
 * do módulo — **87% do orçamento consumido com a máquina ociosa**. Qualquer carga
 * estoura, e foi assim que o hook falhou duas vezes nesta sessão com slug `"?"`. Slug
 * vazio não é só um aviso feio: é **evento nascendo órfão**, invisível a qualquer
 * consulta com escopo de projeto.
 *
 * Com cache: 3–5 ms.
 */
describe('repo-slug — cache do nome do repositório', () => {
  const CACHE = join(tmpdir(), 'rayzen-repo-name-cache.json')
  // Chave distinta da raiz do repo: a raiz é a que o hook desta máquina usa de verdade,
  // e plantar valor falso nela quebraria a resolução real até a TTL vencer.
  const SUBPASTA = join(RAIZ, '..').replace(/\\/g, '/')
  let backup: string | null = null

  const nomeCom = (cwd: string): string => {
    const modulo = join(RAIZ, 'repo-slug.mjs').replace(/\\/g, '/')
    return JSON.parse(execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `import { nomeDoRepositorio } from 'file:///${modulo}'
         console.log(JSON.stringify(nomeDoRepositorio(${JSON.stringify(cwd)})))`],
      { encoding: 'utf8', timeout: 15000 },
    ).trim())
  }

  beforeAll(() => { try { backup = readFileSync(CACHE, 'utf8') } catch { backup = null } })
  afterAll(() => {
    if (backup === null) { try { unlinkSync(CACHE) } catch { /* nunca existiu */ } }
    else writeFileSync(CACHE, backup, 'utf8')
  })

  it('entrada fresca é servida sem consultar o git', () => {
    // Se o git fosse consultado, viria o remote real — não este nome inventado.
    writeFileSync(CACHE, JSON.stringify({ [SUBPASTA]: { nome: 'NOME-DO-CACHE', ts: Date.now() } }), 'utf8')
    expect(nomeCom(SUBPASTA)).toBe('NOME-DO-CACHE')
  })

  /**
   * O caso que motivou tudo: git lento (não repositório mudado). Servir o valor vencido
   * é estritamente melhor que devolver nada — nome levemente velho ainda resolve o
   * projeto; ausência de nome gera órfão.
   */
  it('quando o git falha, a entrada VENCIDA ainda é servida', () => {
    const inexistente = '/caminho/que/nao/existe/em/lugar/nenhum'
    const doisDias = Date.now() - 2 * 24 * 60 * 60 * 1000
    writeFileSync(CACHE, JSON.stringify({ [inexistente]: { nome: 'NOME-VENCIDO', ts: doisDias } }), 'utf8')
    expect(nomeCom(inexistente)).toBe('NOME-VENCIDO')
  })

  it('sem cache e sem git, devolve null — não inventa nome', () => {
    writeFileSync(CACHE, JSON.stringify({}), 'utf8')
    expect(nomeCom('/outro/caminho/inexistente')).toBeNull()
  })

  it('cache corrompido não derruba a resolução', () => {
    writeFileSync(CACHE, '{ isto não é json', 'utf8')
    expect(nomeCom(RAIZ.replace(/\\/g, '/'))).toBeTruthy()
  })
})

describe('repo-slug — fonte única da resolução de projeto', () => {
  describe('ordem dos candidatos', () => {
    it('nome com espaço gera duas grafias, a crua primeiro', () => {
      expect(JSON.parse(avaliar(`['Lista da Mahh', paraSlug('Lista da Mahh')]`)))
        .toEqual(['Lista da Mahh', 'lista-da-mahh'])
    })

    it('preserva maiúsculas do Rayzen-PDV tentando o cru antes do kebab', () => {
      // O `repoSlug` registrado do Rayzen-PDV é literalmente `Rayzen-PDV`.
      // Slugificar sempre viraria `rayzen-pdv` e quebraria um projeto que
      // funciona hoje para consertar dois que nem existiam.
      expect(JSON.parse(avaliar(`paraSlug('Rayzen-PDV')`))).toBe('rayzen-pdv')
    })

    it('nome que já é slug não vira dois candidatos', () => {
      expect(JSON.parse(avaliar(`paraSlug('banco-imob') === 'banco-imob'`))).toBe(true)
    })
  })

  describe('anti-drift entre os três pontos de entrada', () => {
    const ENTRADAS = [
      'hooks/rayzen-hook.mjs',
      'hooks/rayzen-context-hook.mjs',
      'mcp/rayzen-mcp.mjs',
    ]

    it.each(ENTRADAS)('%s importa a resolução em vez de reimplementar', (arquivo) => {
      const fonte = readFileSync(join(RAIZ, arquivo), 'utf8')

      expect(fonte).toMatch(/import \{[^}]*candidatosDeSlug[^}]*\} from '\.\.\/repo-slug\.mjs'/)
      // `remote get-url origin` só pode aparecer no módulo compartilhado.
      expect(fonte).not.toContain('remote get-url origin')
    })
  })
})
