import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export type EventSource = 'chat' | 'memory' | 'cli' | 'voice' | 'execution' | 'manual' | 'brain'
export type EventType = 'message' | 'index' | 'execution' | 'decision' | 'note' | 'error'
export type EventIntent = 'decision' | 'idea' | 'problem' | 'reference' | 'checkpoint'
export type MemoryClass = 'inbox' | 'working' | 'consolidated' | 'archive'

export interface CreateEventDto {
  projectId?: string
  source: EventSource
  type: EventType
  intent?: EventIntent
  content: string
  metadata?: Record<string, unknown>
}

function deriveMemoryClass(intent?: EventIntent | null): MemoryClass {
  if (intent === 'decision') return 'consolidated'
  if (intent === 'checkpoint') return 'consolidated'
  if (intent === 'problem') return 'working'
  return 'inbox'
}

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto) {
    const memoryClass = deriveMemoryClass(dto.intent)
    return this.prisma.event.create({
      data: {
        projectId: dto.projectId ?? null,
        source: dto.source,
        type: dto.type,
        intent: dto.intent ?? null,
        content: dto.content,
        metadata: (dto.metadata ?? {}) as object,
        memoryClass,
      },
    })
  }

  async updateClass(eventId: string, memoryClass: MemoryClass) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } })
    if (!event) throw new NotFoundException('Evento não encontrado')
    return this.prisma.event.update({
      where: { id: eventId },
      data: { memoryClass },
    })
  }

  async findAll(filters: {
    projectId?: string
    source?: string
    type?: string
    memoryClass?: string
    limit?: number
  }) {
    return this.prisma.event.findMany({
      where: {
        ...(filters.projectId ? { projectId: filters.projectId } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.memoryClass ? { memoryClass: filters.memoryClass } : {}),
      },
      orderBy: { ts: 'desc' },
      take: filters.limit ?? 50,
    })
  }

  /**
   * Promote stale events:
   * - problem-intent inbox without resolution after 48h → working
   * - inbox without reference after 30 days → archive
   *
   * Called by ProjectStateService after refresh (background, non-blocking).
   */
  async promoteStaleEvents(projectId: string): Promise<void> {
    const now = new Date()
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // problem in inbox for > 48h → working
    await this.prisma.event.updateMany({
      where: {
        projectId,
        memoryClass: 'inbox',
        intent: 'problem',
        ts: { lt: fortyEightHoursAgo },
      },
      data: { memoryClass: 'working' },
    })

    // inbox with no special intent for > 30 days → archive
    await this.prisma.event.updateMany({
      where: {
        projectId,
        memoryClass: 'inbox',
        intent: null,
        ts: { lt: thirtyDaysAgo },
      },
      data: { memoryClass: 'archive' },
    })
  }
}
