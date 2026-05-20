import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SynthesisService } from './synthesis.service'
import { DocumentationService } from '../documentation/documentation.service'

const INTERVAL_MS   = 10 * 60 * 1000  // checar a cada 10min
const MIN_EVENTS    = 5                // mínimo de eventos para qualquer trigger
const BURST_EVENTS  = 15              // trigger por burst de atividade
const MAX_HOURS     = 2               // trigger por tempo decorrido

@Injectable()
export class SmartCheckpointService implements OnModuleInit {
  private readonly logger = new Logger(SmartCheckpointService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly synthesis: SynthesisService,
    @Inject(forwardRef(() => DocumentationService))
    private readonly docSvc: DocumentationService,
  ) {}

  onModuleInit() {
    if (process.env.SMART_CHECKPOINT_ENABLED === 'false') return
    setInterval(() => this.checkAll().catch(() => null), INTERVAL_MS)
    this.logger.log(`Smart checkpoint ativo — intervalo ${INTERVAL_MS / 60_000}min, triggers: decision|burst(${BURST_EVENTS})|timer(${MAX_HOURS}h)`)
  }

  private async checkAll(): Promise<void> {
    const projects = await this.prisma.project.findMany({
      where: { status: 'active' },
      select: { id: true },
    })
    for (const project of projects) {
      await this.checkProject(project.id).catch(() => null)
    }
  }

  async checkProject(projectId: string): Promise<{ triggered: boolean; reason?: string }> {
    const lastCheckpoint = await this.prisma.sessionArtifact.findFirst({
      where: { projectId, type: 'checkpoint' },
      orderBy: { createdAt: 'desc' },
    })

    const since = lastCheckpoint?.createdAt ?? new Date(Date.now() - MAX_HOURS * 3_600_000)

    const events = await this.prisma.event.findMany({
      where: { projectId, ts: { gte: since }, memoryClass: { not: 'archive' } },
      orderBy: { ts: 'desc' },
      select: { id: true, intent: true },
    })

    if (events.length < MIN_EVENTS) return { triggered: false }

    const hoursSinceLast = lastCheckpoint
      ? (Date.now() - lastCheckpoint.createdAt.getTime()) / 3_600_000
      : MAX_HOURS + 1

    const hasDecision = events.some(e => e.intent === 'decision')
    const isBurst     = events.length >= BURST_EVENTS
    const isOverdue   = hoursSinceLast >= MAX_HOURS

    if (!hasDecision && !isBurst && !isOverdue) return { triggered: false }

    const reason = hasDecision ? 'decision_detected'
      : isBurst ? 'activity_burst'
      : 'time_elapsed'

    this.logger.log(`auto-checkpoint: projeto ${projectId} — ${reason} (${events.length} eventos desde último)`)

    await this.synthesis.checkpoint(projectId, undefined, undefined, { autoTriggered: true, reason })
    // Pipeline automático: atualiza estado e docs em background
    this.docSvc.generateAll(projectId, { force: true }).catch(() => {})

    return { triggered: true, reason }
  }
}
