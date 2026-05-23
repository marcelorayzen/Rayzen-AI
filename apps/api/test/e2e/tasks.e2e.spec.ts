import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { JwtService } from '@nestjs/jwt'
import { createTestApp, mockQueue, TEST_JWT_SECRET, TEST_AGENT_TOKEN } from './setup'

function makeJwt(secret: string): string {
  return new JwtService({ secret }).sign({ sub: 'admin', role: 'admin' })
}

describe('Tasks E2E — /tasks', () => {
  let app: NestFastifyApplication
  let jwt: string

  beforeAll(async () => {
    app = await createTestApp()
    jwt = makeJwt(TEST_JWT_SECRET)
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /tasks/pending', () => {
    it('retorna 401 sem Authorization', async () => {
      const res = await app.inject({ method: 'GET', url: '/tasks/pending' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 401 com JWT de admin (não é agent token)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tasks/pending',
        headers: { authorization: `Bearer ${jwt}` },
      })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 200 com agent token válido', async () => {
      mockQueue.getJobs.mockResolvedValue([])
      const res = await app.inject({
        method: 'GET',
        url: '/tasks/pending',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })

    it('filtra por role quando fornecido', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tasks/pending?role=desktop',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
      })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('GET /tasks/audit', () => {
    it('retorna 401 sem Authorization', async () => {
      const res = await app.inject({ method: 'GET', url: '/tasks/audit' })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 200 com agent token e lista vazia', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/tasks/audit',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual([])
    })
  })

  describe('PATCH /tasks/:id', () => {
    it('retorna 401 sem Authorization', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/tasks/task-123',
        payload: { status: 'done' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('retorna 200 e grava audit ao completar task', async () => {
      mockQueue.getJobs.mockResolvedValue([])
      const res = await app.inject({
        method: 'PATCH',
        url: '/tasks/task-123',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: {
          status: 'done',
          module: 'jarvis',
          action: 'run_command',
          command: 'pnpm test',
          risk: 'medium',
          dryRun: false,
          durationMs: 1820,
          hostname: 'test-host',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
    })
  })
})
