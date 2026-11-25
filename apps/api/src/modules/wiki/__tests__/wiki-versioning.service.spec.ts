import { Test, TestingModule } from '@nestjs/testing'
import { WikiVersioningService } from '../wiki-versioning.service'
import { PrismaService } from '../../../prisma/prisma.service'

const version = {
  id: 'ver-1',
  pageId: 'page-1',
  contentMd: '## Resumo\nConteúdo.',
  reason: 'compiled',
  authorType: 'llm',
  diff: null,
  createdAt: new Date(),
}

const mockPrisma = {
  wikiPageVersion: {
    create: jest.fn().mockResolvedValue(version),
    findMany: jest.fn().mockResolvedValue([version]),
    findUnique: jest.fn().mockResolvedValue(version),
  },
}

describe('WikiVersioningService', () => {
  let service: WikiVersioningService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WikiVersioningService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get<WikiVersioningService>(WikiVersioningService)
  })

  describe('createVersion', () => {
    it('creates a version with correct fields', async () => {
      const result = await service.createVersion({
        pageId: 'page-1',
        contentMd: '## Resumo\nConteúdo.',
        reason: 'compiled',
        authorType: 'llm',
      })

      expect(mockPrisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pageId: 'page-1',
          reason: 'compiled',
          authorType: 'llm',
          diff: null,
        }),
      })
      expect(result.id).toBe('ver-1')
    })

    it('stores diff when provided', async () => {
      await service.createVersion({
        pageId: 'page-1',
        contentMd: 'new content',
        reason: 'recompiled',
        authorType: 'llm',
        diff: '+3 linhas, -1 linha',
      })

      expect(mockPrisma.wikiPageVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ diff: '+3 linhas, -1 linha' }),
      })
    })
  })

  describe('listVersions', () => {
    it('returns versions ordered by date', async () => {
      const result = await service.listVersions('page-1')
      expect(mockPrisma.wikiPageVersion.findMany).toHaveBeenCalledWith({
        where: { pageId: 'page-1' },
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toHaveLength(1)
    })
  })

  describe('getVersion', () => {
    it('returns version by id', async () => {
      const result = await service.getVersion('ver-1')
      expect(result?.id).toBe('ver-1')
    })

    it('returns null for unknown id', async () => {
      mockPrisma.wikiPageVersion.findUnique.mockResolvedValueOnce(null)
      const result = await service.getVersion('nao-existe')
      expect(result).toBeNull()
    })
  })
})
