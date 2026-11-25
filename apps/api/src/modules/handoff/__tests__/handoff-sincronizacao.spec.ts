import { readFileSync } from 'fs'
import { join } from 'path'
import { proximoEstadoDoHandoff } from '../handoff-sincronizacao'
import { sincronizarHandoffComTarefa } from '../handoff-tarefa'
import { EstadoDoHandoff } from '../handoff.const'

describe('proximoEstadoDoHandoff — o ciclo da tarefa move o envelope', () => {
  it('claim leva a fila para reivindicado', () => {
    expect(proximoEstadoDoHandoff('queued', { tipo: 'claim' })).toBe('claimed')
  })

  /**
   * A tarefa expõe `processing` uma vez só, no claim — ela não distingue "peguei" de "estou
   * trabalhando". Quem distingue é o batimento, que só quem executa manda.
   */
  it('o batimento é o que separa reivindicado de executando', () => {
    expect(proximoEstadoDoHandoff('claimed', { tipo: 'heartbeat' })).toBe('executing')
    expect(proximoEstadoDoHandoff('queued', { tipo: 'heartbeat' })).toBeNull()
  })

  it('batimento repetido não move nada', () => {
    expect(proximoEstadoDoHandoff('executing', { tipo: 'heartbeat' })).toBeNull()
  })

  /**
   * O estado de partida faz parte do caso, e nao e detalhe: `compensated` so existe DEPOIS de
   * uma reconciliacao, e reconciliacao so acontece sobre `effect_unknown` (o proprio bridge
   * recusa outro estado com `stale`). Testar a partir de `executing` mediria um caminho que o
   * sistema nao produz.
   */
  it.each([
    // `done` NAO fecha mais o envelope: ele o leva a verificacao. A excecao e vir de
    // `effect_unknown`, onde o `done` e a reconciliacao humana — uma pessoa ja olhou.
    ['executing', 'done', 'reconciling'],
    ['executing', 'failed_safe', 'failed_safe'],
    ['executing', 'effect_unknown', 'effect_unknown'],
    ['effect_unknown', 'compensated', 'compensated'],
    ['effect_unknown', 'done', 'completed'],
  ] as const)('de %s, status %s da tarefa vira %s no envelope', (de, status, esperado) => {
    expect(proximoEstadoDoHandoff(de, { tipo: 'status', status })).toBe(esperado)
  })

  /** Compensar sem passar por efeito incerto nao e um caminho do sistema — e nao vira estado. */
  it('nao pula direto de executando para compensado', () => {
    expect(proximoEstadoDoHandoff('executing', { tipo: 'status', status: 'compensated' })).toBeNull()
  })

  /**
   * ── O único que exige julgamento, e de onde ele sai ────────────────────────
   *
   * A tarefa não diz se houve efeito quando a ação lançou. Chamar tudo de `failed_safe`
   * afirmaria ausência de efeito sem ter olhado; chamar tudo de `effect_unknown` mandaria
   * alguém reconciliar até erro de validação, e reconciliação que dispara sempre é a que
   * alguém desliga.
   *
   * O que se sabe é se a execução chegou a reportar progresso.
   */
  it('falha ANTES de qualquer batimento é falha segura', () => {
    expect(proximoEstadoDoHandoff('claimed', { tipo: 'status', status: 'failed' })).toBe('failed_safe')
    expect(proximoEstadoDoHandoff('queued', { tipo: 'status', status: 'failed' })).toBe('failed_safe')
  })

  it('falha NO MEIO da execução é efeito incerto, não falha segura', () => {
    expect(proximoEstadoDoHandoff('executing', { tipo: 'status', status: 'failed' })).toBe('effect_unknown')
  })

  it('pending e processing não movem o envelope sozinhos', () => {
    expect(proximoEstadoDoHandoff('queued', { tipo: 'status', status: 'pending' })).toBeNull()
    expect(proximoEstadoDoHandoff('queued', { tipo: 'status', status: 'processing' })).toBeNull()
  })

  /** Envelope em estado final não é movido por sinal atrasado de uma tarefa. */
  it.each(['completed', 'cancelled', 'rejected', 'failed_safe', 'compensated'] as EstadoDoHandoff[])(
    'sinal que chega depois não tira o envelope de %s',
    (final) => {
      expect(proximoEstadoDoHandoff(final, { tipo: 'status', status: 'done' })).toBeNull()
      expect(proximoEstadoDoHandoff(final, { tipo: 'claim' })).toBeNull()
    },
  )
})

function prismaFake(handoff: { id: string; status: string } | null) {
  return {
    projectHandoff: {
      findFirst: jest.fn().mockResolvedValue(handoff),
      update: jest.fn().mockResolvedValue({}),
    },
  }
}

