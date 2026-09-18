import { readFileSync } from 'fs'
import { join } from 'path'
import { SessionService } from '../session.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

/**
 * ── "Unificar" só é mecanismo se houver UM lugar decidindo ──────────────────
 *
 * Três canais tinham três políticas: a web cunhava um id por carregamento de página, o Telegram
 * usava um id eterno por `(chatId, threadId)`, e o HUB tem um estado próprio. Testar só
 * `decidirSessao` deixaria sem sensor justamente a distância entre a regra e quem a usa — se um
 * canal voltar a decidir sozinho, a função continua verde e a unificação some.
 */

const raiz = join(__dirname, '..', '..', '..', '..', '..')

describe('a política de sessão é uma só, e os dois canais a consultam', () => {
  it('a web pergunta ao servidor em vez de cunhar sozinha', () => {
    const hook = readFileSync(join(raiz, 'web', 'app', 'hooks', 'useChatStream.ts'), 'utf8')
    expect(hook).toMatch(/\/sessions\/atual/)

    // O `createSessionId` local pode ficar — mas só como reserva de falha, nunca como o caminho
    // que roda na montagem. Se ele voltar a ser chamado direto num efeito de mount, é regressão.
    expect(hook).not.toMatch(/useEffect\(\(\) => \{\s*setSessionId\(createSessionId\(\)\)\s*\}, \[\]\)/)
  })

  it('o Telegram pergunta à mesma política, não usa mais o id eterno da linha', () => {
    const tg = readFileSync(join(raiz, 'api', 'src', 'modules', 'telegram', 'telegram.service.ts'), 'utf8')
    expect(tg).toMatch(/fioDaConversa/)
    // `session.sessionId` só pode aparecer dentro do fallback de `fioDaConversa`.
    const forasDoFallback = tg
      .split('\n')
      .filter((l) => l.includes('session.sessionId') && !l.includes('return session.sessionId'))
    expect(forasDoFallback).toEqual([])
  })

  /**
   * Sem isto, uma falha de leitura no banco deixaria o bot mudo — e a degradação certa é voltar ao
   * comportamento de antes desta mudança, não parar de responder.
   */
  it('o Telegram degrada para o id da linha se a política falhar', () => {
    const tg = readFileSync(join(raiz, 'api', 'src', 'modules', 'telegram', 'telegram.service.ts'), 'utf8')
    const fn = tg.slice(tg.indexOf('private async fioDaConversa'), tg.indexOf('private async fioDaConversa') + 500)
    expect(fn).toMatch(/catch\s*\{\s*return session\.sessionId/)
  })

  /** A rota `atual` tem de vir antes de `:sessionId/messages`, senão o parâmetro a engole. */
  it('a rota `atual` é declarada antes da rota com parâmetro', () => {
    const ctrl = readFileSync(join(raiz, 'api', 'src', 'modules', 'session', 'session.controller.ts'), 'utf8')
    expect(ctrl.indexOf("@Get('atual')")).toBeLessThan(ctrl.indexOf("@Get(':sessionId/messages')"))
  })
})

/**
 * ── O escopo, que é onde a unificação poderia estragar a separação ──────────
 *
 * A decisão de 17/09 tornou a conversa sem projeto o *contexto geral*, deliberado. Ele tem um fio
 * próprio: retomar a conversa de um projeto ao abrir o contexto geral (ou o inverso) misturaria
 * escopos que a casa acabou de separar.
 */
describe('sessaoAtual respeita o escopo do projeto', () => {
  const comPrisma = (retorno: unknown) => {
    // O parâmetro é declarado de propósito: sem ele o TS infere tupla vazia em `mock.calls`
    // e as asserções sobre o `where` não compilam.
    const findFirst = jest.fn(async (_args: { where?: unknown }) => retorno)
    const svc = new SessionService({ conversationMessage: { findFirst } } as never)
    return { svc, findFirst }
  }

  it('busca só mensagens de USUÁRIO — telemetria domina a tabela', async () => {
    const { svc, findFirst } = comPrisma(null)
    await svc.sessaoAtual('proj-1')
    expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { role: 'user', projectId: 'proj-1' } })
  })

  /**
   * O escopo geral tem um id desde 18/09 — antes era `projectId: null`, e a asserção aqui era essa.
   * O que **não** mudou é a propriedade que este teste protege: o geral é um escopo, nunca um
   * curinga. Retomar a conversa de um projeto ao abrir o contexto geral (ou o inverso) misturaria
   * escopos que a casa separou de propósito.
   */
  it('o contexto geral consulta o id do Geral, não "qualquer projeto"', async () => {
    const { svc, findFirst } = comPrisma(null)
    await svc.sessaoAtual(null)
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { role: 'user', projectId: PROJETO_GERAL_ID },
    })
  })

  it('retoma a sessão recente do escopo', async () => {
    const { svc } = comPrisma({ sessionId: 'fio-1', createdAt: new Date(Date.now() - 60_000) })
    const d = await svc.sessaoAtual('proj-1')
    expect(d).toMatchObject({ sessionId: 'fio-1', retomada: true })
  })

  it('sem conversa anterior, começa uma', async () => {
    const { svc } = comPrisma(null)
    const d = await svc.sessaoAtual('proj-1')
    expect(d.retomada).toBe(false)
    expect(d.sessionId).toHaveLength(36)   // uuid
  })

  /** Erro de leitura começa conversa nova: retomar a errada é pior que recomeçar. */
  it('falha de banco não retoma nada', async () => {
    const findFirst = jest.fn((_args: { where?: unknown }) => Promise.reject(new Error('banco fora')))
    const svc = new SessionService({ conversationMessage: { findFirst } } as never)
    const d = await svc.sessaoAtual(null)
    expect(d.retomada).toBe(false)
  })
})
