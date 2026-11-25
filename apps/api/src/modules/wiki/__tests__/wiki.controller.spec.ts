import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { WikiController } from '../wiki.controller'
import { WikiService } from '../wiki.service'

const mockPage = {
  id: 'page-1',
  slug: 'bullmq-retry-strategy',
  title: 'BullMQ Retry Strategy',
  tags: ['queue', 'redis'],
  contentMd: '## Resumo\nConteúdo.',
  related: [],
  editStatus: 'generated',
  compiledAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockWikiService = {
  index: jest.fn(),
  list: jest.fn(),
  getBySlug: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  listVersions: jest.fn(),
  listSources: jest.fn(),
}

describe('WikiController', () => {
  let controller: WikiController

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WikiController],
      providers: [{ provide: WikiService, useValue: mockWikiService }],
    }).compile()
    controller = module.get<WikiController>(WikiController)
  })

  describe('POST /wiki/index', () => {
    it('calls service.index with dto and force=false by default', async () => {
      mockWikiService.index.mockResolvedValue({ pageId: 'page-1', slug: 'bullmq-retry-strategy', title: 'BullMQ', status: 'created' })

      await controller.index({ type: 'text', source: 'content' })

      expect(mockWikiService.index).toHaveBeenCalledWith(
        { type: 'text', source: 'content' },
        false,
      )
    })

    it('passes force=true when query param is "true"', async () => {
      mockWikiService.index.mockResolvedValue({})
      await controller.index({ type: 'text', source: 'content' }, 'true')
      expect(mockWikiService.index).toHaveBeenCalledWith(expect.anything(), true)
    })
  })

  describe('GET /wiki', () => {
    it('returns list of wiki pages', async () => {
      mockWikiService.list.mockResolvedValue([mockPage])
      const result = await controller.list()
      expect(result).toHaveLength(1)
      expect(result[0].slug).toBe('bullmq-retry-strategy')
    })
  })

  describe('GET /wiki/:slug', () => {
    it('returns page detail', async () => {
      mockWikiService.getBySlug.mockResolvedValue({ ...mockPage, versions: [], sources: [] })
      const result = await controller.getBySlug('bullmq-retry-strategy')
      expect(result.slug).toBe('bullmq-retry-strategy')
    })

    it('propagates NotFoundException from service', async () => {
      mockWikiService.getBySlug.mockRejectedValue(new NotFoundException())
      await expect(controller.getBySlug('nao-existe')).rejects.toThrow(NotFoundException)
    })
  })

  describe('PUT /wiki/:slug', () => {
    it('calls service.update and returns updated page', async () => {
      mockWikiService.update.mockResolvedValue({ ...mockPage, editStatus: 'human_edited' })
      const result = await controller.update('bullmq-retry-strategy', { contentMd: '## Novo' })
      expect(result.editStatus).toBe('human_edited')
    })
  })

  describe('DELETE /wiki/:slug', () => {
    it('returns deleted: true', async () => {
      mockWikiService.delete.mockResolvedValue({ deleted: true })
      const result = await controller.delete('bullmq-retry-strategy')
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('GET /wiki/:slug/versions', () => {
    it('returns version list', async () => {
      mockWikiService.listVersions.mockResolvedValue([{ id: 'ver-1', reason: 'compiled' }])
      const result = await controller.versions('bullmq-retry-strategy')
      expect(result[0].reason).toBe('compiled')
    })
  })

  describe('GET /wiki/:slug/sources', () => {
    it('returns source references', async () => {
      mockWikiService.listSources.mockResolvedValue([{ id: 'ref-1', relevanceScore: 0.9 }])
      const result = await controller.sources('bullmq-retry-strategy')
      expect(result[0].relevanceScore).toBe(0.9)
    })
  })
})
