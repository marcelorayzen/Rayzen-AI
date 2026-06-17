import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { IntentType } from './dto/intent-contract.dto'

export interface ServiceHealthCheck {
  ok:        boolean
  latencyMs: number
  note?:     string
}

export interface HealthReport {
  healthy:  boolean   // todos ok
  degraded: boolean   // alguns falharam mas pode continuar
  services: {
    litellm:  ServiceHealthCheck
    database: ServiceHealthCheck
    v1bridge: ServiceHealthCheck
  }
  // IntentTypes que não podem ser servidos no estado atual
  blockedIntentTypes: IntentType[]
  checkedAt: string
}

// Cache de 30s para não pingar infra a cada request
const CACHE_TTL_MS = 30_000

@Injectable()
export class JARVISHealthService {
  private readonly logger = new Logger(JARVISHealthService.name)
  private readonly litellmBaseUrl: string
  private readonly litellmKey: string

  private cache: { report: HealthReport; expiresAt: number } | null = null

  constructor(
    private readonly prisma:   PrismaV2Service,
    private readonly v1Bridge: V1BridgeService,
  ) {
    this.litellmBaseUrl = (process.env.LITELLM_BASE_URL ?? 'http://litellm:4000/v1').replace(/\/$/, '')
    this.litellmKey     = process.env.LITELLM_MASTER_KEY ?? ''
  }

  async check(forceRefresh = false): Promise<HealthReport> {
    if (!forceRefresh && this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.report
    }

    const [litellm, database, v1bridge] = await Promise.all([
      this.checkLiteLLM(),
      this.checkDatabase(),
      this.checkV1Bridge(),
    ])

    const healthy  = litellm.ok && database.ok && v1bridge.ok
    const degraded = !healthy && database.ok  // DB up = sistema funcional mínimo

    const blockedIntentTypes = this.deriveBlockedIntents({ litellm, database, v1bridge })

    const report: HealthReport = {
      healthy,
      degraded,
      services: { litellm, database, v1bridge },
      blockedIntentTypes,
      checkedAt: new Date().toISOString(),
    }

    this.cache = { report, expiresAt: Date.now() + CACHE_TTL_MS }

    if (!healthy) {
      this.logger.warn(`JARVIS health degraded — blocked: [${blockedIntentTypes.join(', ')}]`)
    }

    return report
  }

  private async checkLiteLLM(): Promise<ServiceHealthCheck> {
    const t0 = Date.now()
    try {
      const res = await fetch(`${this.litellmBaseUrl}/models`, {
        headers:  { Authorization: `Bearer ${this.litellmKey}` },
        signal:   AbortSignal.timeout(4000),
      })
      return { ok: res.ok, latencyMs: Date.now() - t0 }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, note: String(e) }
    }
  }

  private async checkDatabase(): Promise<ServiceHealthCheck> {
    const t0 = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { ok: true, latencyMs: Date.now() - t0 }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, note: String(e) }
    }
  }

  private async checkV1Bridge(): Promise<ServiceHealthCheck> {
    const t0 = Date.now()
    try {
      // Leve read-only que confirma a conexão V1 sem depender de projectId real
      await (this.v1Bridge as any)['prismaV1'].$queryRaw`SELECT 1`
      return { ok: true, latencyMs: Date.now() - t0 }
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, note: String(e) }
    }
  }

  private deriveBlockedIntents(services: HealthReport['services']): IntentType[] {
    const blocked: IntentType[] = []

    // Sem LiteLLM: nenhuma intenção que exige LLM pode ser servida
    if (!services.litellm.ok) {
      blocked.push(
        'generate_code', 'review_code', 'create_test', 'run_tests',
        'analyze_failure', 'generate_documentation', 'create_architecture',
        'database_migration', 'deploy', 'summarize_session', 'classify_intent',
        'client_discovery',
      )
    }

    // Sem DB V2: nada que cria missão ou lê memória funciona
    if (!services.database.ok) {
      blocked.push('generate_code', 'review_code', 'create_test', 'run_tests',
        'analyze_failure', 'generate_documentation', 'create_architecture',
        'database_migration', 'deploy', 'update_roadmap',
      )
    }

    // V1Bridge down: intenções que dependem de contexto de projeto V1 ficam degradadas
    // mas não são bloqueadas — funcionam sem contexto enriquecido
    if (!services.v1bridge.ok) {
      // apenas loga — não bloqueia, context broker retorna '' em falha
      this.logger.warn('V1Bridge down — context enrichment disabled for this request')
    }

    // Dedup
    return [...new Set(blocked)]
  }
}
