import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { garantirProjeto } from '../../common/garantir-projeto'
import { ProjectStateService, ProjectStateData } from '../project-state/project-state.service'
import { HealthScoreService } from '../health/health.service'
import { EventService } from '../event/event.service'
import OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { randomUUID } from 'crypto'
import { MetricsService } from '../metrics/metrics.service'

export interface SuccessCriteria {
  id: string
  text: string
  done: boolean
}

/**
 * Id do next-step "Confirmar critério concluído: ...".
 *
 * Precisa do goalId: o id do critério ('a1', 'b3'...) só é único dentro de uma meta, e
 * metas diferentes reusam os mesmos. Sem isso, um resíduo de meta antiga fazia o dedup
 * de warnPendingGoalProposals silenciar o critério homônimo da meta ativa — o projeto
 * chegou a ter dois "confirmar b3" de metas distintas ao mesmo tempo.
 */
export function confirmNextStepId(goalId: string, criteriaId: string): string {
  return `confirmar-${goalId}-${criteriaId}`
}

export interface Kpi {
  metric: string
  target: string
  current?: string
  unit?: string
}

export interface GapItem {
  area: 'blocker' | 'milestone' | 'kpi' | 'risk' | 'focus'
  description: string
  severity: 'high' | 'medium' | 'low'
  relatedCriteria?: string
}

export interface GapAnalysis {
  gaps: GapItem[]
  nextBestAction: string
  goalProgress: number
  confidence: 'low' | 'medium' | 'high'
}

export interface GoalGraphResponse {
  goal: Record<string, unknown> | null
  state: ProjectStateData | null
  mermaid: string
  gapAnalysis: GapAnalysis | null
  healthScore: number
  updatedAt: string
  /** Quando a gap analysis foi calculada. `null` quando acabou de ser calculada nesta chamada. */
  gapAnalysisAt?: string | null
}

/** O que fica gravado em `project_goals.last_gap_analysis`: a análise mais a data dela. */
type GapAnalysisPersistida = GapAnalysis & { analyzedAt?: string }

/**
 * Idade a partir da qual a gap analysis é recalculada — em background, nunca bloqueando.
 * Não é cache de performance: é o intervalo em que vale gastar uma chamada de LLM de ~60s.
 */
const GAP_ANALYSIS_TTL_MS = 10 * 60 * 1000

export interface EventNode {
  id: string
  content: string
  intent: string | null
  type: string
  source: string
  ts: string
  milestoneId: string | null
}

export interface EventGraphData {
  milestones: Array<{ id: string; title: string; status: string }>
  events: EventNode[]
}

export interface CreateGoalDto {
  title: string
  description?: string
  successCriteria?: SuccessCriteria[]
  kpis?: Kpi[]
  targetDate?: string
  parentGoalId?: string
}

