import { Injectable, OnModuleInit } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry()

  readonly httpRequestDuration = new Histogram({
    name: 'rayzen_http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  })

  readonly llmTokensTotal = new Counter({
    name: 'rayzen_llm_tokens_total',
    help: 'Total de tokens LLM consumidos',
    labelNames: ['module', 'model'],
    registers: [this.registry],
  })

  readonly llmRequestDuration = new Histogram({
    name: 'rayzen_llm_request_duration_seconds',
    help: 'Duração das chamadas ao LLM em segundos',
    labelNames: ['module', 'model'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  })

  readonly agentTasksTotal = new Counter({
    name: 'rayzen_agent_tasks_total',
    help: 'Total de tasks do agente executadas',
    labelNames: ['action', 'status', 'role'],
    registers: [this.registry],
  })

  readonly agentTaskDuration = new Histogram({
    name: 'rayzen_agent_task_duration_seconds',
    help: 'Duração das tasks do agente em segundos',
    labelNames: ['action', 'risk'],
    buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120],
    registers: [this.registry],
  })

  private queueSize = new Gauge({
    name: 'rayzen_queue_size',
    help: 'Número de jobs na fila por estado',
    labelNames: ['state'],
    registers: [this.registry],
  })

  private projectsTotal = new Gauge({
    name: 'rayzen_projects_total',
    help: 'Total de projetos ativos',
    registers: [this.registry],
  })

  private eventsTotal = new Gauge({
    name: 'rayzen_events_total',
    help: 'Total de eventos registrados',
    registers: [this.registry],
  })

  private auditLogsTotal = new Gauge({
    name: 'rayzen_audit_logs_total',
    help: 'Total de entradas no audit log do agente',
    registers: [this.registry],
  })

  constructor(
    @InjectQueue('agent-tasks') private queue: Queue,
    private prisma: PrismaService,
  ) {}

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: 'rayzen_node_' })
  }

  async getMetrics(): Promise<string> {
    await this.refreshGauges()
    return this.registry.metrics()
  }

  private async refreshGauges() {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ])
      this.queueSize.set({ state: 'waiting' }, waiting)
      this.queueSize.set({ state: 'active' }, active)
      this.queueSize.set({ state: 'completed' }, completed)
      this.queueSize.set({ state: 'failed' }, failed)
      this.queueSize.set({ state: 'delayed' }, delayed)
    } catch {
      // Fila indisponível — ignora
    }

    try {
      const [projects, events, auditLogs] = await Promise.all([
        this.prisma.project.count(),
        this.prisma.event.count(),
        this.prisma.agentAuditLog.count(),
      ])
      this.projectsTotal.set(projects)
      this.eventsTotal.set(events)
      this.auditLogsTotal.set(auditLogs)
    } catch {
      // DB indisponível — ignora
    }
  }
}