describe('sincronizarHandoffComTarefa', () => {
  it('persiste a transição quando há envelope', async () => {
    const prisma = prismaFake({ id: 'h1', status: 'queued' })
    const r = await sincronizarHandoffComTarefa(prisma as never, 'task-1', { tipo: 'claim' })

    expect(r).toBe('claimed')
    expect(prisma.projectHandoff.update).toHaveBeenCalledWith({
      where: { id: 'h1' }, data: { status: 'claimed' },
    })
  })

  /** A maioria das tarefas não vem de envelope. Ausência não é erro. */
  it('tarefa sem envelope sai calada', async () => {
    const prisma = prismaFake(null)
    expect(await sincronizarHandoffComTarefa(prisma as never, 'task-1', { tipo: 'claim' })).toBeNull()
    expect(prisma.projectHandoff.update).not.toHaveBeenCalled()
  })

  /**
   * Derrubar a conclusão de uma execução porque a linha do envelope não pôde ser escrita
   * trocaria um registro incompleto por um efeito sem conclusão registrada — o estado incerto
   * que a Fase 1 existe para não produzir.
   */
  it('falha ao gravar não derruba o ciclo de vida da tarefa', async () => {
    const prisma = prismaFake({ id: 'h1', status: 'queued' })
    prisma.projectHandoff.update.mockRejectedValue(new Error('banco fora'))

    await expect(sincronizarHandoffComTarefa(prisma as never, 'task-1', { tipo: 'claim' }))
      .resolves.toBeNull()
  })
})

/**
 * G3.2a (24/11): no ensaio G3.1 a sessão ficou `active` para sempre depois do corte — quem
 * chamaria `complete` ou `error` morreu junto. A API, que declara a tarefa órfã, marca a sessão.
 */
describe('envelope de sessão que fica incerto marca a sessão como interrompida', () => {
  const SESSAO = [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 'sess-1' } }]

  function comSessao(status: string, effects: unknown = SESSAO) {
    const prisma = prismaFake({ id: 'h1', status })
    prisma.projectHandoff.findFirst.mockResolvedValue({ id: 'h1', status, effects })
    const agentSession = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }
    return { ...prisma, agentSession }
  }

  it('posse perdida durante a execução: a sessão em curso vira interrupted', async () => {
    const prisma = comSessao('executing')
    const r = await sincronizarHandoffComTarefa(prisma as never, 'task-1', { tipo: 'status', status: 'effect_unknown' })
    expect(r).toBe('effect_unknown')
    const chamada = prisma.agentSession.updateMany.mock.calls[0][0]
    expect(chamada.where).toEqual({ id: 'sess-1', status: { in: ['active', 'waiting', 'stopping'] } })
    expect(chamada.data.status).toBe('interrupted')
  })

  it.each([
    ['o envelope não ficou incerto', 'queued', { tipo: 'claim' } as const, SESSAO],
    ['o envelope não é de sessão', 'executing', { tipo: 'status', status: 'effect_unknown' } as const, [{ actionKey: 'jarvis:create_project_folder', payload: {} }]],
  ])('não toca em sessão quando %s', async (_caso, status, sinal, effects) => {
    const prisma = comSessao(status, effects)
    await sincronizarHandoffComTarefa(prisma as never, 'task-1', sinal)
    expect(prisma.agentSession.updateMany).not.toHaveBeenCalled()
  })

  it('falha ao marcar a sessão não apaga a transição do envelope', async () => {
    const prisma = comSessao('executing')
    prisma.agentSession.updateMany.mockRejectedValue(new Error('banco fora'))
    await expect(sincronizarHandoffComTarefa(prisma as never, 'task-1', { tipo: 'status', status: 'effect_unknown' }))
      .resolves.toBe('effect_unknown')
  })
})

/**
 * ── Anti-ciclo, por leitura ─────────────────────────────────────────────────
 *
 * O `HandoffModule` importa o `ExecutionModule`, que importa o `AgentBridgeModule`. Se alguém
 * fizer o bridge injetar um `HandoffService`, o grafo fecha — e ciclo de módulo **não é erro de
 * tipo**: `tsc` passa, os specs unitários passam, e o Nest se recusa a subir. Foi assim que a
 * produção caiu em 14/09.
 *
 * O teste de boot pega o ciclo; este aqui explica o porquê no lugar onde a tentação mora.
 */
describe('a ligação com o bridge não pode virar dependência de módulo', () => {
  it('o agent-bridge usa a função, nunca um HandoffService injetado', () => {
    const fonte = readFileSync(
      join(__dirname, '..', '..', 'agent-bridge', 'agent-bridge.service.ts'),
      'utf8',
    )
    expect(fonte).toContain('sincronizarHandoffComTarefa')
    // A palavra aparece num COMENTARIO que explica por que ela nao pode ser injetada — entao o
    // que se procura e o import e a injecao, nao a mencao. Procurar a palavra crua reprovaria a
    // propria explicacao.
    expect(fonte).not.toMatch(/import .*Handoff(Service|Module)/)
    expect(fonte).not.toMatch(/private .*: HandoffService/)
  })
})
