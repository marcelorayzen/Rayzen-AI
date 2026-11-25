import { Injectable, OnModuleInit } from '@nestjs/common'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'

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
  premiumStateRefresh?: boolean  // usa Claude Sonnet no refresh de ProjectState; false = Groq
}

const CONFIG_PATHS = [
  resolve(process.cwd(), 'rayzen.config.json'),
  resolve(process.cwd(), '../../rayzen.config.json'),
  resolve(__dirname, '../../../../../rayzen.config.json'),
]

const LITELLM_CONFIG_PATHS = [
  resolve(process.cwd(), 'infra/litellm/config.yaml'),
  resolve(process.cwd(), '../../infra/litellm/config.yaml'),
  resolve(__dirname, '../../../../../infra/litellm/config.yaml'),
]

export type LlmProvider = 'groq' | 'claude'

const LITELLM_CONFIGS: Record<LlmProvider, string> = {
  groq: `model_list:
  - model_name: gpt-4o
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY

  - model_name: gpt-4o-mini
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY

  # Speech to Text
  - model_name: whisper-1
    litellm_params:
      model: groq/whisper-large-v3-turbo
      api_key: os.environ/GROQ_API_KEY

  # Text to Speech
  - model_name: tts-1
    litellm_params:
      model: groq/playai-tts
      api_key: os.environ/GROQ_API_KEY

  # Embeddings (mantém OpenAI pois Groq não tem)
  - model_name: embedding
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

router_settings:
  routing_strategy: least-busy
  allowed_fails: 2
  cooldown_time: 60
`,
  claude: `model_list:
  - model_name: gpt-4o
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: gpt-4o-mini
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  # Speech to Text
  - model_name: whisper-1
    litellm_params:
      model: groq/whisper-large-v3-turbo
      api_key: os.environ/GROQ_API_KEY

  # Text to Speech
  - model_name: tts-1
    litellm_params:
      model: groq/playai-tts
      api_key: os.environ/GROQ_API_KEY

  # Embeddings (mantém OpenAI pois Groq não tem)
  - model_name: embedding
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/OPENAI_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

router_settings:
  routing_strategy: least-busy
  allowed_fails: 2
  cooldown_time: 60
`,
}

// custo blended estimado por token (60% input + 40% output)
export const LLM_COST_PER_TOKEN: Record<LlmProvider, number> = {
  groq:   0.70 / 1_000_000,  // ~$0.70/MTok
  claude: 9.00 / 1_000_000,  // ~$9.00/MTok (Sonnet 4)
}

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

  getLlmProvider(): LlmProvider {
    const configPath = LITELLM_CONFIG_PATHS.find((p) => existsSync(p))
    if (!configPath) return 'groq'
    try {
      const raw = require('fs').readFileSync(configPath, 'utf-8') as string
      return raw.includes('anthropic/') ? 'claude' : 'groq'
    } catch {
      return 'groq'
    }
  }

  async setLlmProvider(provider: LlmProvider): Promise<void> {
    // 1. Escreve o config se o arquivo estiver acessível (dev ou volume montado)
    const configPath = LITELLM_CONFIG_PATHS.find((p) => existsSync(p))
    if (configPath) {
      await writeFile(configPath, LITELLM_CONFIGS[provider], 'utf-8')
    }

    // 2. Recarrega modelos via API dinâmica do LiteLLM (sem reiniciar container)
    const litellmBase = process.env.LITELLM_BASE_URL?.replace('/v1', '') ?? 'http://litellm:4000'
    const masterKey = process.env.LITELLM_MASTER_KEY ?? ''
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${masterKey}` }

    // Remove modelos existentes
    try {
      const modelsRes = await fetch(`${litellmBase}/model/info`, { headers })
      if (modelsRes.ok) {
        const { data } = await modelsRes.json() as { data: Array<{ model_info: { id: string } }> }
        await Promise.all(
          (data ?? []).map((m) =>
            fetch(`${litellmBase}/model/delete`, {
              method: 'POST', headers,
              body: JSON.stringify({ id: m.model_info?.id }),
            }),
          ),
        )
      }
    } catch { /* ignora se não conseguir limpar */ }

    // Adiciona novos modelos do provider escolhido
    const newModels = provider === 'claude'
      ? [
          { model_name: 'gpt-4o',      litellm_params: { model: 'anthropic/claude-sonnet-4-20250514', api_key: process.env.ANTHROPIC_API_KEY } },
          { model_name: 'gpt-4o-mini', litellm_params: { model: 'anthropic/claude-sonnet-4-20250514', api_key: process.env.ANTHROPIC_API_KEY } },
        ]
      : [
          { model_name: 'gpt-4o',      litellm_params: { model: 'groq/llama-3.3-70b-versatile', api_key: process.env.GROQ_API_KEY } },
          { model_name: 'gpt-4o-mini', litellm_params: { model: 'groq/llama-3.3-70b-versatile', api_key: process.env.GROQ_API_KEY } },
        ]

    for (const m of newModels) {
      await fetch(`${litellmBase}/model/new`, {
        method: 'POST', headers,
        body: JSON.stringify(m),
      })
    }
  }
}
