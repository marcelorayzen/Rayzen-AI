import { SystemStatusService } from '../system-status.service'
import { COMPONENTE_POR_ID } from '../system-components.const'

/**
 * O Rayzen não representava sistema em execução em lugar nenhum: Goal Graph,
 * painéis e `nextSteps` mostram o que falta, nunca o que está de pé.
 *
 * Estes quatro estados são a razão de a frente existir. O mais importante é
 * `falhando` — um ciclo que captura o próprio erro e loga `warn` é, de qualquer
 * tabela de resultado, idêntico a um ciclo que teve sucesso quieto. É o estado
 * que descreve um sistema que *parece* funcionando.
 */
describe('SystemStatusService — os quatro estados', () => {
  function build(linhas: Array<Record<string, unknown>> = []) {
    const prisma = {
      systemHeartbeat: {
        findMany: jest.fn().mockResolvedValue(linhas),
        upsert:   jest.fn().mockResolvedValue({}),
      },
    }
    return { service: new SystemStatusService(prisma as never), prisma }
  }

  const atras = (ms: number) => new Date(Date.now() - ms)
  const achar = <T extends { id: string }>(lista: T[], id: string): T => lista.find((c) => c.id === id)!

  it('nunca-subiu: componente declarado que jamais bateu aparece na lista', async () => {
    // O caso que justifica o catálogo em const. Com auto-registro ele sumiria —
    // e some exatamente o que mais importa detectar.
    const { service } = build([])

    const status = await service.status()

    expect(status).toHaveLength(COMPONENTE_POR_ID.size)
    expect(status.every((c) => c.estado === 'nunca-subiu')).toBe(true)
  })

  it('saudavel: bateu agora, com sucesso', async () => {
    const { service } = build([
      { component: 'invariants', lastAttemptAt: atras(1000), lastSuccessAt: atras(1000), lastError: null, lastDetail: null, host: 'api-v2' },
    ])

    expect(achar(await service.status(), 'invariants').estado).toBe('saudavel')
  })

  it('falhando: tentativa recente com sucesso velho — o estado que nada mostrava antes', async () => {
    const { service } = build([
      {
        component: 'qa-scientist',
        lastAttemptAt: atras(60_000),          // tentou agora
        lastSuccessAt: atras(72 * 3_600_000),  // último sucesso há 3 dias
        lastError: 'LLM indisponivel',
        lastDetail: null, host: 'api-v2',
      },
    ])

    const c = achar(await service.status(), 'qa-scientist')
    expect(c.estado).toBe('falhando')
    expect(c.lastError).toBe('LLM indisponivel')
    // Não está atrasado: ele roda. Só não conclui.
    expect(c.atrasoMs).toBeNull()
  })

  it('sem-noticia: última tentativa fora do intervalo mais a folga', async () => {
    const guardian = COMPONENTE_POR_ID.get('guardian')!
    const { service } = build([
      { component: 'guardian', lastAttemptAt: atras(guardian.beatEveryMs + guardian.graceMs + 60_000), lastSuccessAt: atras(guardian.beatEveryMs + guardian.graceMs + 60_000), lastError: null, lastDetail: null, host: 'desktop' },
    ])

    const c = achar(await service.status(), 'guardian')
    expect(c.estado).toBe('sem-noticia')
    expect(c.atrasoMs).toBeGreaterThan(guardian.beatEveryMs)
  })

  it('a folga é por componente: 33s no Guardian é jitter, não atraso', async () => {
    // Tolerância não é proporcional — 33s num ciclo de 30s é ruído de scheduler,
    // enquanto 26h num ciclo de 24h já é sinal real. Multiplicador global erraria
    // nas duas pontas.
    const { service } = build([
      { component: 'guardian', lastAttemptAt: atras(33_000), lastSuccessAt: atras(33_000), lastError: null, lastDetail: null, host: 'desktop' },
    ])

    expect(achar(await service.status(), 'guardian').estado).toBe('saudavel')
  })

  describe('beat', () => {
    it('sucesso grava tentativa e sucesso juntos', async () => {
      const { service, prisma } = build()

      await service.beat('invariants', { ok: true, detalhe: { falhas: 0 } })

      const { create, update } = prisma.systemHeartbeat.upsert.mock.calls[0][0]
      expect(create.lastSuccessAt).toEqual(create.lastAttemptAt)
      expect(update.lastSuccessAt).toBeInstanceOf(Date)
      expect(update.lastError).toBeNull()
    })

    it('falha grava tentativa e PRESERVA o sucesso anterior', async () => {
      const { service, prisma } = build()

      await service.beat('invariants', { ok: false, erro: 'banco fora' })

      const { update } = prisma.systemHeartbeat.upsert.mock.calls[0][0]
      expect(update.lastAttemptAt).toBeInstanceOf(Date)
      // É a distância entre attempt e success que revela "roda e falha toda vez".
      expect(update).not.toHaveProperty('lastSuccessAt')
      expect(update.lastError).toBe('banco fora')
    })

    it('erro de escrita não derruba o ciclo observado', async () => {
      const { service, prisma } = build()
      prisma.systemHeartbeat.upsert.mockRejectedValue(new Error('sem banco'))

      await expect(service.beat('invariants', { ok: true })).resolves.toBeUndefined()
    })
  })

  it('problemas() é silencioso quando tudo está saudável', async () => {
    const linhas = [...COMPONENTE_POR_ID.keys()].map((component) => ({
      component, lastAttemptAt: atras(1000), lastSuccessAt: atras(1000), lastError: null, lastDetail: null, host: 'api-v2',
    }))
    const { service } = build(linhas)

    // "4 de 4 ok" em todo prompt treina a ignorar o aviso que importa.
    await expect(service.problemas()).resolves.toEqual([])
  })
})
