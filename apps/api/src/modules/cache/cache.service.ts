import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, RedisClientType } from 'redis'

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name)
  private client!: RedisClientType
  private ready = false

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379')
    this.client = createClient({ url }) as RedisClientType
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`))
    try {
      await this.client.connect()
      this.ready = true
    } catch (err) {
      this.logger.warn('Redis unavailable — cache disabled')
    }
  }

  async onModuleDestroy() {
    if (this.ready) await this.client.quit()
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.ready) return null
    try {
      const val = await this.client.get(key)
      return val ? (JSON.parse(val) as T) : null
    } catch {
      return null
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    if (!this.ready) return
    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value))
    } catch { /* non-fatal */ }
  }

  async del(key: string): Promise<void> {
    if (!this.ready) return
    try {
      await this.client.del(key)
    } catch { /* non-fatal */ }
  }

  async delPattern(pattern: string): Promise<void> {
    if (!this.ready) return
    try {
      const keys = await this.client.keys(pattern)
      if (keys.length) await this.client.del(keys)
    } catch { /* non-fatal */ }
  }
}
