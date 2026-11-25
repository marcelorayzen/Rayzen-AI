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

  // Era `< metade`. Em 12/11 (item 3) entraram rayzen_list_files/rayzen_read_file — leitura de
  // verdade, adicionadas de propósito à lista explícita — e o placar ficou 11 × 11. O que protege
  // "o padrão é negar" é a lista EXPLÍCITA (ferramenta nova nasce fora); a proporção é proxy. Ela
  // continua barrando o deslize de leitura virar maioria; passar disto exige decidir de novo aqui.
  it('a leitura nunca é maioria — o padrão é negar', () => {
    expect(leitura.length).toBeLessThanOrEqual(todas.length / 2)
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
    expect(FONTE).toMatch(/const auth = checkAuth\(req, res\)/)
    // Desde 12/11 (item 7.5) o consumidor também vai junto — e também vem de `auth`, nunca de um
    // default. O primeiro argumento continua sendo exatamente o escopo autenticado.
    expect(FONTE).toMatch(/createMcpServer\(auth\.escopo(, auth\.consumidor)?\)/)
  })
})

/**
 * Item 7.6c (12/11): o escopo `proposta` = leitura + PROPOR projeto. O Hub está na internet;
 * o efeito máximo que ele alcança tem de ser um envelope aguardando aprovação humana.
 */
