import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { createClient, RedisClientType } from 'redis'
import { AgentHeartbeatService } from '../agent-bridge/agent-heartbeat.service'
import { AgentRole } from '@rayzen/types'

export interface ServiceStatus {
  ok:         boolean
  latencyMs?: number
  error?:     string
  meta?:      Record<string, unknown>
}

export interface InfraHealthReport {
  ok:       boolean
  services: {
    postgres:      ServiceStatus
    redis:         ServiceStatus
    litellm:       ServiceStatus
    api_v2:        ServiceStatus
    mcp:           ServiceStatus
    hook_jwt:      ServiceStatus
    agent_desktop: ServiceStatus
  }
  checkedAt: string
}

@Injectable()
export class InfraHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InfraHealthService.name)
  private redis!: RedisClientType
  private redisReady = false

  constructor(
    private readonly prisma:     PrismaService,
    private readonly config:     ConfigService,
    private readonly heartbeat:  AgentHeartbeatService,
  ) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379')
    this.redis = createClient({ url, socket: { connectTimeout: 3000 } }) as RedisClientType
    this.redis.on('error', () => { this.redisReady = false })
    try {
      await this.redis.connect()
      this.redisReady = true
    } catch {
      this.logger.warn('InfraHealth: Redis unavailable on init')
    }
  }

  async onModuleDestroy() {
    try { if (this.redisReady) await this.redis.quit() } catch { /* ignore */ }
  }

  async check(): Promise<InfraHealthReport> {
    const [postgres, redis, litellm, api_v2, mcp] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkHttp(this.litellmHealthUrl()),
      this.checkHttp(this.apiV2Url()),
      this.checkHttp(this.mcpUrl()),
    ])
    const hook_jwt      = this.checkJwt()
    const agent_desktop = this.checkAgentHeartbeat('desktop')

    const services = { postgres, redis, litellm, api_v2, mcp, hook_jwt, agent_desktop }
    const ok = Object.values(services).every((s) => s.ok)
    return { ok, services, checkedAt: new Date().toISOString() }
  }

  private checkAgentHeartbeat(role: AgentRole): ServiceStatus {
    const online   = this.heartbeat.isOnline(role)
    const lastSeen = this.heartbeat.getLastSeenAt(role)
    if (!online) {
      const ago = lastSeen ? `offline ha ${Math.round((Date.now() - lastSeen) / 1000)}s` : 'nunca conectou'
      return { ok: false, error: ago, meta: lastSeen ? { lastSeenAt: new Date(lastSeen).toISOString() } : undefined }
    }
    return { ok: true, meta: { lastSeenAt: lastSeen ? new Date(lastSeen).toISOString() : undefined } }
  }

  private async checkPostgres(): Promise<ServiceStatus> {
    const t = Date.now()
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { ok: true, latencyMs: Date.now() - t }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    if (!this.redisReady) {
      // Try reconnecting once
      try { await this.redis.connect(); this.redisReady = true } catch { /* ignore */ }
    }
    if (!this.redisReady) return { ok: false, error: 'desconectado' }
    const t = Date.now()
    try {
      await this.redis.ping()
      return { ok: true, latencyMs: Date.now() - t }
    } catch (e) {
      this.redisReady = false
      return { ok: false, error: String(e) }
    }
  }

  private async checkHttp(url: string): Promise<ServiceStatus> {
    const t = Date.now()
    try {
      const ctrl    = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 3000)
      const res     = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timeout)
      return { ok: res.status < 500, latencyMs: Date.now() - t }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * Validade do token — lida do próprio token, não de uma data anotada.
   *
   * Isto lia `HOOK_JWT_EXPIRES_AT` do `.env`: uma data que alguém precisa lembrar
   * de atualizar toda vez que o token é rotacionado. Em 2026-08-15 o token foi
   * renovado para 14/09 e o painel continuou anunciando "12 dias para expirar",
   * porque a anotação ficou em 27/08. Um painel de saúde que depende de alguém
   * atualizar um texto à mão informa o que escreveram, não o que é.
   *
   * O `exp` está dentro do JWT. Decodificar é barato e não pode divergir.
   */
  private checkJwt(): ServiceStatus {
    const doToken = this.expDoToken(this.config.get<string>('AGENT_TOKEN', ''))

    // Fallback só para o caso de o token não ser um JWT (houve tokens opacos de
    // 48 chars nesta base). A origem vai no meta: número sem procedência é como
    // o painel passou a mentir da primeira vez.
    const anotado  = this.config.get<string>('HOOK_JWT_EXPIRES_AT', '')
    const fonte    = doToken ? 'token' : 'env:HOOK_JWT_EXPIRES_AT'
    const expDate  = doToken ?? (anotado ? new Date(anotado) : null)

    if (!expDate || Number.isNaN(expDate.getTime())) {
      return { ok: false, error: 'validade do token indeterminada', meta: { fonte } }
    }

    const expiresAt = expDate.toISOString().slice(0, 10)
    const daysLeft  = Math.floor((expDate.getTime() - Date.now()) / 86400000)

    if (daysLeft < 0)  return { ok: false, error: 'JWT expirado', meta: { expiresAt, fonte } }
    if (daysLeft < 14) return { ok: true,  meta: { expiresAt, daysLeft, fonte, warning: `expira em ${daysLeft}d` } }
    return { ok: true, meta: { expiresAt, daysLeft, fonte } }
  }

  /** `exp` do payload do JWT, ou null se não for um JWT legível. */
  private expDoToken(token: string): Date | null {
    const partes = token.split('.')
    if (partes.length !== 3) return null
    try {
      const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString()) as { exp?: number }
      return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null
    } catch {
      return null
    }
  }

  /**
   * `/health/liveliness`, não `/health`.
   *
   * O `/health` do LiteLLM roda um health check por modelo configurado e cada um
   * vira um trace no Langfuse. Como a web e o widget fazem polling deste endpoint,
   * isso gerava ~190 traces por hora: em 2026-08-13 eram 148.892 de 158.806 traces
   * na base, ou seja **94% do Langfuse era health check**, afogando os traces que
   * têm valor. Não custava tokens (0 em 24h), mas tornava a instância ilegível.
   *
   * `/health/liveliness` responde 200 sem tocar em modelo nenhum e sem gerar trace —
   * que é exatamente a pergunta deste painel: "o LiteLLM está de pé?", não "todos os
   * modelos respondem?".
   */
  private litellmHealthUrl(): string {
    const base = this.config.get<string>('LITELLM_BASE_URL', 'http://localhost:4100/v1')
    return base.replace(/\/v1$/, '') + '/health/liveliness'
  }

  private apiV2Url(): string {
    return this.config.get<string>('API_V2_URL', 'http://localhost:3103') + '/v2/ping'
  }

  private mcpUrl(): string {
    return this.config.get<string>('MCP_HTTP_URL', 'http://localhost:3102') + '/health'
  }
}
