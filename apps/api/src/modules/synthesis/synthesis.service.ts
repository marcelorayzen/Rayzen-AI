import { Injectable, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { getWorkModeConfig } from '../orchestrator/work-modes'
import { DocumentationService } from '../documentation/documentation.service'
import { MetricsService } from '../metrics/metrics.service'
import { GraphService, confirmNextStepId } from '../graph/graph.service'
import { EventService } from '../event/event.service'
import { ProjectStateService } from '../project-state/project-state.service'

export interface SynthesisResult {
  summary: string
  decisions: string[]
  next_steps: string[]
  learnings: string[]
  confidence: 'low' | 'medium' | 'high'
}

/**
 * `conversation_messages` **não é conversa** — é log de chamada de LLM de todo módulo.
 * O checkpoint lia a tabela inteira e acabava se alimentando da própria saída.
 *
 * Medido em 2026-08-18 neste projeto: das 3.990 linhas, **nenhuma** é diálogo de
 * usuário. São `documentation` (1.558), `synthesis` (1.103), `project-state` (952),
 * `brain`, `system`, `jarvis`. O `runSynthesis()` grava o próprio resumo com
 * `module: 'synthesis'`, então o checkpoint seguinte o encontrava na janela e
 * parafraseava para frente.
 *
 * O efeito é uma câmara de eco: em ~20h, **12 checkpoints e 11 resumos praticamente
 * idênticos**, repetindo "Sete commits foram enviados à produção" muito depois de o
 * número ter mudado — e, pior, carregando adiante uma deriva que virou fato falso
 * ("iniciando o HUD orbital via WebSocket", quando o HUD foi explicitamente PARADO e
 * nunca começou).
 *
 * Estes três módulos são todos **derivados dos mesmos eventos** que o checkpoint já lê
 * direto. Incluí-los não acrescenta informação: duplica a entrada e ainda por cima
 * pela versão já resumida por um LLM, que é onde a deriva se acumula.
 *
 * Denylist e não allowlist de propósito: se algum dia um módulo gravar diálogo real
 * (chat, assistente), ele continua entrando sem precisar de mudança aqui.
 */
const MODULOS_DERIVADOS_DOS_MESMOS_EVENTOS = ['synthesis', 'documentation', 'project-state']

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name)
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    @Inject(forwardRef(() => DocumentationService)) private readonly docSvc: DocumentationService,
    private readonly metrics: MetricsService,
    private readonly graphService: GraphService,
    @Inject(forwardRef(() => EventService)) private readonly eventService: EventService,
    @Inject(forwardRef(() => ProjectStateService)) private readonly stateService: ProjectStateService,
  ) {
    this.llm = createLlmClient('synthesis', {
      apiKey:  this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
    })
  }

  async synthesizeSession(sessionId: string, projectId?: string, workMode?: string): Promise<SessionArtifactResponse> {
    const [messages, events] = await Promise.all([
      this.prisma.conversationMessage.findMany({
        // Mesmo eco do checkpoint, em escala menor: `runSynthesis` grava sob este
        // mesmo `sessionId`, então re-sintetizar a sessão leria a saída anterior.
        where: { sessionId, module: { notIn: MODULOS_DERIVADOS_DOS_MESMOS_EVENTOS } },
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
        where: {
          projectId,
          createdAt: { gte: since },
          module: { notIn: MODULOS_DERIVADOS_DOS_MESMOS_EVENTOS },
        },
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

    // Full pipeline: state refresh + docs regeneration in background.
    //
    // A síntese e os documentos têm ritmos naturais OPOSTOS: o artefato acima é "o que
    // aconteceu desde o último checkpoint" (janela curta, faz sentido a cada 10min); os
    // documentos são um rollup de 30 dias (janela longa). Regenerar o rollup a cada
    // disparo era o que fazia `rayzen:v1:documentation` ser o maior consumidor de LLM da
    // plataforma — ver docs/baseline-roteamento-llm.md.
    //
    // O piso de 1h mora no `generate()`. Aqui só se decide **quem tem direito de furá-lo**:
    // quem pediu foi uma pessoa, ou o gatilho foi uma DECISÃO — decisão precisa aparecer
    // no `decisions_log` na hora, não na próxima hora cheia. Burst de atividade e
    // "passaram 2h" não furam: eles só dizem que houve movimento, não que houve conteúdo.
    const pedidoHumano = !meta?.autoTriggered
    const ehDecisao    = meta?.reason === 'decision_detected'
    this.docSvc
      .generateAll(projectId, { force: true, ignorarFrescor: pedidoHumano || ehDecisao })
      .catch(() => null)

    // goal-2: sem isso, a meta só atualiza se alguém lembrar de chamar
    // POST /goal/propose-progress manualmente — nunca aplica direto (exige
    // confirmação humana via toggleCriteria), só cria um evento visível pra
    // não ficar mais de uma sessão sem ninguém notar.
    this.warnPendingGoalProposals(projectId).catch(() => null)

    return {
      id: artifact.id,
      sessionId: checkpointId,
      projectId,
      synthesis,
      createdAt: artifact.createdAt.toISOString(),
    }
  }

  private async warnPendingGoalProposals(projectId: string): Promise<void> {
    const { goalId, goalTitle, proposals } = await this.graphService.proposeGoalProgress(projectId)
    if (!goalId || proposals.length === 0) return

    const lines = proposals.map(p => `- [${p.confidence}] ${p.text} — ${p.reason}`)
    await this.eventService.create({
      projectId,
      source: 'brain',
      type: 'note',
      intent: 'idea',
      content: `Possíveis critérios concluídos no goal "${goalTitle}" (revisar e confirmar manualmente):\n${lines.join('\n')}`,
      metadata: { kind: 'goal_proposal_pending', goalId, proposals },
    })

    // O evento acima sozinho não sobrevive entre sessões: recent_events pega os
    // últimos N eventos sem filtro, e qualquer tool-call (Bash, Grep, etc.) gera
    // um — o aviso é engolido pelo ruído em minutos numa sessão ativa. nextSteps
    // é o que o hook injeta como "Próximos passos" em TODO prompt (já comprovado
    // nesta sessão), então é a única superfície com garantia real de visibilidade
    // cross-sessão. Só propostas de alta confiança entram aqui — pra não inflar
    // a lista com toda sugestão de baixa certeza a cada checkpoint.
    const highConfidence = proposals.filter(p => p.confidence === 'high')
    if (highConfidence.length === 0) return

    const state = await this.stateService.get(projectId)
    if (!state) return

    // O id do critério ('a1', 'b3'...) só é único DENTRO de uma meta — metas diferentes
    // reusam os mesmos. Sem o goalId no id do next-step, um resíduo de meta antiga faz
    // o dedup abaixo silenciar o critério homônimo da meta atual. Aconteceu: o projeto
    // tinha um "confirmar" do b3 de uma meta já achieved e o b3 da meta ativa ao mesmo
    // tempo — ver confirmNextStepId() em GraphService, que precisa gerar o mesmo id.
    const existingIds = new Set(state.nextSteps.map(s => s.id))
    const newSteps = highConfidence
      .filter(p => !existingIds.has(confirmNextStepId(goalId, p.criteriaId)))
      .map(p => ({
        id:    confirmNextStepId(goalId, p.criteriaId),
        title: `Confirmar critério concluído: ${p.text} (${p.reason})`,
      }))

    if (newSteps.length > 0) {
      await this.stateService.updatePlanning(projectId, { nextSteps: [...state.nextSteps, ...newSteps] })
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
