import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { AgentRole, Task, TaskCreateDto } from '@rayzen/types'
import { randomUUID } from 'crypto'
import { EventService } from '../event/event.service'

const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 30_000

// Ações que só podem executar num role específico de agente.
// O desktop fornece evidências visuais e automações da estação de trabalho.
// O server opera a stack hospedada na VPS.
const ACTION_ROLE: Partial<Record<string, AgentRole>> = {
  open_app: 'desktop',
  open_url: 'desktop',
  open_vscode: 'desktop',
  list_dir: 'desktop',
  file_search: 'desktop',
  organize_downloads: 'desktop',
  create_project_folder: 'desktop',
  get_system_info: 'desktop',
  screenshot: 'desktop',
  notify: 'desktop',
  clipboard_read: 'desktop',
  clipboard_write: 'desktop',
  git_status: 'desktop',
  git_log: 'desktop',
  git_branch: 'desktop',
  git_commit: 'desktop',
  run_command: 'desktop',
  run_tests: 'desktop',
  inspect_schema: 'desktop',
  read_emails: 'desktop',
  send_email: 'desktop',
  get_calendar: 'desktop',
  parse_test_report: 'desktop',
  capture_test_failure: 'desktop',
  docker_ps: 'server',
  docker_start: 'server',
  docker_stop: 'server',
  docker_logs: 'server',
  restart_api: 'server',
  file_read: 'desktop',
  file_write: 'desktop',
  file_delete: 'desktop',
  git_diff: 'desktop',
  git_add: 'desktop',
  git_pull: 'desktop',
  git_push: 'desktop',
  prisma_generate: 'desktop',
  prisma_migrate: 'desktop',
  supervised_session: 'server',
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
