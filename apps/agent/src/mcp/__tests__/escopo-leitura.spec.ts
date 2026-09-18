import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * O servidor MCP não tinha noção de escopo: as 21 ferramentas dividiam a mesma superfície
 * e o mesmo token. Qualquer consumidor novo — um agente conversacional, por exemplo —
 * recebia junto as 11 de escrita.
 *
 * O filtro `include`/`exclude` do lado do cliente (que o Hermes suporta) ajuda contra o
 * modelo chamar o que não deve, mas **não é fronteira**: quem tem o token alcança tudo
 * por fora do cliente. Fronteira exige o servidor recusar.
 *
 * O teste lê o `.mjs` como texto porque o arquivo é ESM executado direto pelo Node, sem
 * build — mesmo recurso de `repo-slug.spec.ts` e `hook-signal-quality.spec.ts`.
 */
const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')

/** Os nomes declarados em `FERRAMENTAS_DE_LEITURA`. */
const leitura = (() => {
  const bloco = FONTE.match(/const FERRAMENTAS_DE_LEITURA = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  return [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1])
})()

/** Todos os nomes declarados em `TOOLS`. */
const todas = (() => {
  const bloco = FONTE.slice(FONTE.indexOf('const TOOLS = ['))
  return [...bloco.matchAll(/name:\s*'(rayzen_[a-z_]+)'/g)].map((m) => m[1])
})()

describe('MCP — escopo de leitura', () => {
  it('a lista de leitura não está vazia e as ferramentas foram encontradas', () => {
    expect(leitura.length).toBeGreaterThan(5)
    expect(todas.length).toBeGreaterThan(15)
  })

  it.each(['rayzen_get_context', 'rayzen_search_memory', 'rayzen_get_state', 'rayzen_list_projects'])(
    '%s está no escopo de leitura',
    (nome) => expect(leitura).toContain(nome),
  )

  it.each([
    'rayzen_add_event',
    'rayzen_checkpoint',
    'rayzen_update_planning',
    'rayzen_create_project',
    'rayzen_blueprint_import',
  ])('%s NÃO está no escopo de leitura', (nome) => expect(leitura).not.toContain(nome))

  /**
   * Este é o teste que sustenta o desenho. A lista é de PERMISSÃO e o padrão é negar:
   * ferramenta nova nasce fora dela, indisponível para leitura, até alguém decidir
   * incluí-la.
   *
   * Se fosse lista de negação, toda ferramenta futura entraria no escopo de leitura por
   * omissão — que é exatamente como escopo vaza, sem ninguém perceber.
   */
  it('toda ferramenta de leitura existe em TOOLS — nome errado aqui vira permissão morta', () => {
    const inexistentes = leitura.filter((n) => !todas.includes(n))
    expect(inexistentes).toEqual([])
  })

  it('a maioria das ferramentas fica FORA da leitura — o padrão é negar', () => {
    expect(leitura.length).toBeLessThan(todas.length / 2)
  })
})

describe('MCP — a fronteira é dos DOIS lados', () => {
  /**
   * Filtrar a listagem faz o cliente nem saber que existe escrita: ele não tenta, não
   * erra, não pergunta. É a metade cooperativa.
   */
  it('a listagem devolve só as de leitura quando o token é de leitura', () => {
    expect(FONTE).toMatch(/ehSomenteLeitura\(escopo\)\s*\?\s*TOOLS\.filter\(\(t\) => FERRAMENTAS_DE_LEITURA\.has\(t\.name\)\)/)
  })

  /**
   * E recusar na chamada é a metade que vale contra quem não coopera: cliente com a lista
   * antiga em cache, cliente que ignora a listagem, ou chamada direta por HTTP. Só o
   * filtro da listagem seria acordo de cavalheiros.
   */
  it('a CHAMADA também recusa — não basta esconder da lista', () => {
    // Ancorado em `setRequestHandler`, não no nome do schema: ele aparece antes no
    // `import`, e a primeira versão deste teste casou com o import.
    const bloco = FONTE.match(/setRequestHandler\(CallToolRequestSchema[\s\S]{0,900}/)?.[0] ?? ''
    expect(bloco).toMatch(/ehSomenteLeitura\(escopo\) && !FERRAMENTAS_DE_LEITURA\.has\(name\)/)
    expect(bloco).toMatch(/isError: true/)
  })

  it('o escopo chega ao servidor a partir da autenticação, não de um default', () => {
    expect(FONTE).toMatch(/const escopo = checkAuth\(req, res\)/)
    expect(FONTE).toMatch(/createMcpServer\(escopo\)/)
  })
})

describe('MCP — compatibilidade dos tokens já emitidos', () => {
  /**
   * Os tokens persistidos foram gravados como número puro (`token → expiresAt`).
   * Invalidá-los na mudança de formato desconectaria os clientes conectados por um
   * detalhe interno — castigo sem crime.
   */
  it('token no formato antigo continua valendo, com escopo total', () => {
    expect(FONTE).toMatch(/typeof registro === 'number' \? ESCOPO_TOTAL/)
  })

  /**
   * A poda de expirados comparava `v < now` com `v` sendo agora um objeto — sempre falso.
   * Token expirado nunca seria removido e o arquivo cresceria para sempre. Bug
   * introduzido e corrigido na mesma mudança.
   */
  it('a poda de expirados entende as duas formas', () => {
    const bloco = FONTE.match(/function loadPersistedTokens\(\)[\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).toMatch(/typeof v === 'number' \? v : v\?\.exp/)
    expect(bloco).not.toMatch(/if \(v < now\)/)
  })
})
