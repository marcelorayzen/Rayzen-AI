import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * Item 7.5 — o Hermes não cai no projeto padrão numa leitura.
 *
 * `projeto-padrao.mjs` é ESM e este spec é CommonJS: roda o módulo REAL num subprocesso (mesma
 * técnica do anti-drift de `repo-slug.mjs`), em vez de testar uma cópia. E lê o
 * `rayzen-mcp-http.mjs` como texto para confirmar que a regra está LIGADA no handler — importá-lo
 * abriria um servidor de verdade.
 */
const MODULO = join(__dirname, '..', 'projeto-padrao.mjs')
const SERVIDOR = join(__dirname, '..', 'rayzen-mcp-http.mjs')

function avaliar(casos: Array<[string | null, string, Record<string, unknown>]>): Array<string | null> {
  const script =
    `import(${JSON.stringify(pathToFileURL(MODULO).href)}).then((m) => {` +
    `const casos = JSON.parse(process.argv[1]);` +
    `process.stdout.write(JSON.stringify(casos.map(([c, f, a]) => m.recusaPorFaltaDeProjeto(c, f, a))))})`
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(casos)], { encoding: 'utf8' })
  return JSON.parse(saida)
}

describe('recusaPorFaltaDeProjeto — o módulo real', () => {
  it('hermes sem projectId numa leitura com padrão: recusa, apontando o projeto do fio', () => {
    const [r] = avaliar([['hermes', 'rayzen_get_state', {}]])
    expect(r).toMatch(/projectId obrigatório/)
    expect(r).toMatch(/projectId do fio/)
  })

  it.each([
    'rayzen_get_state', 'rayzen_get_resume', 'rayzen_get_events', 'rayzen_search_memory',
    'rayzen_get_goal', 'rayzen_get_context', 'rayzen_list_specialists',
  ])('cobre %s', (ferramenta) => {
    expect(avaliar([['hermes', ferramenta, { projectId: '  ' }]])[0]).not.toBeNull()
  })

  it('não muda nada para quem não está na lista, nem para projectId explícito, nem para list_projects', () => {
    expect(avaliar([
      ['hermes', 'rayzen_get_state', { projectId: 'p1' }],
      ['rayzen_ai', 'rayzen_get_state', {}],
      ['compartilhado', 'rayzen_get_context', {}],
      [null, 'rayzen_get_state', {}],
      ['hermes', 'rayzen_list_projects', {}],
    ])).toEqual([null, null, null, null, null])
  })
})

describe('rayzen-mcp-http.mjs — a regra está ligada no handler', () => {
  const fonte = readFileSync(SERVIDOR, 'utf8')

  it('importa a regra e a aplica antes do despacho da ferramenta', () => {
    expect(fonte).toMatch(/import \{ recusaPorFaltaDeProjeto \} from '\.\/projeto-padrao\.mjs'/)
    const handler = fonte.indexOf('setRequestHandler(CallToolRequestSchema')
    const regra = fonte.indexOf('recusaPorFaltaDeProjeto(consumidor, name, args)')
    const despacho = fonte.indexOf("case 'rayzen_get_state'")
    expect(handler).toBeGreaterThan(-1)
    expect(regra).toBeGreaterThan(handler)
    expect(despacho).toBeGreaterThan(regra)
  })

  it('o servidor por sessão recebe o consumidor autenticado', () => {
    expect(fonte).toMatch(/createMcpServer\(auth\.escopo, auth\.consumidor\)/)
  })
})
