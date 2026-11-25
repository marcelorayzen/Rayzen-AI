import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { createHash, randomUUID } from 'crypto'
import { Task, TaskCreateDto } from '@rayzen/types'

const PREFIXO_IDEMPOTENCIA = 'idempotency:agent-task:'

interface BrokerRedisClient {
  set(key: string, value: string, condition: 'NX'): Promise<'OK' | null>
  get(key: string): Promise<string | null>
}

interface RegistroIdempotencia {
  requestHash: string
  taskId: string
}

export interface EnqueueTaskOptions {
  delayMs?: number
}

export interface EnqueueTaskResult {
  task: Task
  replayed: boolean
}

export class IdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key "${idempotencyKey}" ja foi usada com outro pedido`)
    this.name = 'IdempotencyConflictError'
  }
}

/** JSON determinístico para que ordem de chaves não altere o hash da intenção. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? 'null' : canonicalJson(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    return `{${entries.join(',')}}`
  }
  return 'null'
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function validarChave(chave: string): string {
  const normalizada = chave.trim()
  if (!normalizada) throw new Error('idempotencyKey nao pode ser vazia')
  if (normalizada.length > 200) throw new Error('idempotencyKey excede 200 caracteres')
  return normalizada
}

/**
 * Único escritor da fila `agent-tasks`.
 *
 * O próprio `queue.add` do Bull é a arbitragem atômica: com `jobId` determinístico, apenas um dos
 * pedidos concorrentes grava dados. O registro separado preserva hash e identidade mesmo se houver
 * limpeza posterior da fila. A ordem é deliberada: primeiro o job, depois o registro. Assim uma
 * queda antes do add é repetível; registro existente sem job falha fechado e nunca recria um efeito
 * que talvez já tenha ocorrido.
 */
@Injectable()
export class AgentTaskBrokerService {
  constructor(@InjectQueue('agent-tasks') private readonly queue: Queue) {}

  private get redis(): BrokerRedisClient {
    return (this.queue as unknown as { client: BrokerRedisClient }).client
  }

  async enqueue(dto: TaskCreateDto, options: EnqueueTaskOptions = {}): Promise<EnqueueTaskResult> {
    const idempotencyKey = validarChave(dto.idempotencyKey)
    const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 0))
    const requestHash = sha256(canonicalJson({
      module: dto.module,
      action: dto.action,
      payload: dto.payload,
      targetRole: dto.targetRole ?? null,
      delayMs,
    }))
    const keyHash = sha256(idempotencyKey)
    const redisKey = `${PREFIXO_IDEMPOTENCIA}${keyHash}`
    const taskId = `idem-${keyHash}`
    const registeredRaw = await this.redis.get(redisKey)
    if (registeredRaw) {
      let registered: RegistroIdempotencia
      try {
        registered = JSON.parse(registeredRaw) as RegistroIdempotencia
      } catch {
        throw new Error(`Registro idempotente corrompido para ${taskId}`)
      }
      if (registered.requestHash !== requestHash) throw new IdempotencyConflictError(idempotencyKey)
      const existing = await this.queue.getJob(registered.taskId)
      if (!existing) {
        throw new Error(`Intencao ${registered.taskId} ja foi aceita, mas o job nao esta mais disponivel; reconciliacao manual necessaria`)
      }
      const task = existing.data as Task
      if (task.requestHash !== requestHash) throw new IdempotencyConflictError(idempotencyKey)
      return { task, replayed: true }
    }

    const existingJob = await this.queue.getJob(taskId)
    if (existingJob) {
      const task = existingJob.data as Task
      if (task.requestHash !== requestHash) throw new IdempotencyConflictError(idempotencyKey)
      const marked = await this.redis.set(redisKey, JSON.stringify({ requestHash, taskId }), 'NX')
      return { task, replayed: marked !== 'OK' }
    }

    const now = new Date().toISOString()
    const candidate: Task = {
      id: taskId,
      module: dto.module,
      action: dto.action,
      payload: dto.payload,
      ...(dto.targetRole ? { targetRole: dto.targetRole } : {}),
      idempotencyKey,
      requestHash,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await this.queue.add('execute', candidate, {
      jobId: candidate.id,
      attempts: 3,
      backoff: 5000,
      removeOnComplete: false,
      removeOnFail: false,
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    })

    const persisted = await this.queue.getJob(candidate.id)
    if (!persisted) throw new Error(`Bull aceitou ${candidate.id}, mas o job nao foi encontrado`)
    const task = persisted.data as Task
    if (task.requestHash !== requestHash) throw new IdempotencyConflictError(idempotencyKey)
    const marked = await this.redis.set(redisKey, JSON.stringify({ requestHash, taskId }), 'NX')
    return { task, replayed: marked !== 'OK' }
  }

  /** Chave nova para intenções que ainda não possuem identidade persistente própria. */
  newKey(namespace: string): string {
    return `${namespace}:${randomUUID()}`
  }
}
