import { ConflictException, ForbiddenException, HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { AprovacaoPeloHubController } from '../aprovacao-pelo-hub.controller'
import { AprovacaoPeloHubService, MAX_FALHAS } from '../aprovacao-pelo-hub.service'
import { hotp, base32ParaBytes } from '../totp'

/**
 * Aprovar envelope pelo Hub (13/11). Cada teste é uma forma de a porta abrir sem a pessoa:
 * agent se autoaprovando, segredo ausente, força bruta, código reaproveitado, envelope trocado
 * entre ver e aprovar.
 */
const SEGREDO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const T0 = 1_800_000_000_000
const codigoEm = (ms: number) => hotp(base32ParaBytes(SEGREDO), Math.floor(ms / 30_000))

function montar(linha: Record<string, unknown> = {}) {
  let agora = T0
  const handoff = { id: 'h1', status: 'awaiting_approval', contentHash: 'hash-visto', ...linha }
  const handoffs = {
    buscar: jest.fn().mockResolvedValue(handoff),
    aprovar: jest.fn().mockResolvedValue({ ...handoff, status: 'approved' }),
    materializar: jest.fn().mockResolvedValue({ taskId: 't1' }),
    rejeitar: jest.fn().mockResolvedValue({ status: 'rejected' }),
  }
  const prisma = { projectHandoff: { findMany: jest.fn().mockResolvedValue([]) } }
  const service = new AprovacaoPeloHubService(prisma as never, handoffs as never, () => agora)
  return { service, handoffs, prisma, avancar: (ms: number) => { agora += ms }, agora: () => agora }
}

describe('aprovação de envelope pelo Hub', () => {
  const original = process.env.APPROVAL_TOTP_SECRET
  beforeEach(() => { process.env.APPROVAL_TOTP_SECRET = SEGREDO })
  afterAll(() => { process.env.APPROVAL_TOTP_SECRET = original })

  it('código certo + hash visto: aprova com identidade totp e materializa', async () => {
    const { service, handoffs } = montar()
    const r = await service.aprovar('h1', { id: 'user:marcelo' }, codigoEm(T0), 'hash-visto')
    expect(r).toMatchObject({ aprovado: true, materializado: true })
    const [, principal] = handoffs.aprovar.mock.calls[0]
    expect(principal.type).toBe('totp')
    expect(principal.id).toMatch(/^totp:[0-9a-f]{12}$/)
    expect(principal.id).not.toContain('marcelo') // identidade derivada, sem expor o login
  })

  it('o AGENT (principal service) é recusado antes de qualquer outra coisa', () => {
    const { service, handoffs } = montar()
    const envelopes = { resumo: jest.fn(), descartar: jest.fn(), materializar: jest.fn() }
    const controller = new AprovacaoPeloHubController(service, envelopes as never)
    const agent = { headers: {}, rayzenPrincipal: { id: 'service:agent', type: 'service' as const } }
    expect(() => controller.aprovar('h1', { codigo: codigoEm(T0), contentHash: 'hash-visto' }, agent)).toThrow(ForbiddenException)
    expect(() => controller.pendentes(undefined, agent)).toThrow(ForbiddenException)
    // As portas novas do S1 também: descartar e retomar mudam estado, e o resumo é da pessoa.
    expect(() => controller.descartar('h1', agent)).toThrow(ForbiddenException)
    expect(() => controller.resumo(undefined, agent)).toThrow(ForbiddenException)
    return expect(controller.retomar('h1', agent)).rejects.toThrow(ForbiddenException).then(() => {
      expect(envelopes.descartar).not.toHaveBeenCalled()
      expect(envelopes.materializar).not.toHaveBeenCalled()
    })
    expect(handoffs.aprovar).not.toHaveBeenCalled()
  })

  it('sem APPROVAL_TOTP_SECRET a porta FECHA', async () => {
    delete process.env.APPROVAL_TOTP_SECRET
    const { service, handoffs } = montar()
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(T0), 'hash-visto')).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(handoffs.aprovar).not.toHaveBeenCalled()
  })

  it('envelope mudou entre ver e aprovar: 409, e o código NÃO é gasto', async () => {
    const { service, handoffs } = montar({ contentHash: 'hash-novo' })
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(T0), 'hash-visto')).rejects.toBeInstanceOf(ConflictException)
    expect(handoffs.aprovar).not.toHaveBeenCalled()
  })

  it('envelope que não está aguardando aprovação: 409', async () => {
    const { service } = montar({ status: 'approved' })
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(T0), 'hash-visto')).rejects.toBeInstanceOf(ConflictException)
  })

  it('código errado: 401 e nada aprovado', async () => {
    const { service, handoffs } = montar()
    await expect(service.aprovar('h1', { id: 'u' }, '000000', 'hash-visto')).rejects.toBeInstanceOf(UnauthorizedException)
    expect(handoffs.aprovar).not.toHaveBeenCalled()
  })

  it('o mesmo código não serve duas vezes', async () => {
    const { service } = montar()
    const codigo = codigoEm(T0)
    await service.aprovar('h1', { id: 'u' }, codigo, 'hash-visto')
    await expect(service.aprovar('h1', { id: 'u' }, codigo, 'hash-visto')).rejects.toThrow(/já foi usado/)
  })

  it(`depois de ${MAX_FALHAS} erros, até o código CERTO é recusado por 15 min`, async () => {
    const { service, handoffs, avancar, agora } = montar()
    for (let i = 0; i < MAX_FALHAS; i++) {
      await expect(service.aprovar('h1', { id: 'u' }, '000000', 'hash-visto')).rejects.toBeInstanceOf(UnauthorizedException)
    }
    const bloqueado = service.aprovar('h1', { id: 'u' }, codigoEm(agora()), 'hash-visto')
    await expect(bloqueado).rejects.toBeInstanceOf(HttpException)
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(agora()), 'hash-visto')).rejects.toThrow(/Muitas tentativas/)
    expect(handoffs.aprovar).not.toHaveBeenCalled()

    avancar(15 * 60 * 1000 + 1)
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(agora()), 'hash-visto')).resolves.toMatchObject({ aprovado: true })
  })

  it('materialização que falha não desfaz a aprovação — é dita', async () => {
    const { service, handoffs } = montar()
    handoffs.materializar.mockRejectedValue(new Error('agent desligado'))
    await expect(service.aprovar('h1', { id: 'u' }, codigoEm(T0), 'hash-visto'))
      .resolves.toMatchObject({ aprovado: true, materializado: false, motivo: 'agent desligado' })
  })

  it('pendentes filtra por estado e pelo projeto de origem', async () => {
    const { service, prisma } = montar()
    await service.pendentes('proj-1')
    expect(prisma.projectHandoff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'awaiting_approval', sourceProjectId: 'proj-1' },
    }))
  })
})

