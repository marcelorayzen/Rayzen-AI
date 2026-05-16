import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { Task, TaskCreateDto } from '@rayzen/types'
import { randomUUID } from 'crypto'
import { EventService } from '../event/event.service'

const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 30_000

// Ações que só podem executar num role específico de agente
const ACTION_ROLE: Record<string, string> = {
  restart_api: 'notebook',
}

@Injectable()
export class ExecutionService {
  constructor(
    @InjectQueue('agent-tasks') private queue: Queue,
    private eventService: EventService,
  ) {}

  async dispatch(action: string, payload: Record<string, unknown>): Promise<unknown> {
    const targetRole = ACTION_ROLE[action]
    const dto: TaskCreateDto = { module: 'jarvis', action, payload, ...(targetRole ? { targetRole } : {}) }
    const id = randomUUID()
    const now = new Date().toISOString()
    const task: Task = { id, ...dto, status: 'pending', createdAt: now, updatedAt: now }

    await this.queue.add('execute', task, {
      jobId: id,
      attempts: 3,
      backoff: 5000,
      removeOnComplete: false,
      removeOnFail: false,
    })

    this.eventService.create({ source: 'execution', type: 'execution', content: `${action}`, metadata: { action, payload, jobId: id } }).catch(() => null)
    return this.waitForResult(id)
  }

  async waitForResult(jobId: string): Promise<unknown> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      const jobs = await this.queue.getJobs(['active', 'waiting', 'completed', 'failed'])
      const job = jobs.find((j) => j.id === jobId)
      if (!job) continue
      const data = job.data as Task
      if (data.status === 'done') return data.result
      if (data.status === 'failed') throw new Error(data.error ?? 'Tarefa falhou')
    }
    throw new Error('Timeout aguardando o PC Agent executar a tarefa')
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
