import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { MissionService } from '../mission/mission.service'

type Priority = 'critical' | 'high' | 'normal' | 'low'

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 }

export interface EnqueueDto {
  missionId:    string
  priority?:    Priority
  dependsOn?:   string[]
  scheduledAt?: Date
  recurrence?:  string
}

@Injectable()
export class MissionSchedulerService {
  private readonly logger = new Logger(MissionSchedulerService.name)

  constructor(
    private readonly prisma:   PrismaV2Service,
    private readonly missions: MissionService,
  ) {}

  async enqueue(dto: EnqueueDto) {
    return this.prisma.scheduledMission.upsert({
      where:  { missionId: dto.missionId },
      create: {
        missionId:   dto.missionId,
        priority:    dto.priority   ?? 'normal',
        dependsOn:   dto.dependsOn  ?? [],
        scheduledAt: dto.scheduledAt,
        recurrence:  dto.recurrence,
        status:      'queued',
      },
      update: {
        priority:    dto.priority   ?? 'normal',
        dependsOn:   dto.dependsOn  ?? [],
        scheduledAt: dto.scheduledAt,
      },
    })
  }

  async getQueue(status?: string) {
    const items = await this.prisma.scheduledMission.findMany({
      where:   { status: status ?? 'queued' },
      orderBy: [{ queuedAt: 'asc' }],
    })

    // Sort by priority then FIFO
    return items.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority as Priority] ?? 2
      const pb = PRIORITY_ORDER[b.priority as Priority] ?? 2
      if (pa !== pb) return pa - pb
      return a.queuedAt.getTime() - b.queuedAt.getTime()
    })
  }

  async getRunning() {
    return this.prisma.scheduledMission.findMany({ where: { status: 'running' } })
  }

  async prioritize(missionId: string, priority: Priority) {
    return this.prisma.scheduledMission.update({
      where: { missionId },
      data:  { priority },
    })
  }

  async pause(missionId: string, state?: Record<string, unknown>) {
    await this.missions.transition(missionId, 'paused').catch(() => null)
    return this.prisma.scheduledMission.update({
      where: { missionId },
      data:  { status: 'paused', pausedAt: new Date(), state: (state ?? {}) as object },
    })
  }

  async resume(missionId: string) {
    await this.missions.transition(missionId, 'active').catch(() => null)
    return this.prisma.scheduledMission.update({
      where: { missionId },
      data:  { status: 'running', pausedAt: null },
    })
  }

  // Find next eligible mission — respects dependencies + scheduledAt
  async getNextEligible(maxConcurrent = 3): Promise<string | null> {
    const running = await this.getRunning()
    if (running.length >= maxConcurrent) return null

    const queued = await this.getQueue('queued')
    const now    = Date.now()
    const doneIds = new Set(
      (await this.prisma.scheduledMission.findMany({ where: { status: 'done' } })).map((m) => m.missionId)
    )

    for (const item of queued) {
      // Check scheduledAt
      if (item.scheduledAt && item.scheduledAt.getTime() > now) continue

      // Check dependencies
      const depsOk = item.dependsOn.every((dep) => doneIds.has(dep))
      if (!depsOk) continue

      return item.missionId
    }

    return null
  }

  async markDone(missionId: string) {
    return this.prisma.scheduledMission.update({
      where: { missionId },
      data:  { status: 'done' },
    }).catch(() => null)
  }

  async getStatus() {
    const counts = await this.prisma.scheduledMission.groupBy({
      by:     ['status'],
      _count: true,
    })
    return {
      queued:    counts.find((c) => c.status === 'queued')?._count  ?? 0,
      running:   counts.find((c) => c.status === 'running')?._count ?? 0,
      paused:    counts.find((c) => c.status === 'paused')?._count  ?? 0,
      done:      counts.find((c) => c.status === 'done')?._count    ?? 0,
      failed:    counts.find((c) => c.status === 'failed')?._count  ?? 0,
    }
  }
}
