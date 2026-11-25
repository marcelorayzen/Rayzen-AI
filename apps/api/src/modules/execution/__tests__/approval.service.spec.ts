import { ApprovalService, hashDoAlvo, VALIDADE_MAXIMA_MS } from '../approval.service'

/**
 * Fase 5-A — aprovacao humana para execucao de risco alto.
 *
 * Ate 2026-09-08 bastava `force: true` no payload para executar risco `high`. Quem montava o
 * payload concedia a propria aprovacao — e num sistema com specialist loop, quem monta payload e
 * o LLM. Nao havia aprovacao; havia um campo com nome de aprovacao.
 */
describe('ApprovalService — hash canônico do alvo', () => {
  const base = { actionKey: 'jarvis:run_command', actor: 'desktop', resource: '/repo', args: { command: 'pnpm install' } }

  /**
   * Ordem de chave nao pode mudar o hash: `{a,b}` e `{b,a}` sao o mesmo pedido. Um hash que
   * discordasse recusaria execucao legitima — falso negativo e o que faz alguem desligar a
   * checagem.
   */
  it('ordem das chaves não altera o hash', () => {
    const a = hashDoAlvo({ ...base, args: { command: 'x', path: 'y' } })
    const b = hashDoAlvo({ ...base, args: { path: 'y', command: 'x' } })
    expect(a).toBe(b)
  })

  it.each([
    ['comando diferente', { ...base, args: { command: 'pnpm install --force' } }],
    ['recurso diferente', { ...base, resource: '/outro-repo' }],
    ['ator diferente',    { ...base, actor: 'server' }],
    ['ação diferente',    { ...base, actionKey: 'jarvis:git_push' }],
  ])('hash muda quando muda o %s', (_n, alvo) => {
    expect(hashDoAlvo(alvo)).not.toBe(hashDoAlvo(base))
  })
})

describe('ApprovalService — consumo, replay e alteração de argumentos', () => {
  function build(candidata: unknown, updateCount = 1) {
    const prisma = {
      executionApproval: {
        create:     jest.fn().mockResolvedValue({ id: 'apr-1', expiresAt: new Date(), argsHash: 'h' }),
        findFirst:  jest.fn().mockResolvedValue(candidata),
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
      },
    }
    return { prisma, svc: new ApprovalService(prisma as never) }
  }

  const alvo = { actionKey: 'jarvis:run_command', actor: 'desktop', resource: '/repo', args: { command: 'pnpm install' } }

  it('consome quando há aprovação válida', async () => {
    const { svc, prisma } = build({ id: 'apr-1', createdBy: 'approval-token:abc123' })
    await expect(svc.consumir(alvo)).resolves.toEqual({ ok: true, id: 'apr-1', createdBy: 'approval-token:abc123' })
    // O consumo é um UPDATE condicional em consumedAt: null — atômico. Ler-decidir-gravar
    // abriria janela para dois consumos da mesma aprovação em corrida.
    expect(prisma.executionApproval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'apr-1', consumedAt: null } }),
    )
  })

  /**
   * Fase 7, caso 4 do plano de execução tipada: `id`/`createdBy` já estavam disponíveis em
   * `candidata` (a mesma query que decide `ok`) — a lacuna era não devolvê-los. Sem query
   * extra, sem mudança de schema.
   */
  it('devolve quem aprovou — não só que a aprovação existiu', async () => {
    const { svc } = build({ id: 'apr-2', createdBy: 'marcelo' })
    const r = await svc.consumir(alvo)
    expect(r.id).toBe('apr-2')
    expect(r.createdBy).toBe('marcelo')
  })

  /** REPLAY: a segunda tentativa perde a corrida do UPDATE e é recusada. */
  it('replay é recusado — segunda tentativa não consome de novo', async () => {
    const { svc } = build({ id: 'apr-1', createdBy: 'x' }, 0)
    await expect(svc.consumir(alvo)).resolves.toEqual({ ok: false, motivo: 'aprovação já consumida' })
  })

  /** ALTERAÇÃO DE ARGUMENTOS: hash diferente, nenhuma candidata, recusa. */
  it('argumento alterado depois do aceite não encontra aprovação', async () => {
    const { svc, prisma } = build(null)
    const r = await svc.consumir({ ...alvo, args: { command: 'rm -rf /' } })
    expect(r.ok).toBe(false)
    // O hash procurado é o do argumento NOVO, não o do aprovado.
    expect(prisma.executionApproval.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ argsHash: hashDoAlvo({ ...alvo, args: { command: 'rm -rf /' } }) }),
      }),
    )
  })

  /**
   * A busca já exige `expiresAt > agora` e `consumedAt: null` no BANCO. Filtrar em memória
   * depois deixaria a janela aberta entre a leitura e a decisão.
   */
  it('a validade e o não-consumo são condição da QUERY, não checagem posterior', async () => {
    const { svc, prisma } = build(null)
    await svc.consumir(alvo)
    const where = prisma.executionApproval.findFirst.mock.calls[0][0].where
    expect(where.consumedAt).toBeNull()
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('motivo da recusa é genérico — não ensina a enumerar aprovações válidas', async () => {
    const { svc } = build(null)
    const r = await svc.consumir(alvo)
    expect(r.motivo).not.toMatch(/expirou|não existe|já usada/i)
  })

  it('validade tem teto — nem quem aprova emite aprovação eterna', async () => {
    const { svc, prisma } = build(null)
    await svc.criar(alvo, { id: 'approval-token:abc123', type: 'approval_token' }, 10 * VALIDADE_MAXIMA_MS)
    const { expiresAt } = prisma.executionApproval.create.mock.calls[0][0].data
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(VALIDADE_MAXIMA_MS + 1000)
  })

  /**
   * `createdBy` era um campo de AUDITORIA preenchido por quem esta sendo auditado: bastava
   * mandar `createdBy: "marcelo"` no corpo para o registro dizer que Marcelo aprovou. Agora a
   * identidade vem do principal que o guard autenticou.
   */
  it('grava a identidade do principal, e o tipo junto', async () => {
    const { svc, prisma } = build(null)
    await svc.criar(alvo, { id: 'approval-token:deadbeef', type: 'approval_token' })
    const data = prisma.executionApproval.create.mock.calls[0][0].data
    expect(data.createdBy).toBe('approval-token:deadbeef')
    expect(data.createdByType).toBe('approval_token')
  })
})
