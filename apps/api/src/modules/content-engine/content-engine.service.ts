import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'

export type ContentType = 'post' | 'thread' | 'article' | 'calendar' | 'diagram'
export type ContentTone = 'professional' | 'casual' | 'educational' | 'persuasive' | 'creative'

export interface ContentResult {
  type: ContentType
  content: string
  tokensUsed: number
}

export interface CalendarEntry {
  day: number
  theme: string
  format: ContentType
  hook: string
}

export interface CalendarResult {
  period: string
  entries: CalendarEntry[]
  tokensUsed: number
}

export interface DiagramResult {
  diagram: string
  type: string
  tokensUsed: number
}

const TYPE_PROMPTS: Record<ContentType, string> = {
  post: `Crie um post para LinkedIn ou Instagram.
Estrutura: gancho forte (1ª linha), desenvolvimento (3-5 parágrafos curtos), CTA no final.
Use quebras de linha estratégicas. Inclua emojis relevantes. Máximo 300 palavras.`,

  thread: `Crie uma thread para X (Twitter).
Formato: numerada de 1/ até no máximo 10 tweets.
Cada tweet máximo 280 caracteres. Gancho forte no 1/. Encerre com CTA ou reflexão.`,

  article: `Crie um artigo completo para blog ou LinkedIn Articles.
Estrutura: título SEO, introdução, 3-5 seções com subtítulos H2, conclusão com CTA.
Tom informativo e aprofundado. Entre 600-1000 palavras.`,

  calendar: `Crie um calendário editorial.`,
  diagram: `Gere um diagrama Mermaid.`,
}

@Injectable()
export class ContentEngineService {
  private llm: OpenAI

  constructor(private readonly prisma: PrismaService, private config: ConfigService) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
    })
  }

  private parseLlmJson<T>(content: string | null | undefined, fallback: T, context: string): T {
    if (!content) return fallback

    const normalized = content.trim()
    const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const candidate = (fenced?.[1] ?? normalized).trim()

    try {
      return JSON.parse(candidate) as T
    } catch {
      const start = candidate.search(/[\[{]/)
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1)) as T
      }
      throw new Error(`${context}: invalid JSON returned by model`)
    }
  }

  private stripCodeFence(content: string | null | undefined): string {
    if (!content) return ''
    const normalized = content.trim()
    const fenced = normalized.match(/^```(?:mermaid|text|plaintext)?\s*([\s\S]*?)\s*```$/i)
    return (fenced?.[1] ?? normalized).trim()
  }

  async generate(
    type: ContentType,
    topic: string,
    tone: ContentTone,
    sessionId: string,
    context?: string,
  ): Promise<ContentResult> {
    const toneMap: Record<ContentTone, string> = {
      professional: 'profissional e autoridade',
      casual: 'casual e próximo',
      educational: 'educativo e didático',
      persuasive: 'persuasivo e motivacional',
      creative: 'criativo e diferente',
    }

    const systemPrompt = `Você é Rayzen, especialista em criação de conteúdo para redes sociais e blogs.
${TYPE_PROMPTS[type]}
Tom: ${toneMap[tone]}.
Vá direto ao conteúdo — sem frases de abertura ou explicações. Português brasileiro.`

    const userPrompt = context
      ? `Tema: ${topic}\nContexto adicional: ${context}`
      : `Tema: ${topic}`

    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
    })

    const content = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'content', role: 'user', content: `${type}: ${topic}` },
        { sessionId, module: 'content', role: 'assistant', content, tokensUsed },
      ],
    })

    return { type, content, tokensUsed }
  }

  async generateCalendar(
    topic: string,
    days: number,
    sessionId: string,
  ): Promise<CalendarResult> {
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Você é Rayzen, especialista em calendário editorial.
Crie um calendário editorial para ${days} dias sobre o tema dado.
Responda APENAS em JSON válido neste formato:
{
  "entries": [
    { "day": 1, "theme": "...", "format": "post|thread|article", "hook": "..." }
  ]
}
Sem markdown, sem explicações. Apenas o JSON.`,
        },
        { role: 'user', content: `Tema geral: ${topic}. Crie ${days} entradas variadas.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    })

    const parsed = this.parseLlmJson<{ entries: CalendarEntry[] }>(
      res.choices[0].message.content,
      { entries: [] },
      'generateCalendar',
    )
    const tokensUsed = res.usage?.total_tokens ?? 0

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'content', role: 'user', content: `calendário: ${topic} (${days} dias)` },
        { sessionId, module: 'content', role: 'assistant', content: JSON.stringify(parsed), tokensUsed },
      ],
    })

    return {
      period: `${days} dias`,
      entries: parsed.entries as CalendarEntry[],
      tokensUsed,
    }
  }

  async generateDiagram(description: string, sessionId: string): Promise<DiagramResult> {
    const diagramType = this.inferDiagramType(description)

    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Você é um especialista em diagramas Mermaid.
Gere APENAS o código Mermaid válido, sem markdown fences (\`\`\`), sem explicações.
Tipos disponíveis: flowchart, sequenceDiagram, classDiagram, erDiagram, gantt, gitGraph, mindmap.
Use o tipo mais adequado para a descrição. Prefira flowchart LR para arquitetura e fluxos.`,
        },
        { role: 'user', content: description },
      ],
      temperature: 0.2,
    })

    const diagram = this.stripCodeFence(res.choices[0].message.content)
    const tokensUsed = res.usage?.total_tokens ?? 0

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'content', role: 'user', content: `diagrama: ${description}` },
        { sessionId, module: 'content', role: 'assistant', content: diagram, tokensUsed },
      ],
    })

    return { diagram, type: diagramType, tokensUsed }
  }

  private inferDiagramType(description: string): string {
    const lower = description.toLowerCase()
    if (lower.includes('sequência') || lower.includes('sequence') || lower.includes('fluxo de chamada')) return 'sequenceDiagram'
    if (lower.includes('classe') || lower.includes('class')) return 'classDiagram'
    if (lower.includes('er ') || lower.includes('entidade') || lower.includes('banco')) return 'erDiagram'
    if (lower.includes('gantt') || lower.includes('cronograma') || lower.includes('timeline')) return 'gantt'
    if (lower.includes('git') || lower.includes('branch')) return 'gitGraph'
    if (lower.includes('mente') || lower.includes('mind') || lower.includes('mapa mental')) return 'mindmap'
    return 'flowchart'
  }
}
