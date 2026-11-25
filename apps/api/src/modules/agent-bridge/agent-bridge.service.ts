import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { AgentRole, ReconciliationOutcome, Task, TaskStatus } from '@rayzen/types'
import { createHash, randomUUID } from 'crypto'
import { canonicalJson } from './agent-task-broker.service'
import { PrismaService } from '../../prisma/prisma.service'
import { sincronizarHandoffComTarefa } from '../handoff/handoff-tarefa'

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
const TRANSICAO_TTL_MS = 30_000
const SEQUENCIA_FENCING = 'claim:fence:sequence'

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

function chaveDeTransicao(taskId: string): string {
  return `claim:transition:${taskId}`
}

function valorDaPosse(dono: string, fencingToken: string): string {
  return JSON.stringify({ dono, fencingToken })
}

const APAGAR_SE_IGUAL = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`

export type ResultadoAtualizacao = 'updated' | 'already_applied' | 'not_found' | 'stale' | 'busy'

export interface ReconcileEffectUnknownInput {
  outcome: ReconciliationOutcome
  actor: string
  actorType: 'approval_token'
  reason: string
  evidence?: Record<string, unknown>
}

export interface ResultadoReconciliacao {
  result: ResultadoAtualizacao
  task?: Task
}

function hashDaReconciliacao(input: ReconcileEffectUnknownInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex')
}

interface RedisClaimClient {
  set(
    key: string,
    value: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX' | 'XX',
  ): Promise<'OK' | null>
  get(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>
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
  // `PrismaService` e `@Global`, e a sincronizacao do handoff e uma FUNCAO pura — nenhum dos
  // dois cria aresta de modulo. Injetar um `HandoffService` aqui fecharia o grafo
  // (handoff -> execution -> agent-bridge) e o Nest se recusaria a subir.
  constructor(
    @InjectQueue('agent-tasks') private queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async getPending(role?: AgentRole): Promise<Task[]> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed'])
    return jobs
      .filter(jaEstaNaHora)
      .map((j) => j.data as Task)
      .filter((t) => t.status === 'pending')
      .filter((t) => !t.targetRole || !role || t.targetRole === role)
  }

  private get redis(): RedisClaimClient {
    return (this.queue as unknown as { client: RedisClaimClient }).client
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

    const taskId = matching.id as string
    const dono = hostname ?? 'desconhecido'
    const provisoria = valorDaPosse(dono, `pending:${randomUUID()}`)
    const locked = await this.redis.set(chaveDePosse(taskId), provisoria, 'PX', POSSE_TTL_MS, 'NX')
    if (!locked) return null  // outro agent já reivindicou

    let valorFinal = provisoria
    try {
      const fencingToken = String(await this.redis.incr(SEQUENCIA_FENCING))
      valorFinal = valorDaPosse(dono, fencingToken)
      const promovida = await this.redis.set(chaveDePosse(taskId), valorFinal, 'PX', POSSE_TTL_MS, 'XX')
      if (promovida !== 'OK') throw new Error(`Posse provisoria da tarefa ${taskId} expirou durante o claim`)

      const claimed: Task = {
        ...matching.data as Task,
        status: 'processing',
        fencingToken,
        updatedAt: new Date().toISOString(),
      }
      await matching.update(claimed)
      await sincronizarHandoffComTarefa(this.prisma, taskId, { tipo: 'claim' })
      return claimed
    } catch (err) {
      await this.apagarSeIgual(chaveDePosse(taskId), valorFinal)
      if (valorFinal !== provisoria) await this.apagarSeIgual(chaveDePosse(taskId), provisoria)
      throw err
    }
  }

  /**
   * Renova a posse enquanto a execução continua. **Só o dono renova**: sem a comparação, um
   * segundo agent estenderia a posse de outro e a tarefa nunca seria reconhecida como órfã —
   * o lease viraria um relógio que ninguém pode parar.
   *
   * `XX` (só se já existir) é o outro lado da mesma regra: posse que já expirou não volta por
   * renovação. Quem perdeu a posse precisa passar pelo claim de novo, onde a poda acontece.
   */
  async renovarPosse(taskId: string, hostname?: string, fencingToken?: string): Promise<boolean> {
    const dono = hostname ?? 'desconhecido'
    const chave = chaveDePosse(taskId)
    const esperado = fencingToken ? valorDaPosse(dono, fencingToken) : dono

    const atual = await this.redis.get(chave)
    if (atual !== esperado) return false

    const r = await this.redis.set(chave, esperado, 'PX', POSSE_TTL_MS, 'XX')
    // O batimento e o unico sinal que separa "peguei a tarefa" de "estou executando":
    // a tarefa expoe `processing` uma vez so, no claim.
    if (r === 'OK') await sincronizarHandoffComTarefa(this.prisma, taskId, { tipo: 'heartbeat' })
    return r === 'OK'
  }

  /**
   * Tarefa `processing` sem posse ativa = o executor sumiu. Até 13/09 ela ficava assim para
   * sempre: `claimTask` só olhava `pending`, então ninguém a reclamava, ninguém a falhava e
   * ninguém a via — três estavam presas desde 17/06/2026.
   *
   * **Não re-executa.** Repetir cegamente é o único desfecho pior que ficar preso: o efeito
   * pode ter ocorrido antes de o executor morrer, e boa parte das 43 ações não é idempotente
   * (um `git push`, um e-mail enviado, um arquivo apagado). O estado incerto vira
   * `effect_unknown`, e a decisão de repetir fica com quem pode verificar.
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

      const trava = await this.adquirirTransicao(t.id)
      if (!trava) continue
      try {
        const atual = await this.queue.getJob(String(j.id))
        const job = atual ?? j
        const fresco = job.data as Task
        if (fresco.status !== 'processing') continue
        if (await this.redis.get(chaveDePosse(fresco.id))) continue

        await job.update({
          ...fresco,
          status: 'effect_unknown',
          error: MOTIVO_ORFA,
          updatedAt: new Date().toISOString(),
        })
        // Executor sumiu: o envelope precisa refletir que o efeito e incerto, senao ele fica
        // parado em `executing` para sempre — o mesmo defeito das tres tarefas presas desde
        // 17/06 que o A05 consertou, uma camada acima.
        await sincronizarHandoffComTarefa(this.prisma, fresco.id, { tipo: 'status', status: 'effect_unknown' })
      } finally {
        await this.liberarTransicao(t.id, trava)
      }
    }
  }

  async getById(id: string): Promise<Task | null> {
    const jobs = await this.queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'])
    const job  = jobs.find((j) => j.id === id)
    return job ? (job.data as Task) : null
  }

  async getEffectUnknown(limit = 100): Promise<Task[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)
    const jobs = await this.queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed'])
    return jobs
      .map((job) => job.data as Task)
      .filter((task) => task.status === 'effect_unknown')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, safeLimit)
  }

  /**
   * Fecha uma incerteza somente por decisão humana autenticada. A mesma trava usada pela
   * conclusão do executor impede que um resultado atrasado e uma reconciliação atravessem a
   * mesma transição.
   */
  async reconcileEffectUnknown(
    id: string,
    input: ReconcileEffectUnknownInput,
  ): Promise<ResultadoReconciliacao> {
    const trava = await this.adquirirTransicao(id)
    if (!trava) return { result: 'busy' }

    try {
      const job = await this.queue.getJob(id)
      if (!job) return { result: 'not_found' }
      const task = job.data as Task
      const resolutionHash = hashDaReconciliacao(input)

      if (task.reconciliation) {
        return task.reconciliation.resolutionHash === resolutionHash
          ? { result: 'already_applied', task }
          : { result: 'stale', task }
      }
      if (task.status !== 'effect_unknown') return { result: 'stale', task }

      const status: TaskStatus = input.outcome === 'effect_confirmed'
        ? 'done'
        : input.outcome === 'effect_not_observed'
          ? 'failed_safe'
          : 'compensated'
      const resolvedAt = new Date().toISOString()
      const reconciled: Task = {
        ...task,
        status,
        result: {
          previousResult: task.result,
          reconciliationOutcome: input.outcome,
        },
        error: input.outcome === 'effect_not_observed'
          ? `Falha segura confirmada por reconciliação humana: ${input.reason}`
          : undefined,
        reconciliation: { ...input, resolutionHash, resolvedAt },
        updatedAt: resolvedAt,
      }
      await job.update(reconciled)
      // A reconciliacao humana e quem decide se houve efeito. O envelope repete a decisao,
      // nunca a reinterpreta.
      await sincronizarHandoffComTarefa(this.prisma, id, { tipo: 'status', status })
      return { result: 'updated', task: reconciled }
    } finally {
      await this.liberarTransicao(id, trava)
    }
  }

  async updateStatus(
    id: string,
    status: Extract<TaskStatus, 'done' | 'failed'>,
    result?: unknown,
    error?: string,
    hostname?: string,
    fencingToken?: string,
  ): Promise<ResultadoAtualizacao> {
    const trava = await this.adquirirTransicao(id)
    if (!trava) return 'busy'

    try {
      const job = await this.queue.getJob(id)
      if (!job) return 'not_found'
      const task = job.data as Task

      if (task.status === status && task.fencingToken === fencingToken) return 'already_applied'
      if (task.status !== 'processing') return 'stale'

      const dono = hostname ?? 'desconhecido'
      const tokenEsperado = task.fencingToken
      if (tokenEsperado !== fencingToken) return 'stale'

      const valorEsperado = tokenEsperado ? valorDaPosse(dono, tokenEsperado) : dono
      if (await this.redis.get(chaveDePosse(id)) !== valorEsperado) return 'stale'

      await job.update({ ...task, status, result, error, updatedAt: new Date().toISOString() })
      await this.apagarSeIgual(chaveDePosse(id), valorEsperado)
      await sincronizarHandoffComTarefa(this.prisma, id, { tipo: 'status', status })
      return 'updated'
    } finally {
      await this.liberarTransicao(id, trava)
    }
  }

  private async adquirirTransicao(taskId: string): Promise<string | null> {
    const token = randomUUID()
    const ok = await this.redis.set(chaveDeTransicao(taskId), token, 'PX', TRANSICAO_TTL_MS, 'NX')
    return ok === 'OK' ? token : null
  }

  private async liberarTransicao(taskId: string, token: string): Promise<void> {
    await this.apagarSeIgual(chaveDeTransicao(taskId), token)
  }

  private async apagarSeIgual(chave: string, valor: string): Promise<void> {
    await this.redis.eval(APAGAR_SE_IGUAL, 1, chave, valor)
  }
}
