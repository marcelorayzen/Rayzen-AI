import { Test, TestingModule } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { getQueueToken } from '@nestjs/bull'
import { AuthModule } from '../../src/modules/auth/auth.module'
import { AgentBridgeModule } from '../../src/modules/agent-bridge/agent-bridge.module'
import { ProjectModule } from '../../src/modules/project/project.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import { NotionService } from '../../src/modules/notion/notion.service'

export const TEST_JWT_SECRET = 'test-secret-e2e'
export const TEST_ADMIN_PASSWORD = 'senha-e2e-test'
export const TEST_AGENT_TOKEN = 'agent-token-e2e'

// Injetados via env antes de carregar o módulo
process.env.JWT_SECRET = TEST_JWT_SECRET
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD
process.env.ALLOW_PLAINTEXT_ADMIN_PASSWORD = 'true'
process.env.AGENT_TOKEN = TEST_AGENT_TOKEN

export const mockPrisma = {
  project: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Test', status: 'active', createdAt: new Date(), updatedAt: new Date() }),
    create: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Test', status: 'active', createdAt: new Date(), updatedAt: new Date() }),
    update: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  agentAuditLog: {
    create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  $connect: jest.fn(),
  $disconnect: jest.fn(),
}

export const mockRedisValues = new Map<string, string>()
let mockFencingSequence = 0
export const mockRedis = {
  set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
    const mode = args.find((arg) => arg === 'NX' || arg === 'XX')
    if (mode === 'NX' && mockRedisValues.has(key)) return null
    if (mode === 'XX' && !mockRedisValues.has(key)) return null
    mockRedisValues.set(key, value)
    return 'OK'
  }),
  get: jest.fn(async (key: string) => mockRedisValues.get(key) ?? null),
  incr: jest.fn(async () => ++mockFencingSequence),
  eval: jest.fn(async (_script: string, _keys: number, key: string, expected: string) => {
    if (mockRedisValues.get(key) !== expected) return 0
    mockRedisValues.delete(key)
    return 1
  }),
}

export const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1', data: {} }),
  getJobs: jest.fn().mockResolvedValue([]),
  getJob: jest.fn().mockResolvedValue(null),
  client: mockRedis,
}

export async function createTestApp(): Promise<NestFastifyApplication> {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      AuthModule,
      AgentBridgeModule,
      ProjectModule,
    ],
  })
    .overrideProvider(PrismaService).useValue(mockPrisma)
    .overrideProvider(getQueueToken('agent-tasks')).useValue(mockQueue)
    .overrideProvider(NotionService).useValue({ createProjectPage: jest.fn().mockResolvedValue(null) })
    .compile()

  const app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}
