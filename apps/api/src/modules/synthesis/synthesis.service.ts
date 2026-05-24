import { Injectable, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { getWorkModeConfig } from '../orchestrator/work-modes'
import { DocumentationService } from '../documentation/documentation.service'
import { MetricsService } from '../metrics/metrics.service'

export interface SynthesisResult {
  summary: string
  decisions: string[]
  next_steps: string[]
  learnings: string[]
  confidence: 'low' | 'medium' | 'high'
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name)
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    @Inject(forwardRef(() => DocumentationService)) private readonly docSvc: DocumentationService,
    private readonly metrics: MetricsService,
  ) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  async synthesizeSession(sessionId: string, projectId?: string, workMode?: string): Promise<SessionArtifactResponse> {
    const [messages, events] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.event.findMany({
        where: { metadata: { path: ['sessionId'], equals: sessionId } },
        orderBy: { ts: 'asc' },
        select: { id: true, source: true, type: true, intent: true, content: true, metadata: true },
      }),
    ])

    if (messages.length === 0 && events.length === 0) {
      throw new BadRequestException('Sessão sem conteúdo para sintetizar')
    }

    const synthesis = await this.runSynthesis({ messages, events, label: 'sessão', workMode, logContext: { sessionId, projectId } })
    const sourceIds = events.map(e => e.id)

    const artifact = await this.prisma.sessionArtifact.create({
      data: {
        sessionId,
        projectId: projectId ?? null,
        type: 'synthesis',
        workMode: workMode ?? null,
        content: synthesis as object,
        sourceIds: sourceIds as object,
      },
    })

    return { id: artifact.id, sessionId, projectId, synthesis, createdAt: artifact.createdAt.toISOString() }
  }

  async checkpoint(
    projectId: string,
    note?: string,
    workMode?: string,
    meta?: { autoTriggered?: boolean; reason?: string },
  ): Promise<SessionArtifactResponse> {
    // Buscar eventos das últimas 2h ou desde o último checkpoint
    const lastCheckpoint = await this.prisma.sessionArtifact.findFirst({
      where: { projectId, type: 'checkpoint' },
      orderBy: { createdAt: 'desc' },
    })

    const since = lastCheckpoint
      ? lastCheckpoint.createdAt
      : new Date(Date.now() - 2 * 60 * 60 * 1000)

    const [events, messages] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          projectId,
          ts: { gte: since },
          memoryClass: { not: 'archive' },
        },
        orderBy: { ts: 'desc' },
        take: 60,
        select: { id: true, source: true, type: true, intent: true, content: true, metadata: true },
      }).then(evs => evs.reverse()),
      this.prisma.conversationMessage.findMany({
        where: { projectId, createdAt: { gte: since } },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
    ])

    if (events.length === 0 && messages.length === 0) {
      throw new BadRequestException('Nenhuma atividade desde o último checkpoint')
    }

    const checkpointId = `checkpoint-${Date.now()}`
    const synthesis = await this.runSynthesis({ messages, events, label: 'checkpoint', note, workMode, logContext: { sessionId: checkpointId, projectId } })
    const sourceIds = events.map(e => e.id)
    const artifact = await this.prisma.sessionArtifact.create({
      data: {
        sessionId: checkpointId,
        projectId,
        type: 'checkpoint',
        workMode: workMode ?? null,
        content: { ...synthesis, ...(meta ?? {}) } as object,
        sourceIds: sourceIds as object,
      },
    })

    // Full pipeline: state refresh + docs regeneration in background
    this.docSvc.generateAll(projectId, { force: true }).catch(() => null)

    return {
      id: artifact.id,
      sessionId: checkpointId,
      projectId,
      synthesis,
      createdAt: artifact.createdAt.toISOString(),
    }
  }

  private buildGitSummary(events: Array<{ metadata: unknown }>): string {
    const commits: string[] = []
    const files = new Set<string>()
    const branches = new Set<string>()

    for (const ev of events) {
      const m = ev.metadata as Record<string, unknown> | null
      if (!m) continue
      const git = m['git'] as Record<string, unknown> | null
      if (!git) continue

      const branch = String(git['branch'] ?? '')
      if (branch) branches.add(branch)

      const hash = String(git['commitHash'] ?? '')
      const msg = String(git['commitMessage'] ?? '')
      if (hash && msg && !commits.find(c => c.includes(hash))) {
        commits.push(`${hash} ${msg.slice(0, 80)}`)
      }

      const changed = (git['changedFiles'] as string[]) ?? []
      changed.forEach(f => files.add(f))
    }

    if (branches.size === 0 && commits.length === 0) return ''

    const lines = [
      branches.size > 0 && `Branch(es): ${[...branches].join(', ')}`,
      commits.length > 0 && `Commits: ${commits.slice(0, 5).join(' | ')}`,
      files.size > 0 && `Arquivos tocados: ${[...files].slice(0, 10).join(', ')}`,
    ].filter(Boolean)

    return `## Contexto Git\n${lines.join('\n')}`
  }

  private async runSynthesis(opts: {
    messages: Array<{ role: string; content: string }>
    events: Array<{ source: string; type: string; intent?: string | null; content: string; metadata: unknown }>
    label: string
    note?: string
    workMode?: string
    logContext?: { sessionId: string; projectId?: string }
  }): Promise<SynthesisResult> {
    const chatLines = opts.messages
      .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.slice(0, 300)}`)
      .join('\n')

    const cliLines = opts.events
      .filter(e => e.source === 'cli')
      .map(e => `[${e.intent ?? e.type}] ${e.content.slice(0, 200)}`)
      .join('\n')

    const manualLines = opts.events
      .filter(e => e.source === 'manual' || e.intent)
      .map(e => `[${e.intent ?? e.type}] ${e.content.slice(0, 300)}`)
      .join('\n')

    const gitSummary = this.buildGitSummary(opts.events)

    const context = [
      opts.note && `## Nota do usuário\n${opts.note}`,
      chatLines && `## Conversa\n${chatLines}`,
      cliLines && `## Ações no terminal\n${cliLines}`,
      manualLines && `## Registros manuais\n${manualLines}`,
      gitSummary,
    ].filter(Boolean).join('\n\n')

    const totalItems = opts.messages.length + opts.events.length

    const modeConfig = getWorkModeConfig(opts.workMode)
    const synthesisFocusLine = modeConfig
      ? `\nFoco desta síntese (modo ${modeConfig.label}): ${modeConfig.synthesisFocus}`
      : ''

    const prompt = `Analise esta ${opts.label} de trabalho e extraia em JSON:${synthesisFocusLine}

${context}

Retorne APENAS JSON válido neste formato:
{
  "summary": "resumo em 2-3 frases do que foi feito",
  "decisions": ["decisão 1", "decisão 2"],
  "next_steps": ["próximo passo 1", "próximo passo 2"],
  "learnings": ["aprendizado 1"],
  "confidence": "low|medium|high"
}

Regras:
- decisions: o que foi decidido ou definido (não óbvio, não trivial)
- next_steps: o que ficou pendente ou foi identificado para fazer
- learnings: insights, problemas resolvidos, padrões descobertos
- confidence: "high" se há >10 itens de contexto e decisões claras, "medium" se contexto parcial, "low" se poucos dados
- Se não houver itens numa categoria, retorne array vazio`

    const llmStart = Date.now()
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })

    const rawContent = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0
    this.metrics.llmTokensTotal.inc({ module: 'synthesis', model: 'gpt-4o' }, tokensUsed)
    this.metrics.llmRequestDuration.observe({ module: 'synthesis', model: 'gpt-4o' }, (Date.now() - llmStart) / 1000)
    this.logger.log(`Síntese LLM raw (${rawContent.length} chars): ${rawContent.slice(0, 300)}`)

    if (opts.logContext) {
      this.prisma.conversationMessage.create({
        data: {
          sessionId: opts.logContext.sessionId,
          module: 'synthesis',
          projectId: opts.logContext.projectId ?? null,
          role: 'assistant',
          content: rawContent.slice(0, 1000),
          tokensUsed,
        },
      }).catch(() => null)
    }

    try {
      const parsed = this.extractJson(rawContent) as SynthesisResult
      if (!parsed.summary) throw new Error('JSON sem campo summary')
      if (!parsed.confidence) {
        parsed.confidence = totalItems > 10 ? 'high' : totalItems > 4 ? 'medium' : 'low'
      }
      return parsed
    } catch (err) {
      this.logger.error(`Síntese parse falhou. Raw: "${rawContent.slice(0, 400)}"`, err)
      return {
        summary: 'Síntese não disponível',
        decisions: [],
        next_steps: [],
        learnings: [],
        confidence: 'low',
      }
    }
  }

  private extractJson(raw: string): unknown {
    // 1. tenta parse direto
    try { return JSON.parse(raw) } catch { /* continua */ }

    // 2. strip de code fences markdown (```json ... ```)
    const fenceStripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
    try { return JSON.parse(fenceStripped) } catch { /* continua */ }

    // 3. extrai primeiro bloco {...} da resposta (Claude às vezes adiciona texto antes/depois)
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])

    throw new Error('Nenhum JSON encontrado na resposta')
  }

  async getArtifacts(projectId?: string, sessionId?: string) {
    return this.prisma.sessionArtifact.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
  }
}

export interface SessionArtifactResponse {
  id: string
  sessionId: string
  projectId?: string
  synthesis: SynthesisResult
  createdAt: string
}
