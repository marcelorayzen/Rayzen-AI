import { readFileSync } from 'fs'
import { join } from 'path'
import { SessionService } from '../session.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

interface Linha {
  sessionId: string
  projectId: string
  role: string
  content: string
  module: string
  createdAt: Date
}

function memoriaPersistente() {
  const linhas: Linha[] = []
  const conversationMessage = {
    createMany: jest.fn(async ({ data }: { data: Array<Omit<Linha, 'createdAt'>> }) => {
      const agora = new Date()
      linhas.push(...data.map((linha, i) => ({ ...linha, createdAt: new Date(agora.getTime() + i) })))
      return { count: data.length }
    }),
    findFirst: jest.fn(async ({ where }: { where: { role: string; projectId: string } }) => {
      return [...linhas]
        .filter((linha) => linha.role === where.role && linha.projectId === where.projectId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    }),
    findMany: jest.fn(async ({ where }: { where: { sessionId: string } }) => {
      return linhas
        .filter((linha) => linha.sessionId === where.sessionId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(({ role, content, module, createdAt }) => ({ role, content, module, createdAt }))
    }),
  }
  const event = { create: jest.fn().mockResolvedValue({}) }
  return { linhas, prisma: { conversationMessage, event } }
}

describe('continuidade do Hermes — contrato local sem provedor de modelo', () => {
  it('retoma cada projeto no próprio fio e mantém o Geral separado', async () => {
    const estado = memoriaPersistente()
    const svc = new SessionService(estado.prisma as never)

    await svc.ingerirTurnoDoHub({
      sessionId: 'hermes-projeto-a',
      projectId: 'projeto-a',
      userMessage: 'turno A',
      assistantResponse: 'resposta A',
    })
    await svc.ingerirTurnoDoHub({
      sessionId: 'hermes-projeto-b',
      projectId: 'projeto-b',
      userMessage: 'turno B',
      assistantResponse: 'resposta B',
    })
    await svc.ingerirTurnoDoHub({
      sessionId: 'hermes-geral',
      userMessage: 'turno geral',
      assistantResponse: 'resposta geral',
    })

    await expect(svc.sessaoAtual('projeto-a')).resolves.toMatchObject({
      sessionId: 'hermes-projeto-a', retomada: true,
    })
    await expect(svc.sessaoAtual('projeto-b')).resolves.toMatchObject({
      sessionId: 'hermes-projeto-b', retomada: true,
    })
    await expect(svc.sessaoAtual(null)).resolves.toMatchObject({
      sessionId: 'hermes-geral', retomada: true,
    })
    expect(estado.linhas.filter((linha) => linha.projectId === PROJETO_GERAL_ID)).toHaveLength(2)
  })

  it('ler uma sessão não mistura mensagens de outro projeto', async () => {
    const estado = memoriaPersistente()
    const svc = new SessionService(estado.prisma as never)
    await svc.ingerirTurnoDoHub({
      sessionId: 'sessao-a', projectId: 'projeto-a', userMessage: 'segredo A', assistantResponse: 'A',
    })
    await svc.ingerirTurnoDoHub({
      sessionId: 'sessao-b', projectId: 'projeto-b', userMessage: 'segredo B', assistantResponse: 'B',
    })

    const mensagensA = await svc.getSessionMessages('sessao-a')
    expect(mensagensA.map((m: { content: string }) => m.content)).toEqual(['segredo A', 'A'])
    expect(JSON.stringify(mensagensA)).not.toContain('segredo B')
  })

  it('o compose persiste todo HERMES_HOME e fixa o segredo que assina login após restart', () => {
    const compose = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'hermes', 'docker-compose.hermes.yml'),
      'utf8',
    )
    expect(compose).toMatch(/hermes-home:\/home\/hermes\/\.hermes/)
    expect(compose).toMatch(/HERMES_DASHBOARD_BASIC_AUTH_SECRET:/)
    expect(compose).toMatch(/restart:\s*unless-stopped/)
  })
})
