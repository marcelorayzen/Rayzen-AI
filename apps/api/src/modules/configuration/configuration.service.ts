import { Injectable, OnModuleInit } from '@nestjs/common'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'

export interface RayzenConfig {
  identity: {
    name: string
    language: string
    personality: string
  }
  modules: Record<string, boolean>
  llm: Record<string, { model: string; temperature: number }>
  agent: {
    pollIntervalMs: number
    actions: Record<string, boolean>
    sandbox: {
      paths: string[]
      allowedApps: string[]
      allowedDomains: string[]
    }
    security: Record<string, boolean>
  }
  tts: {
    provider: string
    voice: string
  }
  obsidian: {
    vaultPath: string
    vaultName: string
  }
  notion: {
    rootPageId: string  // ID da página raiz "Rayzen AI" no Notion
  }
}

const CONFIG_PATHS = [
  resolve(process.cwd(), 'rayzen.config.json'),
  resolve(process.cwd(), '../../rayzen.config.json'),
  resolve(__dirname, '../../../../../rayzen.config.json'),
]

// Prefixo Rayzen para evitar conflito de nome com ConfigService do @nestjs/config
@Injectable()
export class RayzenConfigService implements OnModuleInit {
  private config!: RayzenConfig
  private configPath!: string

  async onModuleInit() {
    await this.load()
  }

  private async load() {
    this.configPath = CONFIG_PATHS.find((p) => existsSync(p)) ?? CONFIG_PATHS[0]
    try {
      const raw = await readFile(this.configPath, 'utf-8')
      this.config = JSON.parse(raw) as RayzenConfig
    } catch {
      throw new Error(`rayzen.config.json não encontrado. Esperado em: ${this.configPath}`)
    }
  }

  getConfig(): RayzenConfig {
    return this.config
  }

  async updateConfig(patch: Partial<RayzenConfig>): Promise<RayzenConfig> {
    this.config = this.deepMerge(this.config, patch) as RayzenConfig
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
    return this.config
  }

  private deepMerge(target: unknown, source: unknown): unknown {
    if (typeof source !== 'object' || source === null) return source
    if (typeof target !== 'object' || target === null) return source
    const result = { ...(target as Record<string, unknown>) }
    for (const key of Object.keys(source as Record<string, unknown>)) {
      const sv = (source as Record<string, unknown>)[key]
      const tv = (target as Record<string, unknown>)[key]
      result[key] = typeof sv === 'object' && sv !== null && !Array.isArray(sv)
        ? this.deepMerge(tv, sv)
        : sv
    }
    return result
  }
}
