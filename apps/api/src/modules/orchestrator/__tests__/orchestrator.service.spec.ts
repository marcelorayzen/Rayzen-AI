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

const mockLLM = {
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
}

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockLLM),
}))

const mockPrisma = {
  conversationMessage: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    createMany: jest.fn().mockResolvedValue({}),
  },
}

describe('OrchestratorService', () => {
  let service: OrchestratorService
  let memoryService: jest.Mocked<MemoryService>
  let executionService: jest.Mocked<ExecutionService>
  let contentEngineService: jest.Mocked<ContentEngineService>
  let validationService: jest.Mocked<ValidationService>

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('mock-key') },
        },
        {
          provide: MemoryService,
          useValue: {
            searchAndSynthesize: jest.fn(),
            search: jest.fn().mockResolvedValue([]),
            indexDocument: jest.fn(),
          },
        },
        {
          provide: DocumentProcessingService,
          useValue: { generatePDF: jest.fn() },
        },
        {
          provide: ExecutionService,
          useValue: { dispatch: jest.fn() },
        },
        {
          provide: ContentEngineService,
          useValue: {
            generate: jest.fn(),
            generateCalendar: jest.fn(),
          },
        },
        {
          provide: RayzenConfigService,
          useValue: { getConfig: jest.fn().mockReturnValue(null) },
        },
        {
          provide: ValidationService,
          useValue: {
            assertValidPrompt: jest.fn(),
            validateClassification: jest.fn().mockReturnValue({ valid: true, issues: [], score: 1 }),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: MetricsService,
          useValue: {
            llmTokensTotal: { inc: jest.fn() },
            llmRequestDuration: { observe: jest.fn() },
          },
        },
      ],
    }).compile()

    service = module.get<OrchestratorService>(OrchestratorService)
    memoryService = module.get(MemoryService)
    executionService = module.get(ExecutionService)
    contentEngineService = module.get(ContentEngineService)
    validationService = module.get(ValidationService)
  })

  describe('classify', () => {
    it('retorna classificação do LLM corretamente', async () => {
      mockLLM.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"module":"brain","action":"search","confidence":0.9}' } }],
        usage: { total_tokens: 50 },
      })

      const result = await service.classify('O que você sabe sobre mim?')

      expect(result.module).toBe('brain')
      expect(result.action).toBe('search')
      expect(result.confidence).toBe(0.9)
    })

    it('usa temperature 0 e não envia response_format (ADR 011)', async () => {
      mockLLM.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"module":"system","action":"chat","confidence":0.8}' } }],
        usage: { total_tokens: 30 },
      })

      await service.classify('olá')

      const call = mockLLM.chat.completions.create.mock.calls[0][0]
      expect(call.temperature).toBe(0)
      expect(call.response_format).toBeUndefined()
    })

    it('mantém perguntas de orientação fora do Jarvis sem chamar o LLM', async () => {
      const result = await service.classify('como devo adicionar um projeto novo?')

      expect(result.module).toBe('system')
      expect(result.action).toBe('answer')
      expect(mockLLM.chat.completions.create).not.toHaveBeenCalled()
    })

    it('roteia pedido de print da tela diretamente para screenshot sem chamar o LLM', async () => {
      const result = await service.classify('tire um print da tela: teste de vinculo evidence test run')

      expect(result.module).toBe('jarvis')
      expect(result.action).toBe('screenshot')
      expect(result.confidence).toBe(1)
      expect(mockLLM.chat.completions.create).not.toHaveBeenCalled()
    })

    it('mantem pergunta de como tirar print como orientacao, nao execucao', async () => {
      const result = await service.classify('como faco para tirar print no Windows?')

      expect(result.module).toBe('system')
      expect(result.action).toBe('answer')
      expect(mockLLM.chat.completions.create).not.toHaveBeenCalled()
    })

    it('rebaixa classificação jarvis sem comando explícito para system', async () => {
      mockLLM.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"module":"jarvis","action":"create_project_folder","confidence":0.91}' } }],
        usage: { total_tokens: 30 },
      })

      const result = await service.classify('preciso adicionar um projeto novo no fluxo')

      expect(result.module).toBe('system')
      expect(result.action).toBe('answer')
    })
  })

  describe('handleMessage — routing', () => {
    it('delega para MemoryService quando módulo é brain', async () => {
      mockLLM.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"module":"brain","action":"search","confidence":0.9}' } }],
        usage: { total_tokens: 50 },
      })

      ;(memoryService.searchAndSynthesize as jest.Mock).mockResolvedValue({
        answer: 'Você é Marcelo Rayzen, QA Engineer.',
        sources: [],
        tokensUsed: 100,
      })

      const result = await service.handleMessage('Quem sou eu?', 'sess-1')

      expect(memoryService.searchAndSynthesize).toHaveBeenCalledWith('Quem sou eu?', 'sess-1', undefined)
      expect(result.module).toBe('brain')
      expect(result.reply).toBe('Você é Marcelo Rayzen, QA Engineer.')
    })

    it('mostra confirmacao de screenshot sem JSON interno', async () => {
      const result = await service.handleMessage('tire um print da tela: teste de vinculo evidence test run', 'sess-shot')

      expect(executionService.dispatch).not.toHaveBeenCalled()
      expect(result.module).toBe('jarvis')
      expect(result.action).toBe('screenshot')
      expect(result.reply).toContain('evid')
      expect(result.reply).toContain('Fluxo QA')
      expect(result.reply).toContain('Screenshot')
      expect(result.reply).toContain('teste de vinculo evidence test run')
      expect(result.reply).toContain('TestRun')
      expect(result.reply).toContain('documenta')
      expect(result.reply).toContain('[ACTION_PENDING:')
      expect(result.reply).not.toContain('Par')
      expect(result.reply).not.toContain('"projectId"')
    })

    it('delega para ExecutionService quando módulo é jarvis', async () => {
      mockLLM.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"module":"jarvis","action":"open_app","confidence":0.95}' } }],
          usage: { total_tokens: 40 },
        })

      ;(executionService.dispatch as jest.Mock).mockResolvedValue({ ok: true })

      const result = await service.handleMessage('abre o chrome', 'sess-2')

      expect(executionService.dispatch).not.toHaveBeenCalled()
      expect(result.module).toBe('jarvis')
      expect(result.reply).toContain('[ACTION_PENDING:')
      expect(result.reply).toContain('Open App')
    })

    it('executa acao jarvis pendente apos confirmacao', async () => {
      const pending = Buffer.from(JSON.stringify({
        action: 'open_app',
        payload: { app: 'chrome' },
        prompt: 'abre o chrome',
        risk: 'medium',
      })).toString('base64')
      mockPrisma.conversationMessage.findFirst
        .mockResolvedValueOnce({ content: `[ACTION_PENDING:${pending}]` })
        .mockResolvedValueOnce({ content: `[ACTION_PENDING:${pending}]` })
      mockLLM.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Chrome aberto com sucesso.' } }],
        usage: { total_tokens: 60 },
      })
      ;(executionService.dispatch as jest.Mock).mockResolvedValue({ ok: true })

      const result = await service.handleMessage('confirmar', 'sess-2')

      expect(executionService.dispatch).toHaveBeenCalledWith('open_app', { app: 'chrome' })
      expect(result.reply).toBe('Chrome aberto com sucesso.')
    })

    it('valida o prompt antes de processar', async () => {
      mockLLM.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"module":"system","action":"chat","confidence":0.8}' } }],
          usage: { total_tokens: 30 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Olá!' } }],
          usage: { total_tokens: 20 },
        })

      mockPrisma.conversationMessage.findMany.mockResolvedValue([])

      await service.handleMessage('olá', 'sess-3')

      expect(validationService.assertValidPrompt).toHaveBeenCalledWith('olá')
    })
  })
})
