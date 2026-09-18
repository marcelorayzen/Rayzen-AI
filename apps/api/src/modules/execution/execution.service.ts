import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { AgentRole, Task, TaskCreateDto } from '@rayzen/types'
import { randomUUID } from 'crypto'
import { EventService } from '../event/event.service'
import { AgentHeartbeatService } from '../agent-bridge/agent-heartbeat.service'

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
  supervised_session:     'desktop',
  run_graphify:           'desktop',
  graphify_sync:          'desktop',
  guardian_analyze:       'desktop',
  browse_and_screenshot:  'desktop',
  get_qa_summary:         'server',
}

@Injectable()
export class ExecutionService {
  constructor(
    @InjectQueue('agent-tasks') private queue: Queue,
    private eventService: EventService,
    private heartbeat: AgentHeartbeatService,
  ) {}

  /**
   * Coloca a tarefa na fila e devolve o `jobId` — **sem esperar o resultado**.
   *
   * Separado de `dispatch()` para A03 da auditoria de 13/09. `dispatch()` termina em
   * `waitForResult()`, com teto de 30s: serve para ação pontual, e é exatamente o que impede
   * usá-lo para trabalho longo. Uma sessão supervisionada dura minutos a horas, então chamar
   * `dispatch()` lá trocaria "nunca chega ao executor" por "estoura o timeout com a sessão
   * rodando órfã do outro lado" — um defeito diferente, não um conserto.
   *
   * Aceitação rápida e trabalho demorado são coisas distintas: quem enfileira recebe uma
   * referência, e o estado do trabalho vive na entidade de domínio (a `AgentSession`, no caso
   * supervisionado), não na espera de uma requisição HTTP.
   */
  /**
   * `atrasoMs` agenda em vez de executar agora. O Bull guarda o job em `delayed`, e
   * `agent-bridge`'s `jaEstaNaHora()` é quem impede o claim antes da hora — sem aquele filtro
   * o atraso seria ignorado, porque o claim lê `['waiting', 'delayed']`.
   *
   * Não há worker nesta fila, então o Bull tampouco promove `delayed` para `waiting` sozinho
   * (medido em 17/09). Quem "acorda" o job é o próprio poller do agent, a cada 3s, assim que a
   * hora passa — o que também significa que a granularidade real do agendamento é o intervalo
   * de polling, não o milissegundo.
   */
  async enqueue(action: string, payload: Record<string, unknown>, atrasoMs?: number): Promise<string> {
    const targetRole = ACTION_ROLE[action]

    // Falha rápido se o agent daquele role não dá sinal de vida há mais de 90s,
    // em vez de deixar o specialist pagar o timeout de 30s a cada tentativa numa
    // tarefa estruturalmente impossível (visto: 10 iterações, todas vazias, ~$0,01).
    if (targetRole && !this.heartbeat.isOnline(targetRole)) {
      const lastSeen = this.heartbeat.getLastSeenAt(targetRole)
      const ageMsg = lastSeen ? `last seen há ${Math.round((Date.now() - lastSeen) / 1000)}s` : 'nunca visto'
      throw new Error(`Agent ${targetRole} offline (${ageMsg})`)
    }

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
      ...(atrasoMs && atrasoMs > 0 ? { delay: atrasoMs } : {}),
    })

    const policySource = targetRole ? 'ACTION_ROLE_MAP' : 'UNRESOLVED_NO_ROLE'
    // `projectId` do payload: sem ele TODA tarefa do agent nascia orfa — 162 dos 245 registros
    // sem dono no banco (medido em 17/09), 66% do total. E a consequencia e maior que o invariante
    // vermelho: o historico de execucao ficava **invisivel a qualquer consulta com escopo de
    // projeto**, entao "o que o agent fez neste projeto?" nao tinha resposta a partir de eventos.
    //
    // `enrichJarvisPayload` ja coloca `projectId` no payload na maioria dos caminhos; quando nao
    // houver, o evento segue sem dono — e ai e orfao legitimo, nao defeito silencioso.
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : undefined
    this.eventService.create({ projectId, source: 'execution', type: 'execution', content: `${action}`, metadata: { action, payload, jobId: id, policySource } }).catch(() => null)
    return id
  }

  /** Enfileira e espera o resultado (teto de 30s). Para trabalho longo, use `enqueue()`. */
  async dispatch(action: string, payload: Record<string, unknown>): Promise<unknown> {
    const id = await this.enqueue(action, payload)
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
