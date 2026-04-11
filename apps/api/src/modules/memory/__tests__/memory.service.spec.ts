import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { MemoryService } from '../memory.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { EventService } from '../../event/event.service'

const mockPrisma = {
  document: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
  conversationMessage: {
    createMany: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
}

const mockConfigGet = jest.fn().mockReturnValue('mock-key')

describe('MemoryService', () => {
  let service: MemoryService

  beforeEach(async () => {
    jest.clearAllMocks()

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: [{ embedding: new Array(1024).fill(0.1) }],
      }),
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: mockConfigGet } },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile()

    service = module.get<MemoryService>(MemoryService)
  })

  describe('indexDocument', () => {
    it('retorna status "created" para documento novo', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexDocument('Conteúdo do documento', 'file/test.txt')

      expect(result.status).toBe('created')
      expect(result.id).toBeDefined()
    })

    it('retorna status "updated" para documento com mesmo checksum', async () => {
      mockPrisma.document.findFirst.mockResolvedValue({ id: 'existing-id', checksum: 'abc' })
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexDocument('Conteúdo duplicado')

      expect(result.status).toBe('updated')
      expect(result.id).toBe('existing-id')
    })

    it('chama a API Jina para gerar embedding', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      await service.indexDocument('texto')

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.jina.ai/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('search', () => {
    it('retorna array vazio quando não há documentos', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([])

      const result = await service.search('query')

      expect(result).toEqual([])
    })

    it('mapeia score para number corretamente', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'Conteúdo relevante',
          source_path: 'file/test.txt',
          metadata: { type: 'file' },
          score: '0.95',
        },
      ])

      const result = await service.search('query')

      expect(typeof result[0].score).toBe('number')
      expect(result[0].score).toBe(0.95)
    })

    it('mapeia source_path para sourcePath', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: 'doc-1',
          content: 'texto',
          source_path: 'github/user/repo',
          metadata: {},
          score: 0.8,
        },
      ])

      const result = await service.search('query')

      expect(result[0].sourcePath).toBe('github/user/repo')
    })
  })

  describe('chunkText', () => {
    it('retorna um chunk para texto pequeno', () => {
      const text = 'Este é um parágrafo simples com mais de 50 caracteres para não ser filtrado.'
      const chunks = service.chunkText(text)
      expect(chunks).toHaveLength(1)
    })

    it('retorna array vazio para texto muito curto (< 50 chars)', () => {
      const chunks = service.chunkText('curto')
      expect(chunks).toHaveLength(0)
    })

    it('divide texto longo em múltiplos chunks', () => {
      const paragraph = 'Este é um parágrafo com conteúdo suficiente para ser um chunk. '.repeat(5)
      const text = Array(5).fill(paragraph).join('\n\n')
      const chunks = service.chunkText(text, 200)
      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('indexUrl', () => {
    it('lança erro quando URL retorna status não-ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })

      await expect(service.indexUrl('https://example.com/404')).rejects.toThrow(
        'Falha ao buscar URL: HTTP 404',
      )
    })

    it('lança erro quando página não tem conteúdo legível', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('<script>alert(1)</script><style>body{}</style>'),
      })

      await expect(service.indexUrl('https://example.com')).rejects.toThrow(
        'Página sem conteúdo legível',
      )
    })

    it('indexa chunks de uma página válida', async () => {
      const embedFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
      })
      const htmlFetch = jest.fn().mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(
          '<html><body>' + 'Conteúdo relevante da página. '.repeat(30) + '</body></html>',
        ),
      })

      global.fetch = jest.fn()
        .mockImplementationOnce(htmlFetch)   // fetch da URL
        .mockImplementation(embedFetch)       // fetch Jina

      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexUrl('https://example.com')
      expect(result.indexed).toBeGreaterThan(0)
    })

    it('adiciona https:// se URL não tiver protocolo', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })
      await expect(service.indexUrl('example.com')).rejects.toThrow()
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toMatch(/^https:\/\//)
    })
  })

  describe('indexGithub', () => {
    it('lança NotFoundException para usuário inexistente (404)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: jest.fn().mockResolvedValue({ message: 'Not Found' }),
      })

      await expect(service.indexGithub('usuario-inexistente')).rejects.toThrow(
        'não encontrado no GitHub',
      )
    })

    it('lança BadGatewayException para rate limit (403)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({ message: 'rate limit exceeded' }),
      })

      await expect(service.indexGithub('qualquer')).rejects.toThrow('Rate limit')
    })

    it('lança erro descritivo para outros erros da API', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ message: 'Internal Server Error' }),
      })

      await expect(service.indexGithub('qualquer')).rejects.toThrow('HTTP 500')
    })

    it('indexa repos e READMEs com sucesso', async () => {
      const reposList = [
        { name: 'repo-a', description: 'desc a', full_name: 'user/repo-a' },
        { name: 'repo-b', description: null, full_name: 'user/repo-b' },
      ]

      const embedResponse = () => Promise.resolve({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
      })
      const notFoundResponse = () => Promise.resolve({ ok: false, status: 404, json: jest.fn() })

      // ordem de chamadas no indexGithub:
      // 1. fetch repos list
      // 2. embed desc repo-a  (Jina)
      // 3. fetch readme repo-a
      // 4. embed desc repo-b  (Jina)
      // 5. fetch readme repo-b
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn().mockResolvedValue(reposList) }) // repos list
        .mockImplementationOnce(embedResponse)    // embed desc repo-a
        .mockImplementationOnce(notFoundResponse) // readme repo-a
        .mockImplementationOnce(embedResponse)    // embed desc repo-b
        .mockImplementationOnce(notFoundResponse) // readme repo-b

      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexGithub('user', undefined, 'proj-id')
      expect(result.repos).toBe(2)
      expect(result.indexed).toBeGreaterThan(0)
    })
  })

  describe('indexFile', () => {
    it('indexa arquivo de texto (.txt)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const text = 'Conteúdo de um arquivo de texto com mais de cinquenta caracteres aqui.'.repeat(3)
      const buffer = Buffer.from(text)
      const result = await service.indexFile(buffer, 'notas.txt', undefined, 'proj-id')
      expect(result.indexed).toBeGreaterThan(0)
    })

    it('indexa arquivo markdown (.md)', async () => {
      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const md = '# Título\n\n' + 'Parágrafo com conteúdo suficiente para passar o filtro de 50 chars.\n\n'.repeat(3)
      const result = await service.indexFile(Buffer.from(md), 'CLAUDE.md')
      expect(result.indexed).toBeGreaterThan(0)
    })
  })

  describe('indexNotion', () => {
    it('lança erro para token inválido (401)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: jest.fn().mockResolvedValue({ message: 'Unauthorized' }),
      })

      await expect(service.indexNotion('token-invalido')).rejects.toThrow(
        'Token do Notion inválido',
      )
    })

    it('lança erro descritivo para outros erros da API Notion', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ message: 'Internal error' }),
      })

      await expect(service.indexNotion('token')).rejects.toThrow('HTTP 500')
    })

    it('indexa páginas retornadas pela API de busca', async () => {
      const pages = [
        {
          id: 'page-uuid-1234-5678-9012-abcdef123456',
          object: 'page',
          properties: { Title: { title: [{ plain_text: 'Minha Página' }] } },
        },
      ]

      const blocks = {
        results: [
          { type: 'paragraph', id: 'b1', has_children: false, paragraph: { rich_text: [{ plain_text: 'Conteúdo da página com texto suficiente para indexar no brain.' }] } },
        ],
      }

      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(blocks),
        })
        .mockImplementation(() => Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
        }))

      mockPrisma.document.findFirst.mockResolvedValue(null)
      mockPrisma.$executeRaw.mockResolvedValue(1)

      const result = await service.indexNotion('secret_token', undefined, 'proj-id')
      expect(result.pages).toBe(1)
      expect(result.indexed).toBeGreaterThan(0)
    })

    it('retorna 0 páginas quando API retorna lista vazia', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ results: [] }),
      })

      const result = await service.indexNotion('secret_token')
      expect(result.pages).toBe(0)
      expect(result.indexed).toBe(0)
    })
  })

  describe('listDocuments', () => {
    it('retorna todos os documentos sem filtro', async () => {
      mockPrisma.document.findMany.mockResolvedValue([
        { id: 'a', sourcePath: 'github/user/repo', checksum: 'abc', createdAt: new Date(), updatedAt: new Date() },
      ])
      const result = await service.listDocuments()
      expect(result).toHaveLength(1)
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }))
    })

    it('filtra por projectId quando fornecido', async () => {
      mockPrisma.document.findMany.mockResolvedValue([])
      await service.listDocuments('proj-123')
      expect(mockPrisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: 'proj-123' } }),
      )
    })
  })

  describe('deleteDocument', () => {
    it('deleta documento pelo id', async () => {
      mockPrisma.document.delete = jest.fn().mockResolvedValue({})
      const result = await service.deleteDocument('doc-id')
      expect(result).toEqual({ deleted: true })
      expect(mockPrisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-id' } })
    })
  })
})
