import { Test, TestingModule } from '@nestjs/testing'
import { SessionService } from '../session.service'
import { PrismaService } from '../../../prisma/prisma.service'

const mockPrisma = {
  conversationMessage: {
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
}

describe('SessionService', () => {
  let service: SessionService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()

    service = module.get<SessionService>(SessionService)
  })

  describe('getTokenStats', () => {
    it('retorna estatísticas de tokens corretamente', async () => {
      mockPrisma.conversationMessage.aggregate
        .mockResolvedValueOnce({ _sum: { tokensUsed: 1500 }, _count: { id: 10 } })
        .mockResolvedValueOnce({ _sum: { tokensUsed: 300 }, _count: { id: 2 } })

      mockPrisma.conversationMessage.groupBy.mockResolvedValue([
        { module: 'brain', _sum: { tokensUsed: 800 }, _count: { id: 5 } },
        { module: 'system', _sum: { tokensUsed: 700 }, _count: { id: 5 } },
      ])

      const result = await service.getTokenStats()

      expect(result.total.tokens).toBe(1500)
      expect(result.total.messages).toBe(10)
      expect(result.last24h.tokens).toBe(300)
      expect(result.byModule).toHaveLength(2)
      expect(result.byModule[0].module).toBe('brain')
    })

    it('usa 0 como fallback quando tokensUsed é null', async () => {
      mockPrisma.conversationMessage.aggregate
        .mockResolvedValueOnce({ _sum: { tokensUsed: null }, _count: { id: 0 } })
        .mockResolvedValueOnce({ _sum: { tokensUsed: null }, _count: { id: 0 } })

      mockPrisma.conversationMessage.groupBy.mockResolvedValue([])

      const result = await service.getTokenStats()

      expect(result.total.tokens).toBe(0)
      expect(result.last24h.tokens).toBe(0)
    })
  })

  describe('getRecentSessions', () => {
    it('retorna sessões com título da primeira mensagem', async () => {
      const mockSessions = [
        { sessionId: 'sess-1', _count: { id: 5 }, _max: { createdAt: new Date('2026-04-01') } },
        { sessionId: 'sess-2', _count: { id: 3 }, _max: { createdAt: new Date('2026-04-02') } },
      ]

      const mockFirstMessages = [
        { sessionId: 'sess-1', content: 'Como faço deploy no Docker?' },
        { sessionId: 'sess-2', content: 'Qual é a diferença entre NestJS e Express?' },
      ]

      mockPrisma.conversationMessage.groupBy.mockResolvedValue(mockSessions)
      mockPrisma.conversationMessage.findMany.mockResolvedValue(mockFirstMessages)

      const result = await service.getRecentSessions()

      expect(result).toHaveLength(2)
      expect(result[0].sessionId).toBe('sess-1')
      expect(result[0].title).toBe('Como faço deploy no Docker?')
      expect(result[0].messages).toBe(5)
    })

    // `conversation_messages` guarda conversa E telemetria de módulo interno. Em 19/08 eram
    // 4.459 sessões de telemetria contra 210 reais, e a primeira conversa real caía na
    // posição 661 de um corte em 20: o histórico nunca mostrava conversa nenhuma.
    it('não lista sessão sem mensagem de usuário — telemetria não é conversa', async () => {
      // nenhuma sessão tem role=user
      mockPrisma.conversationMessage.findMany.mockResolvedValueOnce([])

      const result = await service.getRecentSessions()

      expect(result).toEqual([])
      // e nem chega a agrupar: sem interlocutor humano não há o que listar
      expect(mockPrisma.conversationMessage.groupBy).not.toHaveBeenCalled()
    })

    it('agrupa apenas as sessões que têm mensagem de usuário', async () => {
      mockPrisma.conversationMessage.findMany
        .mockResolvedValueOnce([{ sessionId: 'conversa-1' }])                       // filtro role=user
        .mockResolvedValueOnce([{ sessionId: 'conversa-1', content: 'oi' }])        // títulos
      mockPrisma.conversationMessage.groupBy.mockResolvedValue([
        { sessionId: 'conversa-1', _count: { id: 4 }, _max: { createdAt: new Date() } },
      ])

      const result = await service.getRecentSessions()

      expect(result).toHaveLength(1)
      // a regressão que este teste barra: agrupar a tabela inteira, sem escopo
      const where = mockPrisma.conversationMessage.groupBy.mock.calls[0][0].where
      expect(where).toEqual({ sessionId: { in: ['conversa-1'] } })
    })

    it('o corte respeita o limite DEPOIS do filtro, não antes', async () => {
      // 4 sessões humanas entre milhares de telemetria: todas as 4 devem sobreviver
      const humanas = ['c1', 'c2', 'c3', 'c4']
      mockPrisma.conversationMessage.findMany
        .mockResolvedValueOnce(humanas.map((sessionId) => ({ sessionId })))
        .mockResolvedValueOnce(humanas.map((sessionId) => ({ sessionId, content: `pergunta ${sessionId}` })))
      mockPrisma.conversationMessage.groupBy.mockResolvedValue(
        humanas.map((sessionId) => ({ sessionId, _count: { id: 2 }, _max: { createdAt: new Date() } })),
      )

      const result = await service.getRecentSessions()

      expect(result.map((r) => r.sessionId)).toEqual(humanas)
      expect(result.every((r) => r.title !== 'Conversa')).toBe(true)
    })

    it('mantém "Conversa" como fallback de título de sessão humana sem primeira mensagem', async () => {
      mockPrisma.conversationMessage.findMany
        .mockResolvedValueOnce([{ sessionId: 'sess-1' }])
        .mockResolvedValueOnce([])   // título não encontrado
      mockPrisma.conversationMessage.groupBy.mockResolvedValue([
        { sessionId: 'sess-1', _count: { id: 1 }, _max: { createdAt: new Date() } },
      ])

      const result = await service.getRecentSessions()

      expect(result[0].title).toBe('Conversa')
    })

    it('trunca título em 50 caracteres', async () => {
      const longTitle = 'A'.repeat(100)
      mockPrisma.conversationMessage.groupBy.mockResolvedValue([
        { sessionId: 'sess-1', _count: { id: 1 }, _max: { createdAt: new Date() } },
      ])
      mockPrisma.conversationMessage.findMany.mockResolvedValue([
        { sessionId: 'sess-1', content: longTitle },
      ])

      const result = await service.getRecentSessions()

      expect(result[0].title).toHaveLength(50)
    })
  })

  describe('deleteSession', () => {
    it('chama deleteMany com sessionId correto', async () => {
      mockPrisma.conversationMessage.deleteMany.mockResolvedValue({ count: 3 })

      const result = await service.deleteSession('sess-abc')

      expect(mockPrisma.conversationMessage.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 'sess-abc' },
      })
      expect(result).toEqual({ deleted: true })
    })
  })
})
