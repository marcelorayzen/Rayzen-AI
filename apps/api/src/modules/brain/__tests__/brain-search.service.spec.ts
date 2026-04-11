import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { BrainService } from '../brain.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { EventService } from '../../event/event.service'

const mockPrisma = {
  document: { findFirst: jest.fn(), findMany: jest.fn() },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
}

const mockConfig = {
  get: (key: string, fallback?: string) => ({ JINA_API_KEY: 'jina-test' }[key] ?? fallback ?? ''),
}

describe('BrainService', () => {
  let service: BrainService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrainService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()
    service = module.get<BrainService>(BrainService)
  })

  describe('embed', () => {
    it('returns 1024-dimension vector from Jina', async () => {
      const vector = Array(1024).fill(0.1)
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ embedding: vector }] }),
      } as Response)

      const result = await service.embed('test')
      expect(result).toHaveLength(1024)
    })
  })

  describe('chunkText', () => {
    it('splits paragraphs that exceed maxChars into separate chunks', () => {
      // Each para is ~80 chars; maxChars=100 forces a split after each one
      const para = (n: number) => `Parágrafo ${n}: conteúdo longo suficiente para forçar split com maxChars pequeno.`
      const text = `${para(1)}\n\n${para(2)}\n\n${para(3)}`
      const chunks = service.chunkText(text, 100)
      expect(chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('filters out chunks shorter than 50 characters', () => {
      const text = 'Curto.\n\nTambém curto.'
      const chunks = service.chunkText(text)
      expect(chunks).toHaveLength(0)
    })

    it('filters out chunks shorter than 50 characters', () => {
      const text = 'Hi.\n\n' + 'A'.repeat(100)
      const chunks = service.chunkText(text)
      expect(chunks.every((c) => c.length >= 50)).toBe(true)
    })
  })

  describe('indexDocument', () => {
    beforeEach(() => {
      jest.spyOn(service, 'embed').mockResolvedValue(Array(1024).fill(0.1))
    })

    it('creates new document when checksum does not exist', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexDocument('new content', 'manual')
      expect(result.status).toBe('created')
      expect(mockPrisma.$executeRaw).toHaveBeenCalled()
    })

    it('updates embedding when document already exists', async () => {
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'existing-id' })
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexDocument('existing content')
      expect(result.status).toBe('updated')
      expect(result.id).toBe('existing-id')
    })
  })

  describe('search', () => {
    it('returns results with numeric score', async () => {
      jest.spyOn(service, 'embed').mockResolvedValue(Array(1024).fill(0.1))
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'doc-1', content: 'BullMQ docs', source_path: 'url/docs.bullmq.io', metadata: {}, score: '0.87' },
      ])

      const results = await service.search('bullmq retry')
      expect(results).toHaveLength(1)
      expect(results[0].score).toBe(0.87)
      expect(typeof results[0].score).toBe('number')
    })

    it('returns empty array when no documents indexed', async () => {
      jest.spyOn(service, 'embed').mockResolvedValue(Array(1024).fill(0.1))
      mockPrisma.$queryRaw.mockResolvedValue([])

      const results = await service.search('anything')
      expect(results).toEqual([])
    })
  })
})
