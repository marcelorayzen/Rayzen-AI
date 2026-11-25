import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { JwtService } from '@nestjs/jwt'
import { createTestApp, mockQueue, mockRedisValues, TEST_JWT_SECRET, TEST_AGENT_TOKEN } from './setup'

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

  beforeEach(() => {
    mockRedisValues.clear()
    mockQueue.getJob.mockResolvedValue(null)
  })

  describe('POST /tasks — idempotência da criação', () => {
    let jobs: Map<string, { id: string; data: Record<string, unknown> }>

    beforeEach(() => {
      jobs = new Map()
      mockQueue.add.mockClear()
      mockQueue.add.mockImplementation(async (_name, data, options) => {
        if (!jobs.has(options.jobId)) jobs.set(options.jobId, { id: options.jobId, data })
        return jobs.get(options.jobId)
      })
      mockQueue.getJob.mockImplementation(async (id) => jobs.get(String(id)) ?? null)
    })

    const payload = (idempotencyKey?: string, label = 'janela') => ({
      module: 'jarvis',
      action: 'screenshot',
      payload: { label },
      targetRole: 'desktop',
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })

    it('exige idempotencyKey', async () => {
      const res = await app.inject({
        method: 'POST', url: '/tasks',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: payload(),
      })
      expect(res.statusCode).toBe(400)
      expect(mockQueue.add).not.toHaveBeenCalled()
    })

    it('mesma chave e mesmo pedido retornam o mesmo task id sem duplicar job', async () => {
      const request = {
        method: 'POST' as const,
        url: '/tasks',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: payload('e2e:screenshot:1'),
      }
      const first = await app.inject(request)
      const replay = await app.inject(request)

      expect(first.statusCode).toBe(201)
      expect(replay.statusCode).toBe(201)
      expect(JSON.parse(replay.body)).toMatchObject({
        id: JSON.parse(first.body).id,
        idempotencyReplay: true,
      })
      expect(mockQueue.add).toHaveBeenCalledTimes(1)
    })

    it('mesma chave com outro payload retorna 409 e preserva o primeiro job', async () => {
      const first = await app.inject({
        method: 'POST', url: '/tasks',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: payload('e2e:screenshot:conflict', 'primeiro'),
      })
      const conflict = await app.inject({
        method: 'POST', url: '/tasks',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: payload('e2e:screenshot:conflict', 'segundo'),
      })

      expect(first.statusCode).toBe(201)
      expect(conflict.statusCode).toBe(409)
      expect(jobs.size).toBe(1)
    })
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
      const job = {
        id: 'task-123',
        data: {
          id: 'task-123', module: 'jarvis', action: 'run_command', payload: {}, status: 'processing',
          fencingToken: '7', createdAt: '', updatedAt: '',
        },
        update: jest.fn().mockResolvedValue(undefined),
      }
      mockQueue.getJob.mockResolvedValue(job)
      mockRedisValues.set('claim:task:task-123', JSON.stringify({ dono: 'test-host', fencingToken: '7' }))
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
          fencingToken: '7',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ ok: true })
    })

    it('retorna 409 e preserva processing para fencing token antigo', async () => {
      const job = {
        id: 'task-123',
        data: {
          id: 'task-123', module: 'jarvis', action: 'run_command', payload: {}, status: 'processing',
          fencingToken: '8', createdAt: '', updatedAt: '',
        },
        update: jest.fn(),
      }
      mockQueue.getJob.mockResolvedValue(job)
      mockRedisValues.set('claim:task:task-123', JSON.stringify({ dono: 'test-host', fencingToken: '8' }))

      const res = await app.inject({
        method: 'PATCH',
        url: '/tasks/task-123',
        headers: { authorization: `Bearer ${TEST_AGENT_TOKEN}` },
        payload: { status: 'done', hostname: 'test-host', fencingToken: '7' },
      })

      expect(res.statusCode).toBe(409)
      expect(job.update).not.toHaveBeenCalled()
      expect(job.data.status).toBe('processing')
    })
  })
})
