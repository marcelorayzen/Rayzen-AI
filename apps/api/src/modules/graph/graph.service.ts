import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ProjectStateService, ProjectStateData } from '../project-state/project-state.service'
import { HealthScoreService } from '../health/health.service'
import OpenAI from 'openai'

export interface SuccessCriteria {
  id: string
  text: string
  done: boolean
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
}

export interface EventNode {
  id: string
  content: string
  intent: string | null
  type: string
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

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name)
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateService: ProjectStateService,
    private readonly healthService: HealthScoreService,
    private readonly config: ConfigService,
  ) {
    this.llm = new OpenAI({
      apiKey: this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL') ?? 'http://localhost:4100/v1',
    })
  }

  async generateStateMermaid(projectId: string): Promise<string> {
    const state = await this.stateService.get(projectId)
    if (!state) return 'flowchart TD\n  N["Nenhum estado disponível — execute /state/refresh"]'

    const lines: string[] = ['flowchart TD']
    const sanitize = (s: string) => s.replace(/["\[\]\u{1F300}-\u{1FFFF}]/gu, '').replace(/[^\x20-\x7EÀ-ɏ]/g, '').slice(0, 55)

    // Milestones
    const milestones = (state.milestones ?? []) as Array<{ id: string; title: string; status: string }>
    milestones.forEach((m, i) => {
      const tag = m.status === 'done' ? '[done]' : m.status === 'active' ? '[ativo]' : '[pendente]'
      lines.push(`  M${i}["${tag} ${sanitize(m.title)}"]`)
      if (m.status === 'done') lines.push(`  style M${i} fill:#22c55e,color:#fff`)
      else if (m.status === 'active') lines.push(`  style M${i} fill:#3b82f6,color:#fff`)
    })

    // Blockers → connect to active milestones
    const blockers = (state.blockers ?? []) as string[]
    blockers.slice(0, 4).forEach((b, i) => {
      lines.push(`  B${i}["[blocker] ${sanitize(b)}"]`)
      lines.push(`  style B${i} fill:#ef4444,color:#fff`)
      const activeIdx = milestones.findIndex(m => m.status === 'active')
      if (activeIdx >= 0) lines.push(`  B${i} -->|bloqueia| M${activeIdx}`)
    })

    // Next steps
    const nextSteps = (state.nextSteps ?? []) as string[]
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

    const recentEvents = await this.prisma.event.findMany({
      where: {
        projectId,
        intent: { in: ['decision', 'problem', 'idea'] },
      },
      orderBy: { ts: 'desc' },
      take: 10,
      select: { content: true, intent: true, ts: true },
    })

    const gapAnalysis = state
      ? await this.analyzeGap(goal, state, recentEvents)
      : null

    const mermaid = this.buildGoalMermaid(goal, gapAnalysis)

    return {
      goal: goal as unknown as Record<string, unknown>,
      state,
      mermaid,
      gapAnalysis,
      healthScore,
      updatedAt: new Date().toISOString(),
    }
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

  async toggleCriteria(goalId: string, criteriaId: string, done: boolean) {
    const goal = await this.prisma.projectGoal.findUniqueOrThrow({ where: { id: goalId } })
    const criteria = (goal.successCriteria as unknown as SuccessCriteria[]).map(c =>
      c.id === criteriaId ? { ...c, done } : c,
    )
    return this.prisma.projectGoal.update({
      where: { id: goalId },
      data: { successCriteria: criteria as unknown as Parameters<typeof this.prisma.projectGoal.update>[0]['data']['successCriteria'] },
    })
  }

  async listGoals(projectId: string) {
    return this.prisma.projectGoal.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getEventGraph(projectId: string): Promise<EventGraphData> {
    const [state, rawEvents] = await Promise.all([
      this.stateService.get(projectId),
      this.prisma.event.findMany({
        where: {
          projectId,
          OR: [
            { intent: { in: ['decision', 'problem', 'idea', 'reference'] } },
            { type: { in: ['decision', 'note'] } },
          ],
        },
        orderBy: { ts: 'desc' },
        take: 20,
        select: { id: true, content: true, intent: true, type: true, ts: true },
      }),
    ])

    const milestones = ((state?.milestones ?? []) as Array<{ id: string; title: string; status: string }>)

    const events: EventNode[] = rawEvents.map(e => ({
      id: e.id,
      content: e.content,
      intent: e.intent,
      type: e.type,
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
      const res = await this.llm.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
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
${events.map(e => `- id="${e.id}": [${e.intent ?? e.type}] ${e.content.slice(0, 100)}`).join('\n')}

Retorne EXATAMENTE este JSON (sem markdown):
{
  "mappings": [
    { "eventId": "id-do-evento", "milestoneId": "id-do-milestone-ou-none" }
  ]
}

Inclua todos os eventos. Use os ids exatos. milestoneId="none" quando sem relação clara.`

    try {
      const res = await this.llm.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
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
    const sanitize = (s: string) => s.replace(/["\[\]\u{1F300}-\u{1FFFF}]/gu, '').replace(/[^\x20-\x7EÀ-ɏ]/g, '').slice(0, 55)
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
      const res = await this.llm.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = res.choices[0]?.message?.content ?? ''
      this.logger.log(`Gap analysis raw: ${raw.slice(0, 200)}`)
      const parsed = this.extractJson(raw) as GapAnalysis
      parsed.goalProgress = parsed.goalProgress ?? localProgress
      return parsed
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

  private extractJson(raw: string): unknown {
    try { return JSON.parse(raw) } catch {}
    const fenceStripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
    try { return JSON.parse(fenceStripped) } catch {}
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Nenhum JSON encontrado na resposta')
  }
}