describe('aprovação pelo Hub — o código só no nível crítico (S1)', () => {
  const original = process.env.APPROVAL_TOTP_SECRET
  beforeEach(() => { process.env.APPROVAL_TOTP_SECRET = SEGREDO })
  afterAll(() => { process.env.APPROVAL_TOTP_SECRET = original })

  it('envelope que propõe aprova com um toque, com a pessoa como principal', async () => {
    const { service, handoffs } = montar({ effects: [{ actionKey: 'jarvis:create_project_folder', payload: {} }] })
    const r = await service.aprovar('h1', { id: 'user:marcelo' }, undefined, 'hash-visto')
    expect(r).toMatchObject({ aprovado: true, alcada: 'propoe', materializado: true })
    const [, principal] = handoffs.aprovar.mock.calls[0]
    expect(principal.type).toBe('human')
    expect(principal.id).toMatch(/^hub:[0-9a-f]{12}$/)
  })

  it('envelope crítico sem código é recusado, sem gastar tentativa', async () => {
    const { service, handoffs } = montar({ effects: [{ actionKey: 'jarvis:file_delete', payload: {} }] })
    for (let i = 0; i < MAX_FALHAS + 1; i++) {
      await expect(service.aprovar('h1', { id: 'user:marcelo' }, undefined, 'hash-visto')).rejects.toThrow(/obrigatório/)
    }
    // Depois de várias recusas por ausência, o código certo ainda passa: nada contou como força bruta.
    await expect(service.aprovar('h1', { id: 'user:marcelo' }, codigoEm(T0), 'hash-visto')).resolves.toMatchObject({ alcada: 'critico' })
    expect(handoffs.aprovar.mock.calls[0][1].type).toBe('totp')
  })

  it('envelope sem efeitos legíveis é tratado como crítico', async () => {
    const { service } = montar({ effects: null })
    await expect(service.aprovar('h1', { id: 'user:marcelo' }, undefined, 'hash-visto')).rejects.toThrow(/obrigatório/)
  })

  it('a lista de pendentes diz ao card qual é a alçada', async () => {
    const { service, prisma } = montar()
    prisma.projectHandoff.findMany.mockResolvedValue([
      { id: 'a', effects: [{ actionKey: 'jarvis:create_project_folder' }] },
      { id: 'b', effects: [{ actionKey: 'jarvis:prisma_migrate' }] },
    ])
    const lista = await service.pendentes()
    expect(lista.map((p) => p.alcada)).toEqual(['propoe', 'critico'])
  })
})
