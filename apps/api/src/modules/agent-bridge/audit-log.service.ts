import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface CreateAuditEntryDto {
  taskId: string
  actor?: string
  module: string
  action: string
  command?: string
  risk?: string
  dryRun?: boolean
  durationMs?: number
  status: 'success' | 'error'
  result?: unknown
  error?: string
  workspace?: string
  hostname?: string
  targetRole?: string
}

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAuditEntryDto) {
    return this.prisma.agentAuditLog.create({
      data: {
        taskId: dto.taskId,
        actor: dto.actor ?? 'admin',
        module: dto.module,
        action: dto.action,
        command: dto.command ?? null,
        risk: dto.risk ?? null,
        dryRun: dto.dryRun ?? false,
        durationMs: dto.durationMs ?? null,
        status: dto.status,
        result: dto.result !== undefined ? (dto.result as object) : undefined,
        error: dto.error ?? null,
        workspace: dto.workspace ?? null,
        hostname: dto.hostname ?? null,
        targetRole: dto.targetRole ?? null,
      },
    })
  }

  async findAll(filters: { action?: string; status?: string; limit?: number } = {}) {
    return this.prisma.agentAuditLog.findMany({
      where: {
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 100,
    })
  }
}
