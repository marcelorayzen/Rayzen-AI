import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { AgentRole, Task, TaskCreateDto, TaskStatus } from '@rayzen/types'
import { randomUUID } from 'crypto'

@Injectable()
export class AgentBridgeService {
  constructor(@InjectQueue('agent-tasks') private queue: Queue) {}

  async enqueue(dto: TaskCreateDto): Promise<Task> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const task: Task = { id, ...dto, status: 'pending', createdAt: now, updatedAt: now }
    await this.queue.add('execute', task, { jobId: id, attempts: 3, backoff: 5000 })
    return task
  }

  async getPending(role?: AgentRole): Promise<Task[]> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed'])
    return jobs
      .map((j) => j.data as Task)
      .filter((t) => t.status === 'pending')
      .filter((t) => !t.targetRole || !role || t.targetRole === role)
  }

  async getById(id: string): Promise<Task | null> {
    const jobs = await this.queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'])
    const job  = jobs.find((j) => j.id === id)
    return job ? (job.data as Task) : null
  }

  async updateStatus(id: string, status: TaskStatus, result?: unknown, error?: string) {
    const jobs = await this.queue.getJobs(['active', 'waiting', 'delayed', 'completed', 'failed'])
    const job = jobs.find((j) => j.id === id)
    if (job) {
      await job.update({ ...job.data, status, result, error, updatedAt: new Date().toISOString() })
    }
  }
}
