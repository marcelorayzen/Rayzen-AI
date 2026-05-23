import { Test, TestingModule } from '@nestjs/testing'
import { AuditLogService, CreateAuditEntryDto } from '../audit-log.service'
import { PrismaService } from '../../../prisma/prisma.service'

const mockEntry = {
  id: 'entry-1',
  taskId: 'task-1',
  actor: 'admin',
  module: 'jarvis',
  action: 'screenshot',
  command: null,
  risk: 'medium',
  dryRun: false,
  durationMs: 1200,
  status: 'success',
  result: null,
  error: null,
  workspace: '/home/user/project',
  hostname: 'my-pc',
  targetRole: 'desktop',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

const mockPrisma = {
  agentAuditLog: {
    create: jest.fn().mockResolvedValue(mockEntry),
    findMany: jest.fn().mockResolvedValue([mockEntry]),
  },
}

describe('AuditLogService', () => {
  let service: AuditLogService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get<AuditLogService>(AuditLogService)
  })

  describe('create', () => {
    it('persiste entry com campos obrigatórios', async () => {
      const dto: CreateAuditEntryDto = {
        taskId: 'task-1',
        module: 'jarvis',
        action: 'screenshot',
        status: 'success',
      }
      const result = await service.create(dto)
      expect(result).toEqual(mockEntry)
      expect(mockPrisma.agentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ taskId: 'task-1', module: 'jarvis', action: 'screenshot', status: 'success' }),
      })
    })

    it('inclui campos opcionais quando fornecidos', async () => {
      const dto: CreateAuditEntryDto = {
        taskId: 'task-2',
        module: 'jarvis',
        action: 'run_command',
        status: 'error',
        command: 'npm test',
        risk: 'high',
        dryRun: true,
        durationMs: 500,
        hostname: 'my-pc',
        workspace: '/home',
        targetRole: 'desktop',
        actor: 'admin',
        error: 'Command failed',
      }
      await service.create(dto)
      expect(mockPrisma.agentAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          command: 'npm test',
          risk: 'high',
          dryRun: true,
          durationMs: 500,
          error: 'Command failed',
        }),
      })
    })

    it('omite result quando undefined', async () => {
      await service.create({ taskId: 'task-3', module: 'jarvis', action: 'notify', status: 'success' })
      const call = mockPrisma.agentAuditLog.create.mock.calls[0][0]
      expect(call.data.result).toBeUndefined()
    })

    it('inclui result quando presente', async () => {
      await service.create({ taskId: 'task-4', module: 'jarvis', action: 'notify', status: 'success', result: { ok: true } })
      const call = mockPrisma.agentAuditLog.create.mock.calls[0][0]
      expect(call.data.result).toEqual({ ok: true })
    })
  })

  describe('findAll', () => {
    it('retorna lista sem filtros', async () => {
      const result = await service.findAll()
      expect(result).toEqual([mockEntry])
      expect(mockPrisma.agentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 100 }),
      )
    })

    it('filtra por action quando fornecido', async () => {
      await service.findAll({ action: 'screenshot' })
      expect(mockPrisma.agentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ action: 'screenshot' }) }),
      )
    })

    it('filtra por status quando fornecido', async () => {
      await service.findAll({ status: 'error' })
      expect(mockPrisma.agentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'error' }) }),
      )
    })

    it('usa limit customizado', async () => {
      await service.findAll({ limit: 25 })
      expect(mockPrisma.agentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25 }),
      )
    })

    it('combina action + status + limit', async () => {
      await service.findAll({ action: 'git_commit', status: 'success', limit: 10 })
      expect(mockPrisma.agentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: 'git_commit', status: 'success' },
          take: 10,
        }),
      )
    })
  })
})
