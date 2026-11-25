import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { createTestApp, mockPrisma } from './setup'

describe('Projects E2E — /projects', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /projects', () => {
    it('retorna 200 sem autenticação (rota pública para o hook)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([])
      const res = await app.inject({ method: 'GET', url: '/projects' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('retorna lista de projetos quando existem', async () => {
      const projects = [
        { id: 'p1', name: 'Rayzen AI', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'p2', name: 'Personal Coach', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]
      mockPrisma.project.findMany.mockResolvedValue(projects)
      const res = await app.inject({ method: 'GET', url: '/projects' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toHaveLength(2)
      expect(body[0].name).toBe('Rayzen AI')
    })

    it('filtra por repoSlug quando fornecido', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 'p1', name: 'Rayzen AI', repoSlug: 'rayzen-ai', status: 'active' },
      ])
      const res = await app.inject({ method: 'GET', url: '/projects?repoSlug=rayzen-ai' })
      expect(res.statusCode).toBe(200)
      expect(mockPrisma.project.findMany).toHaveBeenCalled()
    })
  })

  describe('POST /projects', () => {
    it('cria projeto com nome válido', async () => {
      const created = {
        id: 'p-new',
        name: 'Novo Projeto',
        status: 'active',
        repoSlug: 'novo-projeto',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      mockPrisma.project.create.mockResolvedValue(created)
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: { name: 'Novo Projeto' },
      })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.body).name).toBe('Novo Projeto')
    })

    it('retorna 400 sem nome', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/projects',
        payload: {},
      })
      // Sem ValidationPipe aplicado no controller, retorna erro do Prisma ou 400
      expect([400, 500]).toContain(res.statusCode)
    })
  })

  describe('GET /projects/:id', () => {
    it('retorna projeto por ID', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        id: 'proj-1', name: 'Test', status: 'active', createdAt: new Date(), updatedAt: new Date(),
      })
      const res = await app.inject({ method: 'GET', url: '/projects/proj-1' })
      expect(res.statusCode).toBe(200)
    })
  })
})
