import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { BlueprintService } from '../blueprint.service'
import { WikiService } from '../../wiki/wiki.service'
import { BrainService } from '../../brain/brain.service'
import { EventService } from '../../event/event.service'
import { ProjectStateService } from '../../project-state/project-state.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { BlueprintFormat, BlueprintSource } from '../dto/import-blueprint.dto'

const PROJECT_ID = 'proj-test-123'

const mockPrisma = {
  project: { findUnique: jest.fn() },
  wikiPage: { findFirst: jest.fn() },
}

const mockWiki = { create: jest.fn() }
const mockBrain = { indexText: jest.fn() }
const mockEvent = { create: jest.fn() }
const mockState = { updatePlanning: jest.fn() }

describe('BlueprintService', () => {
  let service: BlueprintService

  beforeEach(async () => {
    jest.clearAllMocks()

    mockPrisma.project.findUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project' })
    mockPrisma.wikiPage.findFirst.mockResolvedValue(null)
    mockWiki.create.mockResolvedValue({ id: 'wiki-1', slug: 'blueprint-test' })
    mockBrain.indexText.mockResolvedValue({ indexed: 2, documentIds: ['doc-1', 'doc-2'] })
    mockEvent.create.mockResolvedValue({ id: 'ev-1' })
    mockState.updatePlanning.mockResolvedValue({})

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlueprintService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WikiService, useValue: mockWiki },
        { provide: BrainService, useValue: mockBrain },
        { provide: EventService, useValue: mockEvent },
        { provide: ProjectStateService, useValue: mockState },
      ],
    }).compile()

    service = module.get<BlueprintService>(BlueprintService)
  })

  // ─── preview ──────────────────────────────────────────────────────────────────

  describe('preview', () => {
    it('retorna seções e sugestões sem chamar métodos de escrita', async () => {
      const result = await service.preview({
        title: 'Meu Plano',
        content: '## Arquitetura\n\nConteúdo.\n\n- Implementar módulo',
        format: BlueprintFormat.MARKDOWN,
      })

      expect(result.detectedSections).toContain('Arquitetura')
      expect(result.suggestedWikiPages.length).toBeGreaterThan(0)
      expect(mockWiki.create).not.toHaveBeenCalled()
      expect(mockBrain.indexText).not.toHaveBeenCalled()
      expect(mockEvent.create).not.toHaveBeenCalled()
      expect(mockState.updatePlanning).not.toHaveBeenCalled()
    })

    it('lança BadRequestException para conteúdo vazio', async () => {
      await expect(
        service.preview({ title: 'T', content: '   ', format: BlueprintFormat.MARKDOWN }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ─── import ───────────────────────────────────────────────────────────────────

  describe('import', () => {
    const baseDto = {
      projectId: PROJECT_ID,
      source: BlueprintSource.CLAUDE,
      title: 'Plano de Feature',
      content: '## Arquitetura\n\nConteúdo detalhado.\n\n- Implementar autenticação\n- Adicionar testes',
      format: BlueprintFormat.MARKDOWN,
    }

    it('chama wiki, brain, events e planning com todas as options true', async () => {
      const result = await service.import({ ...baseDto, options: {} })

      expect(result.ok).toBe(true)
      expect(mockWiki.create).toHaveBeenCalled()
      expect(mockBrain.indexText).toHaveBeenCalled()
      expect(mockEvent.create).toHaveBeenCalled()
      expect(result.updated.brain).toBe(true)
    })

    it('não chama WikiService quando saveToWiki = false', async () => {
      await service.import({ ...baseDto, options: { saveToWiki: false } })
      expect(mockWiki.create).not.toHaveBeenCalled()
    })

    it('não chama BrainService quando indexInBrain = false', async () => {
      await service.import({ ...baseDto, options: { indexInBrain: false } })
      expect(mockBrain.indexText).not.toHaveBeenCalled()
    })

    it('não chama EventService quando createEvents = false', async () => {
      await service.import({ ...baseDto, options: { createEvents: false } })
      expect(mockEvent.create).not.toHaveBeenCalled()
    })

    it('não chama updatePlanning quando updateProjectState = false', async () => {
      await service.import({ ...baseDto, options: { updateProjectState: false } })
      expect(mockState.updatePlanning).not.toHaveBeenCalled()
    })

    it('lança NotFoundException para projectId inválido', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null)
      await expect(service.import({ ...baseDto })).rejects.toThrow(NotFoundException)
    })

    it('lança BadRequestException para content vazio', async () => {
      await expect(
        service.import({ ...baseDto, content: '  ' }),
      ).rejects.toThrow(BadRequestException)
    })

    it('adiciona warning quando wiki já existe e overwriteWiki = false', async () => {
      mockPrisma.wikiPage.findFirst.mockResolvedValue({ id: 'existing', slug: 'blueprint-plano-de-feature' })
      const result = await service.import({ ...baseDto })
      expect(result.warnings.some((w) => w.includes('já existe'))).toBe(true)
      expect(mockWiki.create).not.toHaveBeenCalledWith(
        expect.stringContaining('blueprint-plano-de-feature'),
        expect.anything(),
        expect.anything(),
      )
    })

    it('retorna documentIds do Brain no created.documents', async () => {
      const result = await service.import({ ...baseDto })
      expect(result.created.documents).toContain('doc-1')
      expect(result.created.documents).toContain('doc-2')
    })

    it('adiciona warning sem rejeitar quando Brain falha', async () => {
      mockBrain.indexText.mockRejectedValue(new Error('Jina API indisponível'))
      const result = await service.import({ ...baseDto })
      expect(result.ok).toBe(true)
      expect(result.warnings.some((w) => w.includes('Brain indexing falhou'))).toBe(true)
    })
  })
})
