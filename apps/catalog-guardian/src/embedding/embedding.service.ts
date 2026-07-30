import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// Backlog "busca substring" fechado: busca semântica via embeddings no lugar
// de casar palavra solta. Chama a Jina API direto (mesmo padrão de
// apps/api/src/modules/memory/memory.service.ts) — não é a mesma regra de
// "sempre via LiteLLM" das chamadas de chat completion (LlmService); Jina é
// o provedor de embedding dedicado usado assim em todo o Rayzen, nunca
// proxied. Replicado aqui como código próprio, não import cross-app (app
// isolado, ver BLUEPRINT.md § Posicionamento).
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name)
  private readonly apiKey: string

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('JINA_API_KEY', '')
  }

  // Lança se a chave não estiver configurada ou a chamada falhar — quem
  // chama decide como degradar (ver QueryService, cai pro substring).
  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('JINA_API_KEY não configurado')
    }

    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: 'jina-embeddings-v3', input: [text], dimensions: 1024 }),
    })

    const data = (await res.json()) as { data?: Array<{ embedding: number[] }>; detail?: string; error?: string }

    if (!res.ok || !data.data?.[0]?.embedding) {
      throw new Error(`Jina API erro (HTTP ${res.status}): ${data.detail ?? data.error ?? JSON.stringify(data)}`)
    }

    return data.data[0].embedding
  }
}
