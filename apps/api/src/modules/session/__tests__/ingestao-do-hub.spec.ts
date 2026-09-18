import { readFileSync } from 'fs'
import { join } from 'path'
import { SessionService } from '../session.service'
import { iguaisEmTempoConstante } from '../hub-ingest.guard'

/**
 * ── O HUB deixa de ser um cérebro à parte ───────────────────────────────────
 *
 * Até 18/09 o Hermes tinha memória própria (`state.db`) e só ferramentas de LEITURA no Rayzen:
 * conversa no HUB não existia em `conversation_messages`. Medido: 5 sessões no `state.db`, todas
 * `source: cli`, e `gateway_routing` com **0 linhas** — a ponte `hermes mcp serve` é de mensageria
 * e não enxergaria essas conversas nem se o HUB estivesse em uso.
 *
 * Quem empurra é o `post_llm_call`: uma vez por turno, emitido pelo RUNTIME.
 */

const fakePrisma = () => {
  const criadas: unknown[] = []
  const eventos: unknown[] = []
  return {
    prisma: {
      conversationMessage: { createMany: async (a: { data: unknown }) => { criadas.push(a.data); return { count: 2 } } },
      event:               { create:     async (a: { data: unknown }) => { eventos.push(a.data); return {} } },
    },
    criadas,
    eventos,
  }
}

const svcCom = (p: ReturnType<typeof fakePrisma>) => new SessionService(p.prisma as never)

describe('ingerirTurnoDoHub — a conversa entra no mesmo acervo', () => {
  it('grava o par user/assistant com módulo `hub`', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).ingerirTurnoDoHub({
      sessionId: 'hub-1', userMessage: 'oi', assistantResponse: 'olá',
    })
    expect(r).toEqual({ gravado: true, evento: false })
    const linhas = p.criadas[0] as Array<{ module: string; role: string; content: string }>
    expect(linhas.map((l) => [l.module, l.role, l.content])).toEqual([
      ['hub', 'user', 'oi'], ['hub', 'assistant', 'olá'],
    ])
  })

  /** Um `post_llm_call` de aquecimento não pode virar linha de conversa. */
  it('turno vazio não grava nada', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).ingerirTurnoDoHub({ sessionId: 'hub-1', userMessage: '  ', assistantResponse: '' })
    expect(r).toEqual({ gravado: false, evento: false })
    expect(p.criadas).toHaveLength(0)
  })
})

/**
 * ── A assimetria que impede a timeline de ser escrita por quem não decide ───
 *
 * O modelo dizer "decidimos usar X" é ele AFIRMANDO. O Marcelo dizer a mesma frase é fato sobre o
 * que foi dito. Esta casa já viu o que sai de modelo preenchendo formulário: um `decision_log.db`,
 * um watchdog inexistente e uma branch `release/R3.b` que nunca existiu.
 */
describe('o evento vem da PESSOA, nunca do modelo', () => {
  it('decisão declarada pelo usuário vira evento, com o texto original', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).ingerirTurnoDoHub({
      sessionId: 'hub-1',
      userMessage: 'decidimos usar Postgres em vez de Mongo',
      assistantResponse: 'ok',
      projectId: 'proj-1',
    })
    expect(r.evento).toBe(true)
    const ev = p.eventos[0] as { type: string; source: string; content: string; projectId: string | null }
    expect(ev.type).toBe('decision')
    expect(ev.source).toBe('hub')
    expect(ev.projectId).toBe('proj-1')
    // O texto ORIGINAL, nunca uma reformulação: falso positivo vira linha ruidosa, não fato inventado.
    expect(ev.content).toBe('decidimos usar Postgres em vez de Mongo')
  })

  /** A asserção central do arquivo. */
  it('a MESMA frase dita pelo modelo NÃO vira evento', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).ingerirTurnoDoHub({
      sessionId: 'hub-1',
      userMessage: 'o que você acha?',
      assistantResponse: 'decidimos usar Postgres em vez de Mongo',
    })
    expect(r.evento).toBe(false)
    expect(p.eventos).toHaveLength(0)
  })

  /** Reuso de `pareceDecisao`: "não decidido" não é decisão, e isso já custou um conserto em 18/08. */
  it('negação não vira decisão', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).ingerirTurnoDoHub({
      sessionId: 'hub-1', userMessage: 'ainda não decidimos isso', assistantResponse: 'ok',
    })
    expect(r.evento).toBe(false)
  })
})

describe('a credencial da ingestão é escopada e falha fechada', () => {
  const guard = readFileSync(join(__dirname, '..', 'hub-ingest.guard.ts'), 'utf8')
  const ctrl  = readFileSync(join(__dirname, '..', 'session.controller.ts'), 'utf8')

  /**
   * O inverso do defeito de `MCP_TOKEN_HERMES` em 13/09 — lá a variável vazia fazia o consumidor
   * não existir. Aqui, ausente não pode virar "qualquer um entra".
   */
  it('sem HUB_INGEST_TOKEN a rota recusa, em vez de abrir', () => {
    expect(guard).toMatch(/if \(!esperado\) throw new UnauthorizedException\(\)/)
  })

  it('a comparação é de tempo constante, não `===`', () => {
    expect(guard).toMatch(/timingSafeEqual/)
    expect(guard).not.toMatch(/token === esperado/)
  })

  it('iguaisEmTempoConstante compara de verdade', () => {
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true)
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false)
    expect(iguaisEmTempoConstante('abc', 'abcd')).toBe(false)   // tamanhos diferentes não lançam
    expect(iguaisEmTempoConstante('', '')).toBe(true)
  })

  /**
   * `@Public()` faz o guard GLOBAL ceder; sem `@UseGuards(HubIngestGuard)` junto, a rota ficaria
   * aberta ao mundo. Os dois andam em par, e é por isso que o teste exige os dois.
   */
  it('a rota tem @Public E o guard escopado', () => {
    const trecho = ctrl.slice(ctrl.indexOf('@Public()'), ctrl.indexOf("@Post('ingest')") + 40)
    expect(trecho).toMatch(/@Public\(\)/)
    expect(trecho).toMatch(/@UseGuards\(HubIngestGuard\)/)
  })

  /**
   * O `AGENT_TOKEN` abriria a API inteira a um serviço que está na internet.
   *
   * A asserção é sobre LER a variável, não sobre mencioná-la: a primeira versão deste teste
   * proibia a string e reprovou por causa do comentário que explica justamente por que ela não é
   * usada. Teste que reprova o comentário não mede o comportamento.
   */
  it('a ingestão não LÊ o AGENT_TOKEN', () => {
    expect(guard).not.toMatch(/process\.env\.AGENT_TOKEN/)
    expect(guard).toMatch(/process\.env\.HUB_INGEST_TOKEN/)
  })
})

describe('o hook do Hermes', () => {
  const hook = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'hermes', 'rayzen-hub-hook.mjs'), 'utf8')

  /** Hook que derruba o turno troca "conversa não registrada" por "conversa não acontece". */
  it('nunca falha ruidosamente — sai 0 em qualquer erro', () => {
    expect(hook).toMatch(/process\.exit\(0\)/)
    expect(hook).not.toMatch(/process\.exit\([1-9]/)
  })

  /** Ele carrega o turno inteiro a cada disparo: enviar cresceria quadraticamente. */
  it('não envia conversation_history', () => {
    expect(hook).not.toMatch(/conversation_history:/)
  })

  it('lê user_message e assistant_response de `extra`', () => {
    expect(hook).toMatch(/extra\.user_message/)
    expect(hook).toMatch(/extra\.assistant_response/)
  })
})