describe('MCP — escopo de proposta', () => {
  const proposta = (() => {
    const bloco = FONTE.match(/const FERRAMENTAS_DE_PROPOSTA = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    return [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1])
  })()

  it('acrescenta só ferramentas de PROPOR à leitura, e elas existem', () => {
    expect(proposta).toEqual(['rayzen_propose_project', 'rayzen_propose_session', 'rayzen_propose_routine', 'rayzen_propose_memory', 'rayzen_propose_knowledge'])
    for (const nome of proposta) {
      expect(todas).toContain(nome)
      expect(leitura).not.toContain(nome)
    }
  })

  // 13/11: a primeira "mão" do Hub em projeto existente. Mesma fronteira: envelope e só.
  it('propor sessão só cria e submete — nunca aprova nem materializa; efeito, raiz e publicação fixos', () => {
    const caso = FONTE.match(/case 'rayzen_propose_session': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).not.toBe('')
    const chamadas = [...caso.matchAll(/api\('(\w+)', [`'](\/[^`']*)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(chamadas).toEqual(['POST /handoffs', 'POST /handoffs/${envelope.id}/submit'])
    expect(caso).not.toMatch(/approve|materialize/)
    expect(caso).toMatch(/actionKey: 'jarvis:supervised_session'/)
    expect(caso).toMatch(/root: RAIZ_DE_PROPOSTA/)
    // O modelo não escolhe se publica: o agent para no diff final antes de qualquer PR.
    expect(caso).toMatch(/publicar: true, aprovacao \}/)
    expect(caso).toMatch(/alvo === PROJETO_GERAL_ID/)
    expect(caso).toMatch(/requireProjectId\(args\)/)
  })

  // G6.4 (21/11): rotina proposta pelo Hub. Efeito máximo: um registro que só pessoa ativa.
  it('propor rotina só CRIA a rotina — nunca aprova, retoma nem dispara; gatilho montado campo a campo', () => {
    const caso = FONTE.match(/case 'rayzen_propose_routine': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).not.toBe('')
    const chamadas = [...caso.matchAll(/api\('(\w+)', [`'](\/[^`']*)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(chamadas).toEqual(['POST /rotinas'])
    expect(caso).not.toMatch(/['`]\/rotinas\/[^'`]*\/(aprovar|retomar|testar)|['`]\/handoffs/)
    expect(caso).toMatch(/\{ tipo: 'agenda', intervaloMin: args\.intervaloMin \}/)
    expect(caso).toMatch(/\{ tipo: 'github', evento: args\.evento \}/)
    expect(caso).not.toMatch(/gatilho: args\.gatilho\b(?!\s*===)/)
    expect(caso).toMatch(/alvo === PROJETO_GERAL_ID/)
    expect(caso).toMatch(/requireProjectId\(args\)/)
  })

  // HC4b (22/11): o caderno (gaveta 2) — só cria proposta candidata na V2; aprovar é do dono.
  it('propor conhecimento só cria a proposta na V2 — nunca aprova; mudar é a mesma chave, retirar é revogação', () => {
    const caso = FONTE.match(/case 'rayzen_propose_knowledge': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).not.toBe('')
    const chamadas = [...caso.matchAll(/api(?:V2)?\('(\w+)', [`'](\/[^`']*)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(chamadas).toEqual(['POST /v2/memory/knowledge/proposals'])
    expect(caso).not.toMatch(/\/approve|\/reject/)
    expect(caso).toMatch(/logicalKey: chave/)
    expect(caso).toMatch(/REVOGADO:/)
    expect(caso).toMatch(/requireProjectId\(args\)/)
    expect(FONTE).toMatch(/import \{[^}]*\bcreateHash\b[^}]*\} from 'node:crypto'/)
  })

  // HC4b (22/11): mexer na memória também é proposta — só cria o cartão; aprovar é de pessoa.
  it('propor memória só cria a proposta — nunca aprova, guarda nem apaga documento', () => {
    const caso = FONTE.match(/case 'rayzen_propose_memory': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).not.toBe('')
    const chamadas = [...caso.matchAll(/api\('(\w+)', [`'](\/[^`']*)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(chamadas).toEqual(['POST /hub/memoria/propostas'])
    expect(caso).not.toMatch(/\/aprovar|\/rejeitar|\/memory\/documents|DELETE/)
    expect(caso).toMatch(/requireProjectId\(args\)/)
  })

  it('a listagem e a CHAMADA recusam fora de leitura ∪ proposta — os dois lados', () => {
    expect(FONTE).toMatch(/ehProposta\(escopo\) \? TOOLS\.filter\(\(t\) => FERRAMENTAS_DE_LEITURA\.has\(t\.name\) \|\| FERRAMENTAS_DE_PROPOSTA\.has\(t\.name\)\)/)
    const bloco = FONTE.match(/setRequestHandler\(CallToolRequestSchema[\s\S]{0,1400}/)?.[0] ?? ''
    expect(bloco).toMatch(/ehProposta\(escopo\) && !FERRAMENTAS_DE_LEITURA\.has\(name\) && !FERRAMENTAS_DE_PROPOSTA\.has\(name\)/)
  })

  /**
   * O que torna a ferramenta segura não é o nome, é o que ela NÃO chama: aprovar exige
   * APPROVAL_TOKEN (que este servidor não tem) e materializar exige AGENT_TOKEN (que ele TEM).
   * Uma linha a mais aqui chamando `/materialize` transformaria proposta em execução.
   */
  it('propor só cria e submete — nunca aprova nem materializa, e o efeito é fixo', () => {
    const caso = FONTE.match(/case 'rayzen_propose_project': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).not.toBe('')
    const chamadas = [...caso.matchAll(/api\('(\w+)', [`'](\/[^`']*)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(chamadas).toEqual(['POST /handoffs', 'POST /handoffs/${envelope.id}/submit'])
    expect(caso).not.toMatch(/approve|materialize/)
    expect(caso).toMatch(/actionKey: 'jarvis:create_project_folder'/)
    expect(caso).toMatch(/template: 'padrao-rayzen',\s*root: RAIZ_DE_PROPOSTA/)
    expect(caso).toMatch(/requireProjectId\(args\)/)
  })
})

/**
 * Item 8.2 (13/11): `assistente` = proposta + mãos DIRETAS, escrita só dentro do Rayzen.
 * O que importa é o que fica FORA: execução no PC, LLM em lote, criação sem envelope.
 */
describe('MCP — escopo assistente', () => {
  const diretas = (() => {
    const bloco = FONTE.match(/const FERRAMENTAS_DIRETAS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
    return [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1])
  })()

  it('as mãos diretas existem e nenhuma executa, dispara lote ou cria', () => {
    expect(diretas.length).toBeGreaterThan(0)
    for (const nome of diretas) expect(todas).toContain(nome)
    for (const proibida of ['rayzen_agent_task', 'rayzen_checkpoint', 'rayzen_create_project', 'rayzen_create_goal']) {
      expect(diretas).not.toContain(proibida)
    }
    expect(diretas.filter((n) => n.startsWith('rayzen_blueprint') || n.startsWith('rayzen_guardian'))).toEqual([])
  })

  it('opt-in por nome, e vence proposta para o mesmo consumidor', () => {
    expect(FONTE).toMatch(/process\.env\.MCP_CONSUMIDORES_ASSISTENTE/)
    expect(FONTE).toMatch(/if \(CONSUMIDORES_ASSISTENTE\.has\(consumidor\.nome\)\) return ESCOPO_ASSISTENTE\s*\n\s*return CONSUMIDORES_PROPOSTA\.has/)
  })

  it('a listagem e a CHAMADA recusam fora de leitura ∪ proposta ∪ diretas', () => {
    expect(FONTE).toMatch(/ehAssistente\(escopo\) \? TOOLS\.filter\(\(t\) => ferramentasDoEscopo\(escopo\)\.has\(t\.name\)\)/)
    expect(FONTE).toMatch(/if \(ehAssistente\(escopo\) && !ferramentasDoEscopo\(escopo\)\.has\(name\)\)/)
    expect(FONTE).toMatch(/if \(ehAssistente\(escopo\)\) return new Set\(\[\.\.\.FERRAMENTAS_DE_LEITURA, \.\.\.FERRAMENTAS_DE_PROPOSTA, \.\.\.FERRAMENTAS_DIRETAS\]\)/)
  })

  it('decisão registrada pelo assistente carrega procedência; o Geral não tem ciclo de vida', () => {
    const decisao = FONTE.match(/case 'rayzen_register_decision': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(decisao).toMatch(/type: 'decision'/)
    expect(decisao).toMatch(/registradoPor: `mcp:/)
    const status = FONTE.match(/case 'rayzen_set_project_status': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(status).toMatch(/projectId === PROJETO_GERAL_ID/)
  })

  it('o id do Geral bate com o da API (anti-drift)', () => {
    const api = readFileSync(join(__dirname, '../../../../api/src/common/escopo-geral.const.ts'), 'utf8')
    const daApi = api.match(/PROJETO_GERAL_ID = '([^']+)'/)?.[1]
    const doMcp = FONTE.match(/const PROJETO_GERAL_ID = '([^']+)'/)?.[1]
    expect(daApi).toBeDefined()
    expect(doMcp).toBe(daApi)
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
