import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { BrainSearchResult } from '../brain/brain.service'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompileDraft {
  title: string
  slug: string
  tags: string[]
  contentMd: string
  relatedKeywords: string[]
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WikiCompilationService {
  private llm: OpenAI

  constructor(private readonly config: ConfigService) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  toSlug(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
  }

  async compile(rawContent: string, sources: BrainSearchResult[]): Promise<CompileDraft> {
    const sourceContext = sources.length > 0
      ? '\n\nFontes recuperadas:\n' + sources
          .map((s, i) => `[${i + 1}] ${s.sourcePath ?? 'manual'}: ${s.content.slice(0, 300)}`)
          .join('\n\n')
      : ''

    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Você é um compilador de conhecimento. Produza uma nota wiki canônica em JSON.

Campos obrigatórios:
- title: título curto e descritivo (máx 60 caracteres)
- slug: kebab-case do título, sem acentos, sem caracteres especiais
- tags: array de 2 a 5 strings em minúsculo
- content_md: nota em markdown com seções ## Resumo, ## Detalhes, ## Referências. Máx 400 palavras. Sem hype, linguagem técnica.
- related_keywords: array de 2 a 4 termos para buscar notas relacionadas

Responda APENAS com o JSON.`,
        },
        {
          role: 'user',
          content: rawContent.slice(0, 5000) + sourceContext,
        },
      ],
    })

    const parsed = JSON.parse(res.choices[0].message.content ?? '{}') as {
      title?: string
      slug?: string
      tags?: string[]
      content_md?: string
      related_keywords?: string[]
    }

    const title = parsed.title ?? 'Nota sem título'
    return {
      title,
      slug: parsed.slug ?? this.toSlug(title),
      tags: parsed.tags ?? [],
      contentMd: parsed.content_md ?? rawContent.slice(0, 400),
      relatedKeywords: parsed.related_keywords ?? [],
    }
  }
}
