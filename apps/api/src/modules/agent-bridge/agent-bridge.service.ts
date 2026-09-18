import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { AgentRole, Task, TaskCreateDto, TaskStatus } from '@rayzen/types'
import { randomUUID } from 'crypto'

/**
 * ── A05: o lock virou LEASE de posse ─────────────────────────────────────────
 *
 * Este valor era `30_000`, com o comentário *"cobre o tempo máximo de processamento"* — e isso
 * **nunca foi verdade**: uma sessão supervisionada dura horas, um `screenshot` dura segundos.
 * Não existe número que sirva de teto para as duas coisas, e era por tentar ser um teto que ele
 * não servia para nada.
 *
 * Agora é **sinal de vida**: quem está executando RENOVA (`renovarPosse`), quem morreu para de
 * renovar. Por isso o TTL é curto de propósito — quanto menor, mais rápido um executor morto é
 * detectado; quem está vivo não é afetado, porque renova bem antes de expirar.
 */
const POSSE_TTL_MS = 60_000

/** Intervalo máximo recomendado de renovação, para quem executa. Folga de 3× sobre o TTL. */
export const RENOVAR_POSSE_A_CADA_MS = 20_000

/**
 * O que fica gravado numa tarefa cujo executor sumiu. **Não é "falhou"** no sentido de ter dado
 * erro: é "não sabemos". A mensagem precisa dizer isso a quem for ler, porque a decisão de
 * repetir depende de uma verificação que só uma pessoa pode fazer.
 */
const MOTIVO_ORFA =
  'Posse perdida: o executor parou de renovar a posse e a tarefa não foi concluída. ' +
  'Não se sabe se o efeito chegou a ocorrer — verifique antes de repetir.'

function chaveDePosse(taskId: string): string {
  return `claim:task:${taskId}`
}


/**
 * ── Job atrasado só é reivindicável quando a hora chega ──────────────────────
 *
 * `getJobs(['waiting', 'delayed'])` devolve TUDO que está na fila, inclusive o que o Bull
 * marcou como `delayed` justamente por ainda não estar na hora. Medido em 17/09: um job com
 * 600 s de atraso volta nessa lista com `estado=delayed` — e o claim o entregaria na hora,
 * executando na mesma hora um pedido marcado para depois.
 *
 * Não deu para notar até agora porque **nada criava job com atraso**: não há worker Bull nesta
 * fila (nenhum `queue.process`), então `attempts`/`backoff` nunca entram em cena e o estado
 * `delayed` simplesmente não acontecia. O defeito é latente desde que o claim foi escrito.
 *
 * ── E por que não basta tirar `delayed` da lista ─────────────────────────────
 *
 * Porque **sem worker o Bull não promove `delayed` → `waiting`**. Medido: job com 3 s de atraso
 * continuava `delayed` sete segundos depois. Tirar da lista faria todo agendamento nunca rodar —
 * a armadilha oposta, e mais silenciosa.
 *
 * Então a hora é calculada aqui: `timestamp` (criação, ms) + `opts.delay`. Sem `delay`, pronto.
 */
export function jaEstaNaHora(job: { timestamp?: number; opts?: { delay?: number } }): boolean {
  const atraso = Number(job.opts?.delay ?? 0)
  if (!atraso) return true
  return Number(job.timestamp ?? 0) + atraso <= Date.now()
}

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
      .filter(jaEstaNaHora)
      .map((j) => j.data as Task)
      .filter((t) => t.status === 'pending')
      .filter((t) => !t.targetRole || !role || t.targetRole === role)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get redis(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.queue as unknown as { client: any }).client
  }

  /**
   * Atomicamente reivindica UMA tarefa pendente, registrando a posse no Redis.
   * Dois agents simultâneos com o mesmo role nunca executam a mesma tarefa.
   *
   * A cada pedido de trabalho, aproveita para **podar órfãs** (A05) — sem ciclo novo: quem
   * pergunta "tem algo para mim?" já está acordado, e o poller pergunta a cada 3s. Criar um
   * ciclo agendado para isso exigiria declará-lo no catálogo de batimentos, e seria mais
   * máquina do que o problema pede.
   */
  async claimTask(role?: AgentRole, hostname?: string): Promise<Task | null> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed'])

    await this.recuperarOrfas(jobs)

    const matching = jobs.find((j) => {
      const t = j.data as Task
      // `jaEstaNaHora` PRIMEIRO: sem ele, um pedido marcado para depois seria executado agora.
      return jaEstaNaHora(j) && t.status === 'pending' && (!t.targetRole || !role || t.targetRole === role)
    })
    if (!matching) return null

    const dono = hostname ?? 'desconhecido'
    const locked = await this.redis.set(chaveDePosse(matching.id as string), dono, 'PX', POSSE_TTL_MS, 'NX')
    if (!locked) return null  // outro agent já reivindicou

    const claimed: Task = { ...matching.data as Task, status: 'processing', updatedAt: new Date().toISOString() }
    await matching.update(claimed)
    return claimed
  }

  /**
   * Renova a posse enquanto a execução continua. **Só o dono renova**: sem a comparação, um
   * segundo agent estenderia a posse de outro e a tarefa nunca seria reconhecida como órfã —
   * o lease viraria um relógio que ninguém pode parar.
   *
   * `XX` (só se já existir) é o outro lado da mesma regra: posse que já expirou não volta por
   * renovação. Quem perdeu a posse precisa passar pelo claim de novo, onde a poda acontece.
   */
  async renovarPosse(taskId: string, hostname?: string): Promise<boolean> {
    const dono = hostname ?? 'desconhecido'
    const chave = chaveDePosse(taskId)

    const atual = await this.redis.get(chave)
    if (atual !== dono) return false

    const r = await this.redis.set(chave, dono, 'PX', POSSE_TTL_MS, 'XX')
    return r === 'OK'
  }

  /**
   * Tarefa `processing` sem posse ativa = o executor sumiu. Até 13/09 ela ficava assim para
   * sempre: `claimTask` só olhava `pending`, então ninguém a reclamava, ninguém a falhava e
   * ninguém a via — três estavam presas desde 17/06/2026.
   *
   * **Não re-executa.** Repetir cegamente é o único desfecho pior que ficar preso: o efeito
   * pode ter ocorrido antes de o executor morrer, e boa parte das 43 ações não é idempotente
   * (um `git push`, um e-mail enviado, um arquivo apagado). O estado incerto vira `failed` com
   * o motivo dizendo exatamente isso, e a decisão de repetir fica com quem pode verificar.
   *
   * Sem filtro de role de propósito: órfã não pertence mais a executor nenhum, e exigir que o
   * mesmo role volte para podá-la deixaria presa justamente a tarefa do agent que não voltou.
   */
  private async recuperarOrfas(jobs: { id: unknown; data: unknown; update: (t: Task) => Promise<unknown> }[]): Promise<void> {
    for (const j of jobs) {
      const t = j.data as Task
      if (t.status !== 'processing') continue

      const posse = await this.redis.get(chaveDePosse(t.id))
      if (posse) continue  // vivo: renovou dentro do TTL

      await j.update({ ...t, status: 'failed', error: MOTIVO_ORFA, updatedAt: new Date().toISOString() })
    }
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