export interface UpdateGoalDto {
  title?: string
  description?: string | null
  successCriteria?: SuccessCriteria[]
  kpis?: Kpi[]
  targetDate?: string | null
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name)
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateService: ProjectStateService,
    private readonly healthService: HealthScoreService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly events: EventService,
  ) {
    this.llm = createLlmClient('graph', {
      apiKey:  this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL') ?? 'http://localhost:4100/v1',
    })
  }

  async getStateGraph(projectId: string) {
    const [mermaid, state] = await Promise.all([
      this.generateStateMermaid(projectId),
      this.stateService.get(projectId),
    ])
    return { mermaid, state }
  }

  async generateStateMermaid(projectId: string): Promise<string> {
    const state = await this.stateService.get(projectId)
    if (!state) return 'flowchart TD\n  N["Nenhum estado disponível — execute /state/refresh"]'

    const lines: string[] = ['flowchart TD']
    const sanitize = (s: unknown) => String(s ?? '').replace(/["\[\]\u{1F300}-\u{1FFFF}]/gu, '').replace(/[^\x20-\x7EÀ-ɏ]/g, '').slice(0, 55)

    // Milestones
    const milestones = (state.milestones ?? []) as Array<{ id: string; title: string; status: string }>
    milestones.forEach((m, i) => {
      const tag = m.status === 'done' ? '[done]' : m.status === 'active' ? '[ativo]' : '[pendente]'
      lines.push(`  M${i}["${tag} ${sanitize(m.title)}"]`)
      if (m.status === 'done') lines.push(`  style M${i} fill:#22c55e,color:#fff`)
      else if (m.status === 'active') lines.push(`  style M${i} fill:#3b82f6,color:#fff`)
    })

    // Blockers → connect to active milestones
    const blockers = (state.blockers ?? []).map(b => b.title)
    blockers.slice(0, 4).forEach((b, i) => {
      lines.push(`  B${i}["[blocker] ${sanitize(b)}"]`)
      lines.push(`  style B${i} fill:#ef4444,color:#fff`)
      const activeIdx = milestones.findIndex(m => m.status === 'active')
      if (activeIdx >= 0) lines.push(`  B${i} -->|bloqueia| M${activeIdx}`)
    })

    // Next steps
    const nextSteps = (state.nextSteps ?? []).map(s => s.title)
    nextSteps.slice(0, 3).forEach((s, i) => {
      lines.push(`  NS${i}["[prox] ${sanitize(s)}"]`)
      lines.push(`  style NS${i} fill:#8b5cf6,color:#fff`)
    })

    // Connect active milestone → next steps
    const activeIdx = milestones.findIndex(m => m.status === 'active')
    if (activeIdx >= 0 && nextSteps.length > 0) {
      lines.push(`  M${activeIdx} --> NS0`)
    }

    // Mermaid requires at least one node — add fallback if all arrays empty
    if (milestones.length === 0 && blockers.length === 0 && nextSteps.length === 0) {
      lines.push(`  N["Estado vazio - clique em gerar estado"]`)
    }

    return lines.join('\n')
  }

  async getGoalGraph(projectId: string): Promise<GoalGraphResponse> {
    const [goal, state, latestHealth] = await Promise.all([
      this.prisma.projectGoal.findFirst({
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
      this.stateService.get(projectId),
      this.healthService.getCurrent(projectId),
    ])

    const healthScore = latestHealth?.score ?? 0

    if (!goal) {
      const mermaid = await this.generateStateMermaid(projectId)
      return { goal: null, state, mermaid, gapAnalysis: null, healthScore, updatedAt: new Date().toISOString() }
    }

    // `analyzeGap` é uma chamada de LLM de ~60s, e era feita em TODA requisição: o painel
    // ficava em "Carregando…" por mais de um minuto. Os 10ms da segunda chamada vinham do
    // cache do LiteLLM (ttl 300s), cuja chave embute o ProjectState — ou seja, ele errava
    // justamente quando alguém estava trabalhando. A análise já era gravada em
    // `lastGapAnalysis` e nunca lida: agora serve-se o valor gravado e recalcula-se fora do
    // caminho da resposta.
    const gravada = goal.lastGapAnalysis as GapAnalysisPersistida | null

    if (gravada) {
      void this.recalcularGapSeVelha(goal.id, projectId, gravada.analyzedAt)
      return {
        goal: goal as unknown as Record<string, unknown>,
        state,
        mermaid: this.buildGoalMermaid(goal, gravada),
        gapAnalysis: gravada,
        healthScore,
        updatedAt: new Date().toISOString(),
        gapAnalysisAt: gravada.analyzedAt ?? null,
      }
    }

    // Primeira vez para esta meta: não há o que servir, então paga-se o custo uma vez.
    const gapAnalysis = state ? await this.calcularEGravarGap(goal, projectId) : null

    return {
      goal: goal as unknown as Record<string, unknown>,
      state,
      mermaid: this.buildGoalMermaid(goal, gapAnalysis),
      gapAnalysis,
      healthScore,
      updatedAt: new Date().toISOString(),
      gapAnalysisAt: gapAnalysis ? new Date().toISOString() : null,
    }
  }

  /** Metas com recálculo em voo — evita N chamadas de LLM para N requisições simultâneas. */
  private readonly gapEmVoo = new Set<string>()

  private async recalcularGapSeVelha(goalId: string, projectId: string, analyzedAt?: string): Promise<void> {
    // Sem data é análise gravada antes deste campo existir: vale recalcular uma vez.
    const idadeMs = analyzedAt ? Date.now() - new Date(analyzedAt).getTime() : Infinity
    if (idadeMs < GAP_ANALYSIS_TTL_MS) return
    if (this.gapEmVoo.has(goalId)) return

    this.gapEmVoo.add(goalId)
    try {
      const [goal, state] = await Promise.all([
        this.prisma.projectGoal.findUnique({ where: { id: goalId } }),
        this.stateService.get(projectId),
      ])
      if (goal && state) await this.calcularEGravarGap(goal, projectId)
    } catch (err) {
      // Falhar aqui não pode derrubar nada: a resposta já foi enviada com o valor gravado.
      this.logger.warn(`Recálculo da gap analysis falhou (goal ${goalId}): ${String(err)}`)
    } finally {
      this.gapEmVoo.delete(goalId)
    }
  }

  private async calcularEGravarGap(
    goal: { id: string; title: string; successCriteria: unknown; kpis: unknown; targetDate: Date | null },
    projectId: string,
  ): Promise<GapAnalysis | null> {
    const state = await this.stateService.get(projectId)
    if (!state) return null

    const recentEvents = await this.prisma.event.findMany({
      where: { projectId, intent: { in: ['decision', 'problem', 'idea'] } },
      orderBy: { ts: 'desc' },
      take: 10,
      select: { content: true, intent: true, ts: true },
    })

    const gapAnalysis = await this.analyzeGap(goal, state, recentEvents)
    if (!gapAnalysis) return null

    // A data vive DENTRO do JSON de propósito: `updatedAt` da meta é `@updatedAt` e já
    // responde por toda escrita, então usá-lo como idade da análise repetiria o erro que
    // motivou o `contentChangedAt` do ProjectState — um campo com dois trabalhos.
    const persistida: GapAnalysisPersistida = { ...gapAnalysis, analyzedAt: new Date().toISOString() }
    await this.prisma.projectGoal
      .update({ where: { id: goal.id }, data: { lastGapAnalysis: persistida as object } })
      .catch(() => null)

    return gapAnalysis
  }

  async upsertGoal(projectId: string, dto: CreateGoalDto) {
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } })

    // Pause previous active goals
    await this.prisma.projectGoal.updateMany({
      where: { projectId, status: 'active' },
      data: { status: 'paused' },
    })

    const criteria: SuccessCriteria[] = (dto.successCriteria ?? []).map((c, i) => ({
      id: c.id ?? `c-${i}-${Date.now()}`,
      text: c.text,
      done: c.done ?? false,
    }))

    return this.prisma.projectGoal.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        successCriteria: criteria as unknown as Parameters<typeof this.prisma.projectGoal.create>[0]['data']['successCriteria'],
        kpis: (dto.kpis ?? []) as unknown as Parameters<typeof this.prisma.projectGoal.create>[0]['data']['kpis'],
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        parentGoalId: dto.parentGoalId ?? null,
        status: 'active',
      },
    })
  }

  async updateCriteria(goalId: string, criteria: SuccessCriteria[]) {
    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { successCriteria: criteria as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['successCriteria'] },
    })
  }

  async updateGoal(projectId: string, goalId: string, dto: UpdateGoalDto) {
    await this.prisma.projectGoal.findFirstOrThrow({ where: { id: goalId, projectId } })

    const criteria = dto.successCriteria?.map((c, i) => ({
      id: c.id || `c-${i}-${Date.now()}`,
      text: c.text,
      done: c.done ?? false,
    })).filter(c => c.text.trim())

    const kpis = dto.kpis
      ?.map(k => ({
        metric: k.metric?.trim(),
        target: k.target?.trim(),
        ...(k.current !== undefined ? { current: k.current } : {}),
        ...(k.unit?.trim() ? { unit: k.unit.trim() } : {}),
      }))
      .filter(k => k.metric && k.target)

    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.successCriteria !== undefined ? { successCriteria: criteria as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['successCriteria'] } : {}),
        ...(dto.kpis !== undefined ? { kpis: kpis as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['kpis'] } : {}),
        ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate ? new Date(dto.targetDate) : null } : {}),
      },
    })
  }

  async deleteGoal(projectId: string, goalId: string) {
    await this.prisma.projectGoal.updateMany({
      where: { projectId, parentGoalId: goalId },
      data: { parentGoalId: null },
    })
    const deleted = await this.prisma.projectGoal.deleteMany({ where: { id: goalId, projectId } })
    if (deleted.count === 0) throw new NotFoundException('Meta não encontrada')
    return { deleted: true }
  }

  async replaceKpis(goalId: string, kpis: Kpi[]) {
    const clean = kpis
      .map(k => ({
        metric: k.metric?.trim(),
        target: k.target?.trim(),
        ...(k.current !== undefined ? { current: k.current } : {}),
        ...(k.unit?.trim() ? { unit: k.unit.trim() } : {}),
      }))
      .filter(k => k.metric && k.target)

    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { kpis: clean as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['kpis'] },
    })
  }

  async toggleCriteria(goalId: string, criteriaId: string, done: boolean) {
    const goal = await this.prisma.projectGoal.findUniqueOrThrow({ where: { id: goalId } })
    const criteria = (goal.successCriteria as unknown as SuccessCriteria[]).map(c =>
      c.id === criteriaId ? { ...c, done } : c,
    )
    const target = (goal.successCriteria as unknown as SuccessCriteria[]).find(c => c.id === criteriaId)
    const updated = await this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { successCriteria: criteria as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['successCriteria'] },
    })

    // ProjectStateService.refresh() é incremental por design (ver memória
    // project_state_synthesis_incremental) — só remove um next-step se um evento
    // NOVO mostrar que foi resolvido; marcar o critério aqui não cria evento
    // nenhum, então o refresh nunca tinha sinal pra agir (achado real: qa-1 done
    // não tirava "implementar pipeline" do nextSteps mesmo após refresh). Cria o
    // evento de decisão explícito que o próprio prompt do refresh já sabe ler.
    if (target) {
      await this.events.create({
        projectId: goal.projectId,
        source:    'manual',
        type:      'note',
        intent:    'decision',
        content:   done
          ? `Critério de sucesso concluído: ${target.text}`
          : `Critério de sucesso revertido para pendente: ${target.text}`,
      }).catch((e) => this.logger.warn(`Falha ao registrar evento de toggleCriteria: ${e}`))
    }

    // Fire-and-forget — refresh() chama LLM, não deve travar o PATCH do checkbox.
    void this.stateService.refresh(goal.projectId).catch((e) =>
      this.logger.warn(`Falha ao sincronizar ProjectState após toggleCriteria: ${e}`),
    )

    // Mesmo motivo do evento de decisão acima, mas pro lado contrário: confirmar
    // um critério não tira sozinho o "Confirmar critério concluído: ..." que
    // warnPendingGoalProposals (SynthesisService) colocou em nextSteps — e
    // refresh() não dá garantia de remover (não-determinístico). Remove direto.
    if (done) {
      void this.removeConfirmNextStep(goal.projectId, goalId, criteriaId, target?.text).catch((e) =>
        this.logger.warn(`Falha ao limpar next-step de confirmação após toggleCriteria: ${e}`),
      )
    }

    return updated
  }

  /**
   * Casa também pelo TÍTULO, não só pelo id.
   *
   * O id `confirmar-<criteriaId>` já foi perdido em produção: a síntese devolvia o
   * passo sem id e o ProjectState recunhava como `next-<i>-<slug>`, deixando um órfão
   * que nenhuma confirmação conseguia apagar (dois "Confirmar critério concluído:
   * traces no Langfuse" no estado ao mesmo tempo). A origem está corrigida em
   * ProjectStateService.titleKey(), mas casar por título também limpa o que já
   * escapou e sobrevive a qualquer recunhagem futura.
   */
  private async removeConfirmNextStep(projectId: string, goalId: string, criteriaId: string, criteriaText?: string): Promise<void> {
    const state = await this.stateService.get(projectId)
    if (!state) return

    // `confirmar-<criteriaId>` sem goalId é o formato antigo — ainda em estados gravados
    // antes da correção, então continua sendo casado.
    const stepId    = confirmNextStepId(goalId, criteriaId)
    const legacyId  = `confirmar-${criteriaId}`
    const textKey   = criteriaText?.trim().toLowerCase()
    const matches = (s: { id: string; title: string }): boolean =>
      s.id === stepId || s.id === legacyId ||
      (Boolean(textKey) && s.title.toLowerCase().startsWith('confirmar critério concluído:') && s.title.toLowerCase().includes(textKey!))

    const remaining = state.nextSteps.filter(s => !matches(s))
    if (remaining.length === state.nextSteps.length) return
    await this.stateService.updatePlanning(projectId, { nextSteps: remaining })
  }

  async listGoals(projectId: string) {
    const metas = await this.prisma.projectGoal.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    })
    // Lista vazia é resposta legítima (projeto sem meta nenhuma) e id inexistente não é.
    // Só paga a query quando não há o que devolver — ver `garantirProjeto`.
    if (metas.length === 0) await garantirProjeto(this.prisma, projectId)
    return metas
  }

  async getEventGraph(projectId: string): Promise<EventGraphData> {
    const [state, rawEvents] = await Promise.all([
      this.stateService.get(projectId),
      this.prisma.event.findMany({
        where: {
          projectId,
          NOT: [
            { content: { startsWith: 'Sessão encerrada' } },
            { content: { startsWith: 'Sessão iniciada' } },
            { content: { startsWith: 'Session ended' } },
          ],
        },
        orderBy: { ts: 'asc' },
        take: 100,
        select: { id: true, content: true, intent: true, type: true, source: true, ts: true },
      }),
    ])

    const milestones = ((state?.milestones ?? []) as Array<{ id: string; title: string; status: string }>)

    const events: EventNode[] = rawEvents.map(e => ({
      id: e.id,
      content: e.content,
      intent: e.intent,
      type: e.type,
      source: e.source,
      ts: e.ts.toISOString(),
      milestoneId: null,
    }))

    if (milestones.length > 0 && events.length > 0) {
      const mappings = await this.mapEventsToMilestones(milestones, events)
      for (const m of mappings) {
        const ev = events.find(e => e.id === m.eventId)
        if (ev && m.milestoneId !== 'none') ev.milestoneId = m.milestoneId
      }
    }

    return { milestones, events }
  }

  async setGoalStatus(goalId: string, status: 'active' | 'achieved' | 'paused' | 'cancelled') {
    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { status },
    })
  }

  async renameGoal(goalId: string, title: string, description?: string) {
    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { title, ...(description !== undefined ? { description } : {}) },
    })
  }

  async autoTrackKpis(projectId: string, goalId: string): Promise<Record<string, string>> {
    const [goal, events] = await Promise.all([
      this.prisma.projectGoal.findUniqueOrThrow({ where: { id: goalId } }),
      this.prisma.event.findMany({
        where: { projectId },
        orderBy: { ts: 'desc' },
        take: 30,
        select: { content: true, intent: true, ts: true },
      }),
    ])

    const kpis = goal.kpis as unknown as Kpi[]
    if (kpis.length === 0) return {}

    const eventsSummary = events
      .map(e => `[${new Date(e.ts).toLocaleDateString('pt-BR')}] ${e.content.slice(0, 150)}`)
      .join('\n')

    const prompt = `Você é um assistente de análise de projetos. Com base nos eventos recentes, estime os valores atuais dos KPIs abaixo.

KPIs da meta:
${kpis.map(k => `- ${k.metric}: meta=${k.target} ${k.unit ?? ''} | atual=${k.current ?? 'desconhecido'}`).join('\n')}

Eventos recentes do projeto:
${eventsSummary || 'Nenhum evento disponível'}

Retorne EXATAMENTE este JSON (sem markdown):
{
  "kpis": [
    { "metric": "nome exato do KPI", "current": "valor estimado como string", "reasoning": "1 frase explicando de onde veio o valor" }
  ]
}

Regras:
- Inclua apenas KPIs para os quais você encontrou evidência nos eventos
- Use o mesmo nome exato do KPI
- Se não há evidência suficiente para um KPI, omita-o da lista
- O valor deve ser uma string numérica ou texto (ex: "47", "sim", "3/10")`

    try {
      const llmStart = Date.now()
      const res = await this.llm.chat.completions.create({
        model: 'gpt-local',
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      const kpiTokens = res.usage?.total_tokens ?? 0
      this.metrics.llmTokensTotal.inc({ module: 'graph', model: 'gpt-local' }, kpiTokens)
      this.metrics.llmRequestDuration.observe({ module: 'graph', model: 'gpt-local' }, (Date.now() - llmStart) / 1000)
      this.prisma.conversationMessage.create({
        data: {
          sessionId: `graph-${randomUUID().slice(0, 8)}`,
          module: 'graph',
          projectId,
          role: 'assistant',
          content: raw.slice(0, 500),
          tokensUsed: kpiTokens,
        },
      }).catch(() => null)
      const parsed = this.extractJson(raw) as { kpis: Array<{ metric: string; current: string }> }

      if (!parsed?.kpis?.length) return {}

      // Aplica as atualizações no banco
      let updatedKpis = [...kpis]
      const suggestions: Record<string, string> = {}
      for (const suggestion of parsed.kpis) {
        updatedKpis = updatedKpis.map(k =>
          k.metric === suggestion.metric ? { ...k, current: suggestion.current } : k,
        )
        suggestions[suggestion.metric] = suggestion.current
      }

      await this.prisma.projectGoal.update({
        where: { id: goalId },
        data: { kpis: updatedKpis as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['kpis'] },
      })

      return suggestions
    } catch (err) {
      this.logger.warn(`KPI auto-track falhou: ${err}`)
      return {}
    }
  }

  async updateKpi(goalId: string, metric: string, current: string) {
    const goal = await this.prisma.projectGoal.findUniqueOrThrow({ where: { id: goalId } })
    const kpis = (goal.kpis as unknown as Kpi[]).map(k =>
      k.metric === metric ? { ...k, current } : k,
    )
    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { kpis: kpis as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['kpis'] },
    })
  }

  private async mapEventsToMilestones(
    milestones: Array<{ id: string; title: string }>,
    events: EventNode[],
  ): Promise<Array<{ eventId: string; milestoneId: string }>> {
    const prompt = `Mapeie cada evento ao milestone mais relacionado, ou "none" se não houver relação clara.

Milestones:
${milestones.map(m => `- id="${m.id}": ${m.title}`).join('\n')}

Eventos:
${events.map(e => `- id="${e.id}": [${e.source}/${e.intent ?? e.type}] ${e.content.slice(0, 150)}`).join('\n')}

Retorne EXATAMENTE este JSON (sem markdown):
{
  "mappings": [
    { "eventId": "id-do-evento", "milestoneId": "id-do-milestone-ou-none" }
  ]
}

Inclua todos os eventos. Use os ids exatos. milestoneId="none" quando sem relação clara.`

    try {
      const llmStart = Date.now()
      const res = await this.llm.chat.completions.create({
        model: 'gpt-local',
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      const mapTokens = res.usage?.total_tokens ?? 0
      this.metrics.llmTokensTotal.inc({ module: 'graph', model: 'gpt-local' }, mapTokens)
      this.metrics.llmRequestDuration.observe({ module: 'graph', model: 'gpt-local' }, (Date.now() - llmStart) / 1000)
      this.prisma.conversationMessage.create({
        data: {
          sessionId: `graph-${randomUUID().slice(0, 8)}`,
          module: 'graph',
          role: 'assistant',
          content: raw.slice(0, 500),
          tokensUsed: mapTokens,
        },
      }).catch(() => null)
      const parsed = this.extractJson(raw) as { mappings: Array<{ eventId: string; milestoneId: string }> }
      return parsed?.mappings ?? []
    } catch (err) {
      this.logger.warn(`Event mapping LLM failed: ${err}`)
      return []
    }
  }

  private buildGoalMermaid(
    goal: { title: string; successCriteria: unknown; targetDate: Date | null },
    gap: GapAnalysis | null,
  ): string {
    // successCriteria vem de JSON armazenado (criado manualmente ou via import) — nem
    // sempre tem todos os campos esperados (achado real: goal de cliente com criteria
    // só {id, done}, sem "text", crashava aqui). sanitize() aceita unknown e nunca lança.
    const sanitize = (s: unknown) => String(s ?? '').replace(/["\[\]\u{1F300}-\u{1FFFF}]/gu, '').replace(/[^\x20-\x7EÀ-ɏ]/g, '').slice(0, 55)
    const criteria = (goal.successCriteria as SuccessCriteria[]) ?? []
    const lines: string[] = ['flowchart LR']

    const deadline = goal.targetDate
      ? ` - ${new Date(goal.targetDate).toLocaleDateString('pt-BR')}`
      : ''
    lines.push(`  G["[meta] ${sanitize(goal.title)}${deadline}"]`)

    criteria.slice(0, 5).forEach((c, i) => {
      const tag = c.done ? '[ok]' : '[ ]'
      lines.push(`  C${i}["${tag} ${sanitize(c.text)}"]`)
      lines.push(`  G --> C${i}`)
      if (c.done) lines.push(`  style C${i} fill:#22c55e,color:#fff`)
    })

    if (gap) {
      const high = gap.gaps.filter(g => g.severity === 'high').slice(0, 2)
      high.forEach((g, i) => {
        lines.push(`  GAP${i}["[gap] ${sanitize(g.description)}"]`)
        lines.push(`  style GAP${i} fill:#ef4444,color:#fff`)
        const undoneIdx = criteria.findIndex(c => !c.done)
        if (undoneIdx >= 0) lines.push(`  C${undoneIdx} --> GAP${i}`)
        else lines.push(`  G --> GAP${i}`)
      })

      if (gap.nextBestAction) {
        lines.push(`  NBA["[acao] ${sanitize(gap.nextBestAction)}"]`)
        lines.push(`  style NBA fill:#3b82f6,color:#fff`)
        if (high.length > 0) lines.push(`  GAP0 --> NBA`)
        else lines.push(`  G --> NBA`)
      }
    }

    return lines.join('\n')
  }

  private async analyzeGap(
    goal: { title: string; successCriteria: unknown; kpis: unknown; targetDate: Date | null },
    state: ProjectStateData,
    events: Array<{ content: string; intent: string | null; ts: Date }>,
  ): Promise<GapAnalysis> {
    const criteria = goal.successCriteria as SuccessCriteria[]
    const doneCriteria = criteria.filter(c => c.done).length
    const milestones = (state.milestones ?? []) as Array<{ status: string }>
    const doneMilestones = milestones.filter(m => m.status === 'done').length
    const totalItems = criteria.length + milestones.length
    const localProgress = totalItems > 0
      ? Math.round(((doneCriteria + doneMilestones) / totalItems) * 100)
      : 0

    const eventsSummary = events
      .slice(0, 10)
      .map(e => `[${e.intent ?? 'note'}] ${e.content.slice(0, 120)}`)
      .join('\n')

    const prompt = `Você é um assistente de gestão de projetos. Compare o goal com o estado atual e retorne JSON.

GOAL:
Título: ${goal.title}
Critérios de sucesso: ${JSON.stringify(criteria)}
KPIs: ${JSON.stringify(goal.kpis)}
Prazo: ${goal.targetDate ? new Date(goal.targetDate).toLocaleDateString('pt-BR') : 'não definido'}

ESTADO ATUAL:
Objetivo atual: ${state.objective}
Stage: ${state.stage}
Milestones: ${JSON.stringify(state.milestones)}
Blockers: ${JSON.stringify(state.blockers)}
Riscos: ${JSON.stringify(state.risks)}
Próximos passos: ${JSON.stringify(state.nextSteps)}

EVENTOS RECENTES:
${eventsSummary || 'Nenhum evento recente'}

Retorne EXATAMENTE este JSON (sem markdown):
{
  "gaps": [
    {"area": "blocker|milestone|kpi|risk|focus", "description": "...", "severity": "high|medium|low", "relatedCriteria": "...ou null"}
  ],
  "nextBestAction": "uma ação concreta e específica",
  "goalProgress": ${localProgress},
  "confidence": "low|medium|high"
}

Priorize gaps de alta severidade primeiro. nextBestAction deve ser em 1 frase curta e acionável.`

    try {
      const llmStart = Date.now()
      const res = await this.llm.chat.completions.create({
        model: 'gpt-local',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      const gapTokens = res.usage?.total_tokens ?? 0
      this.metrics.llmTokensTotal.inc({ module: 'graph', model: 'gpt-local' }, gapTokens)
      this.metrics.llmRequestDuration.observe({ module: 'graph', model: 'gpt-local' }, (Date.now() - llmStart) / 1000)
      this.logger.log(`Gap analysis raw: ${raw.slice(0, 200)}`)
      this.prisma.conversationMessage.create({
        data: {
          sessionId: `graph-${randomUUID().slice(0, 8)}`,
          module: 'graph',
          role: 'assistant',
          content: raw.slice(0, 500),
          tokensUsed: gapTokens,
        },
      }).catch(() => null)
      const parsed = this.extractJson(raw) as GapAnalysis
      return this.normalizeGapAnalysis(parsed, localProgress)
    } catch (err) {
      this.logger.warn(`Gap analysis LLM failed: ${err}`)
      return {
        gaps: [],
        nextBestAction: 'Execute /state/refresh para atualizar o estado do projeto',
        goalProgress: localProgress,
        confidence: 'low',
      }
    }
  }

  // O JSON do gap analysis vem de extração livre via LLM (sem response_format) — campos
  // podem vir ausentes/com tipo errado. buildGoalMermaid() chama sanitize() direto nesses
  // campos, e sanitize() crasha (TypeError) em valores não-string. Normaliza aqui, na
  // fronteira onde a saída não-confiável da LLM entra no sistema.
  private normalizeGapAnalysis(parsed: Partial<GapAnalysis>, fallbackProgress: number): GapAnalysis {
    const validAreas: GapItem['area'][] = ['blocker', 'milestone', 'kpi', 'risk', 'focus']

    const gaps: GapItem[] = Array.isArray(parsed.gaps)
      ? parsed.gaps.map(g => ({
          area: validAreas.includes(g?.area as GapItem['area']) ? (g.area as GapItem['area']) : 'focus',
          description: typeof g?.description === 'string' ? g.description : '',
          severity: g?.severity === 'high' || g?.severity === 'low' ? g.severity : 'medium',
          relatedCriteria: typeof g?.relatedCriteria === 'string' ? g.relatedCriteria : undefined,
        }))
      : []

    return {
      gaps,
      nextBestAction: typeof parsed.nextBestAction === 'string' ? parsed.nextBestAction : '',
      goalProgress: typeof parsed.goalProgress === 'number' ? parsed.goalProgress : fallbackProgress,
      confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' ? parsed.confidence : 'low',
    }
  }

  async proposeGoalProgress(projectId: string): Promise<{
    goalId: string | null
    goalTitle: string | null
    proposals: Array<{ criteriaId: string; text: string; confidence: 'high' | 'medium' | 'low'; reason: string }>
  }> {
    const goal = await this.prisma.projectGoal.findFirst({
      where: { projectId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    })
    if (!goal) return { goalId: null, goalTitle: null, proposals: [] }

    const pending = (goal.successCriteria as unknown as SuccessCriteria[]).filter(c => !c.done)
    if (!pending.length) return { goalId: goal.id, goalTitle: goal.title, proposals: [] }

    const since = new Date(Date.now() - 6 * 60 * 60 * 1000)
    const events = await this.prisma.event.findMany({
      where: {
        projectId,
        ts: { gte: since },
        memoryClass: { not: 'archive' },
        // O aviso que warnPendingGoalProposals escreve contém o TEXTO DO CRITÉRIO
        // literalmente. Sem excluí-lo, o ciclo seguinte lê o próprio aviso, encontra
        // overlap de vocabulário perfeito e "confirma" a proposta com a evidência que
        // ele mesmo produziu. Aconteceu em 2026-08-07 às 17:10: o critério c1 foi
        // proposto com confidence high citando "[idea] Possíveis critérios concluídos
        // no goal ..." — a saída anterior da própria função. Nenhum limiar de
        // similaridade pega isso, porque a similaridade é real; o que é falso é a
        // premissa de que aquele texto é evidência de trabalho feito.
        NOT: { metadata: { path: ['kind'], equals: 'goal_proposal_pending' } },
      },
      orderBy: { ts: 'desc' },
      take: 30,
      select: { content: true, intent: true, ts: true },
    })
    if (!events.length) return { goalId: goal.id, goalTitle: goal.title, proposals: [] }

    const eventsSummary = events
      .map((e, i) => `[${i}] [${e.intent ?? 'note'}] ${e.content.slice(0, 150)}`)
      .join('\n')

    const criteriaSummary = pending
      .map(c => `ID: ${c.id} | ${c.text}`)
      .join('\n')

    // O modelo precisa APONTAR o evento que sustenta a proposta, não descrevê-lo com
    // as próprias palavras: uma reason em prosa é inverificável e foi exatamente o que
    // produziu o falso positivo (um aprendizado sobre inferência de specialist virou
    // "evidência" de que traces do Langfuse tinham sido verificados). Com índice, o
    // servidor confere a evidência contra o evento real antes de aceitar.
    const prompt = `Você é um assistente de gestão de projetos. Com base na atividade da sessão, determine quais critérios de sucesso foram CONCLUÍDOS.

GOAL: ${goal.title}

CRITÉRIOS PENDENTES:
${criteriaSummary}

ATIVIDADE DA SESSÃO (últimas 6h, ${events.length} eventos, indexados de 0 a ${events.length - 1}):
${eventsSummary}

Regras:
- Só proponha um critério se algum evento da lista comprovar a conclusão DELE especificamente.
- criteriaId deve ser copiado EXATAMENTE de um dos IDs acima — nunca invente.
- evidenceEventIndexes deve conter os índices dos eventos que comprovam a conclusão.
- Trabalhar em algo relacionado NÃO é concluir. Na dúvida, não proponha.

Retorne EXATAMENTE este JSON (sem markdown):
{"proposals":[{"criteriaId":"id exato","confidence":"high|medium|low","evidenceEventIndexes":[0]}]}

Se não houver evidência suficiente, retorne {"proposals":[]}.`

    try {
      const start = Date.now()
      const res = await this.llm.chat.completions.create({
        model: 'gpt-local',
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      const tokens = res.usage?.total_tokens ?? 0
      this.metrics.llmTokensTotal.inc({ module: 'graph', model: 'gpt-local' }, tokens)
      this.metrics.llmRequestDuration.observe({ module: 'graph', model: 'gpt-local' }, (Date.now() - start) / 1000)
      const parsed = this.extractJson(raw) as { proposals?: unknown }
      const proposals = this.validateGoalProposals(parsed.proposals, pending, events)
      return { goalId: goal.id, goalTitle: goal.title, proposals }
    } catch (err) {
      this.logger.warn(`proposeGoalProgress LLM falhou: ${err}`)
      return { goalId: goal.id, goalTitle: goal.title, proposals: [] }
    }
  }

  // Palavras que aparecem em qualquer par de textos em pt-BR/en — se contassem como
  // evidência compartilhada, o gate de grounding viraria carimbo.
  private static readonly GROUNDING_STOPWORDS = new Set([
    'para', 'como', 'mais', 'pelo', 'pela', 'esse', 'essa', 'isso', 'este', 'esta',
    'quando', 'onde', 'porque', 'sobre', 'entre', 'ainda', 'depois', 'antes', 'todo',
    'toda', 'todos', 'todas', 'sendo', 'foram', 'estao', 'apenas', 'tambem', 'nao',
    'from', 'that', 'this', 'with', 'have', 'been', 'were', 'what', 'when', 'then',
    // Vocabulário estrutural do próprio domínio: aparece no texto de quase todo
    // critério E em quase todo evento, então só produz coincidência. "project"
    // sozinho já aprovou um falso positivo ("6 módulos congelados", que contém
    // project-memory, casando com "Bash: Invalidate project state cache").
    'criterio', 'criterios', 'projeto', 'project', 'sessao', 'evento', 'eventos',
    'bloco', 'blocos', 'item', 'itens', 'task', 'tasks',
  ])

  /** Tokens em comum exigidos entre critério e evento citado para aceitar a proposta. */
  private static readonly MIN_SHARED_TOKENS = 2

  /**
   * Reduz um texto ao conjunto de tokens que podem sustentar evidência: sem acento,
   * sem pontuação, sem palavra curta, sem palavra vazia.
   */
  private groundingTokens(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 4 && !GraphService.GROUNDING_STOPWORDS.has(t)),
    )
  }

  /**
   * Aceita uma proposta do LLM só quando ela é verificável contra dados reais.
   *
   * Motivo: um checkpoint propôs "traces dos specialists visíveis no Langfuse" como
   * concluído citando, como evidência, um aprendizado sobre o `infer()` do
   * SpecialistRegistry — assunto sem nenhuma relação. Como a saída do LLM era aceita
   * crua, a proposta entrou com confidence "high", virou next-step e passou a ser
   * injetada no contexto de toda sessão. Num sistema em que o humano confirma o
   * critério, um falso positivo é pior que um falso negativo: ele pede a confirmação
   * de algo que não aconteceu.
   *
   * Quatro barreiras, todas determinísticas:
   *  1. criteriaId tem que existir entre os pendentes (mata id alucinado)
   *  2. os índices de evidência têm que apontar para eventos que existem
   *  3. o evento citado tem que compartilhar vocabulário com o critério (grounding)
   *  4. `text` vem SEMPRE do banco, nunca do LLM
   */
  private validateGoalProposals(
    raw: unknown,
    pending: SuccessCriteria[],
    events: Array<{ content: string; intent: string | null }>,
  ): Array<{ criteriaId: string; text: string; confidence: 'high' | 'medium' | 'low'; reason: string }> {
    if (!Array.isArray(raw)) return []

    const pendingById = new Map(pending.map(c => [c.id, c]))
    const accepted: Array<{ criteriaId: string; text: string; confidence: 'high' | 'medium' | 'low'; reason: string }> = []
    const seen = new Set<string>()

    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>

      const criteria = pendingById.get(typeof p.criteriaId === 'string' ? p.criteriaId.trim() : '')
      if (!criteria) {
        this.logger.warn(`Proposta descartada: criteriaId "${String(p.criteriaId)}" não está entre os critérios pendentes`)
        continue
      }
      if (seen.has(criteria.id)) continue

      const indexes = (Array.isArray(p.evidenceEventIndexes) ? p.evidenceEventIndexes : [])
        .filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < events.length)
      if (indexes.length === 0) {
        this.logger.warn(`Proposta descartada para "${criteria.id}": nenhum índice de evidência válido`)
        continue
      }

      const cited = indexes.map(i => events[i])
      const criteriaTokens = this.groundingTokens(criteria.text)
      const evidenceTokens = this.groundingTokens(cited.map(e => e.content).join(' '))
      const shared = [...criteriaTokens].filter(t => evidenceTokens.has(t))
      // Um token em comum é coincidência, não evidência — foi assim que "Bash:
      // Invalidate project state cache" virou prova de "6 módulos congelados"
      // (o único elo era "project", de "project-memory"). Dois tokens já exigem
      // que o evento fale mesmo do assunto.
      if (shared.length < GraphService.MIN_SHARED_TOKENS) {
        this.logger.warn(
          `Proposta descartada para "${criteria.id}": evidência fraca demais ` +
          `(${shared.length} token(s) em comum: ${shared.join(', ') || 'nenhum'})`,
        )
        continue
      }

      const confidence = typeof p.confidence === 'string' && ['high', 'medium', 'low'].includes(p.confidence)
        ? p.confidence as 'high' | 'medium' | 'low'
        : 'medium'

      seen.add(criteria.id)
      accepted.push({
        criteriaId: criteria.id,
        text:       criteria.text,   // do banco — o LLM não escreve o texto do critério
        confidence,
        // A reason é o evento real citado, não a prosa do LLM: é o que o humano precisa
        // ler pra julgar, e é auditável.
        reason: cited.map(e => `[${e.intent ?? 'note'}] ${e.content.slice(0, 120)}`).join(' | '),
      })
    }

    return accepted
  }

  private extractJson(raw: string): unknown {
    try { return JSON.parse(raw) } catch {}
    const fenceStripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
    try { return JSON.parse(fenceStripped) } catch {}
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Nenhum JSON encontrado na resposta')
  }
}
