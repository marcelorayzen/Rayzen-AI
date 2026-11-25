import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { OrchestratorService } from '../orchestrator.service'
import { MemoryService } from '../../memory/memory.service'
import { DocumentProcessingService } from '../../document-processing/document-processing.service'
import { ExecutionService } from '../../execution/execution.service'
import { ContentEngineService } from '../../content-engine/content-engine.service'
import { RayzenConfigService } from '../../configuration/configuration.service'
import { ValidationService } from '../../validation/validation.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { EventService } from '../../event/event.service'
import { MetricsService } from '../../metrics/metrics.service'
import { AgentSessionService } from '../../agent-session/agent-session.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

/**
 * ── Escreve-se NO Geral, busca-se FORA dele ─────────────────────────────────
 *
 * A decisão de 18/09 tem duas metades, e o orquestrador só tinha uma. `escopoDeBusca` já devolvia
 * `undefined` no geral — de propósito, é o que faz a busca varrer o acervo inteiro. A ESCRITA
 * gravava `projectId` cru, ou seja `NULL`.
 *
 * O estrago não é o invariante vermelho: `sessaoAtual` procura o fio do geral por
 * `projectId = PROJETO_GERAL_ID`, que é como o HUB grava. Escrito num endereço e procurado em
 * outro, **a conversa geral da web nunca reencontrava o próprio fio** — a política unificada em
 * 18/09 falhando justamente no escopo que aquela decisão criou.
 *
 * Medido em produção antes de mexer: 7 linhas de usuário no Geral, todas do HUB, zero do
 * orquestrador.
 */

const mockLLM = { chat: { completions: { create: jest.fn() } } }
jest.mock('openai', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => mockLLM) }))

const mockPrisma = {
  conversationMessage: {
    findFirst:  jest.fn().mockResolvedValue(null),
    findMany:   jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({}),
  },
  project:      { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  projectState: { findFirst:  jest.fn().mockResolvedValue(null) },
  projectGoal:  { findFirst:  jest.fn().mockResolvedValue(null) },
  event:        { findMany:   jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
}

describe('orquestrador: onde REGISTRAR × onde BUSCAR', () => {
  let service: OrchestratorService
  let eventService: { create: jest.Mock }
  let memoryService: { search: jest.Mock; indexDocument: jest.Mock; searchAndSynthesize: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockPrisma.conversationMessage.findFirst.mockResolvedValue(null)
    mockPrisma.conversationMessage.findMany.mockResolvedValue([])

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('mock-key') } },
        { provide: MemoryService, useValue: {
          searchAndSynthesize: jest.fn().mockResolvedValue({ answer: 'ok', sources: [] }),
          search: jest.fn().mockResolvedValue([]),
          indexDocument: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: DocumentProcessingService, useValue: { generatePDF: jest.fn() } },
        { provide: ExecutionService, useValue: { dispatch: jest.fn() } },
        { provide: ContentEngineService, useValue: { generate: jest.fn(), generateCalendar: jest.fn() } },
        { provide: RayzenConfigService, useValue: { getConfig: jest.fn().mockReturnValue(null) } },
        { provide: ValidationService, useValue: {
          assertValidPrompt: jest.fn(),
          validateClassification: jest.fn().mockReturnValue({ valid: true, issues: [], score: 1 }),
        } },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: MetricsService, useValue: {
          llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() },
        } },
        { provide: AgentSessionService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile()

    service       = mod.get(OrchestratorService)
    eventService  = mod.get(EventService)
    memoryService = mod.get(MemoryService)
  })

  /** Classifica como chat comum e responde — o caminho que grava conversa e evento. */
  const conversaComum = () => {
    mockLLM.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"module":"system","action":"chat","confidence":0.9}' } }],
        usage: { total_tokens: 10 },
      })
      .mockResolvedValue({
        choices: [{ message: { content: 'resposta' } }],
        usage: { total_tokens: 20 },
      })
  }

  const donosGravados = () =>
    mockPrisma.conversationMessage.createMany.mock.calls
      .flatMap((c) => (c[0] as { data: Array<{ projectId: unknown }> }).data)
      .map((l) => l.projectId)

  describe('sem projeto — o contexto geral', () => {
    it('a conversa é gravada NO Geral, nunca órfã', async () => {
      conversaComum()
      await service.handleMessage('olá', 'sess-1')

      const donos = donosGravados()
      expect(donos.length).toBeGreaterThan(0)
      expect(donos.every((d) => d === PROJETO_GERAL_ID)).toBe(true)
      expect(donos).not.toContain(undefined)
      expect(donos).not.toContain(null)
    })

    it('o evento de chat também', async () => {
      conversaComum()
      await service.handleMessage('olá', 'sess-1')

      expect(eventService.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJETO_GERAL_ID, source: 'chat' }),
      )
    })

    /**
     * ── O que esta asserção pega, MEDIDO, e o que ela não pega ──────────────
     *
     * Eu escrevi aqui que ela impediria o "conserto óbvio" de normalizar `projectId` no topo do
     * método. **Falso, e conferido:** com essa mutação os seis casos passam, porque
     * `escopoDeBusca(PROJETO_GERAL_ID)` já devolve `undefined` — os helpers absorvem o Geral de
     * propósito. Deixar o comentário de pé seria enunciado sem mecanismo, que é o defeito que
     * esta casa mais repete.
     *
     * O que ela pega de verdade, validado trocando as duas chamadas: usar `donoDoRegistro`
     * (escopo de ESCRITA) numa leitura. Aí a busca do contexto geral passa a varrer só o próprio
     * Geral — quase nada — e ele fica PIOR do que era como ausência. É a regressão realista,
     * porque a constante nova está ali ao lado, tentadora.
     */
    it('mas a BUSCA continua sem escopo — é o que dá acervo inteiro ao geral', async () => {
      conversaComum()
      await service.handleMessage('olá', 'sess-1')

      for (const chamada of memoryService.search.mock.calls) {
        expect(chamada[2]).toBeUndefined()
      }
    })
  })

  describe('com projeto real', () => {
    it('grava no projeto, e o Geral não se mete', async () => {
      conversaComum()
      await service.handleMessage('olá', 'sess-1', 'projeto-real')

      expect(donosGravados().every((d) => d === 'projeto-real')).toBe(true)
      expect(eventService.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'projeto-real' }),
      )
    })

    it('e a busca é escopada nele', async () => {
      conversaComum()
      await service.handleMessage('olá', 'sess-1', 'projeto-real')

      for (const chamada of memoryService.search.mock.calls) {
        expect(chamada[2]).toBe('projeto-real')
      }
    })
  })

  describe('streamChat grava pela mesma regra', () => {
    it('sem projeto, o fio do streaming também mora no Geral', async () => {
      mockLLM.chat.completions.create.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'oi' } }] }
        },
      })

      await service.streamChat('olá', 'sess-1', 'system', () => undefined)

      expect(donosGravados().every((d) => d === PROJETO_GERAL_ID)).toBe(true)
      expect(eventService.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJETO_GERAL_ID, source: 'chat' }),
      )
    })
  })
})
