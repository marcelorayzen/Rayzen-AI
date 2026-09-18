import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ehEscopoGeral, escopoDeBusca, escopoDeRegistro, PROJETO_GERAL_ID, PROJETO_GERAL_STATUS,
} from '../escopo-geral.const'

/**
 * ── O contexto geral deixa de ser ausência e vira um lugar ──────────────────
 *
 * Era `projectId NULL`, e ausência não distingue nada: `registro_sem_projeto` precisou de uma
 * lista de canais (`chat`, `hub`) para separar "geral deliberado" de "perdeu o dono", `Document`
 * não tem `source` e lá a distinção nem existia, e não cabia mais de um geral.
 *
 * **A propriedade que faz isto funcionar é uma assimetria**, e é o que estes testes protegem:
 * escreve-se NO Geral, busca-se FORA dele. Se a busca passasse a usar o id do Geral, ela traria só
 * o que foi dito dentro dele — quase nada — e o contexto geral ficaria pior do que era como
 * ausência.
 */

describe('ehEscopoGeral', () => {
  it('ausente é geral', () => {
    expect(ehEscopoGeral(null)).toBe(true)
    expect(ehEscopoGeral(undefined)).toBe(true)
    expect(ehEscopoGeral('')).toBe(true)
  })

  it('o próprio Geral é geral', () => {
    expect(ehEscopoGeral(PROJETO_GERAL_ID)).toBe(true)
  })

  it('projeto de verdade não é', () => {
    expect(ehEscopoGeral('7690370b-aa1e-4b13-8335-a8a14ad0d859')).toBe(false)
  })
})

describe('a assimetria: escrever no Geral, buscar fora dele', () => {
  /** A razão de existir do contexto geral é alcançar o acervo inteiro. */
  it('busca no geral é SEM escopo, inclusive com o id do Geral', () => {
    expect(escopoDeBusca(null)).toBeUndefined()
    expect(escopoDeBusca(PROJETO_GERAL_ID)).toBeUndefined()
  })

  it('busca em projeto real mantém o escopo', () => {
    expect(escopoDeBusca('proj-1')).toBe('proj-1')
  })

  it('registro sem projeto tem dono: o Geral', () => {
    expect(escopoDeRegistro(null)).toBe(PROJETO_GERAL_ID)
    expect(escopoDeRegistro(undefined)).toBe(PROJETO_GERAL_ID)
  })

  it('registro em projeto real não é desviado', () => {
    expect(escopoDeRegistro('proj-1')).toBe('proj-1')
  })
})

/**
 * ── A ligação, que é onde a regressão moraria ───────────────────────────────
 *
 * As funções certas não bastam: o que quebra o contexto geral é um ponto do orquestrador voltar a
 * passar `projectId` cru para a busca. Aí o Geral vira escopo de consulta e o acervo some, sem
 * erro nenhum.
 */
describe('o orquestrador usa as duas funções, cada uma no seu lugar', () => {
  const fonte = readFileSync(
    join(__dirname, '..', '..', 'modules', 'orchestrator', 'orchestrator.service.ts'), 'utf8')

  it('toda busca de memória passa por escopoDeBusca', () => {
    const buscas = fonte.match(/this\.memory\.(search|searchAndSynthesize)\([^)]*\)/g) ?? []
    expect(buscas.length).toBeGreaterThan(0)
    for (const b of buscas) expect(b).toMatch(/escopoDeBusca\(/)
  })

  /** Pedir o ProjectState do Geral traria um objetivo sintetizado de conversa solta. */
  it('o contexto de projeto não é montado para o escopo geral', () => {
    expect(fonte).toMatch(/if \(ehEscopoGeral\(projectId\)\) return ''/)
  })

  /**
   * A declaração "ESCOPO GERAL" tem de sair também quando o id é o do Geral.
   *
   * A asserção olha o ARGUMENTO linha a linha, não a chamada inteira: uma primeira versão usou
   * `[^)]*` e reprovou por não atravessar o `filter(...)` aninhado — a regex reprovando o próprio
   * teste, não o código.
   */
  it('o bloco de terceiros declara o escopo por ehEscopoGeral, não por `!!projectId`', () => {
    const linhas = fonte.split(/\r?\n/).filter((l) => l.includes('blocoDeTrechosDeTerceiro('))
    expect(linhas.length).toBeGreaterThan(0)
    for (const l of linhas) {
      expect(l).toContain('!ehEscopoGeral(projectId)')
      expect(l).not.toContain('!!projectId')
    }
  })
})

describe('a migração cria o Geral fora dos ciclos', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', 'prisma', 'migrations', '20260918160000_projeto_geral', 'migration.sql'),
    'utf8')

  it('usa o id fixo que o código reconhece', () => {
    expect(sql).toContain(PROJETO_GERAL_ID)
  })

  /**
   * `SmartCheckpointService` e o sync do catálogo varrem `status: 'active'`. Ativo, o Geral
   * ganharia checkpoint por LLM a cada 10min e 19 invariantes a cada 30 — máquina inteira girando
   * sobre um balde de contexto.
   *
   * A asserção olha só as linhas de COMANDO: uma primeira versão procurou `'active'` no arquivo
   * inteiro e reprovou por causa do comentário que explica justamente por que o status não é esse.
   */
  it('o status mantém o Geral fora das varreduras de projeto ativo', () => {
    const comandos = sql.split(/\r?\n/).filter((l) => !l.trim().startsWith('--')).join(' ')
    expect(comandos).toContain(`'${PROJETO_GERAL_STATUS}'`)
    expect(comandos).not.toContain("'active'")
  })

  /** Migração que falha bloqueia o boot da V1 — `migrate deploy` roda na subida. */
  it('é idempotente', () => {
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i)
  })
})

describe('o invariante largou a lista de canais', () => {
  const bridge = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'api-v2', 'src', 'core', 'v1-bridge.service.ts'), 'utf8')

  /**
   * A lista existia porque ausência não distinguia. Com o geral tendo dono, o que sobra sem dono é
   * só o que de fato perdeu — a pergunta que o invariante sempre quis fazer.
   */
  it('não filtra mais por `source`', () => {
    const bloco = bridge.slice(bridge.indexOf('registrosSemProjeto'), bridge.indexOf('registrosSemProjeto') + 2600)
    expect(bloco).toMatch(/const soPerdeuDono = \{ projectId: null \}/)
    expect(bloco).not.toMatch(/CANAIS_DE_CONVERSA/)
  })
})
