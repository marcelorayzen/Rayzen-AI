import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { HealthScoreService } from '../health/health.service'
import { EventService } from '../event/event.service'
import { CacheService } from '../cache/cache.service'
import { MetricsService } from '../metrics/metrics.service'

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'pending' | 'active' | 'done'
}

export interface PlanningNode {
  id: string
  title: string
  description?: string
}

export interface GraphLink {
  id: string
  sourceId: string
  targetId: string
  label?: string
}

export interface BacklogItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
}

export interface ProjectStateData {
  objective: string
  stage: string
  blockers: PlanningNode[]
  recentDecisions: string[]
  nextSteps: PlanningNode[]
  risks: string[]
  docGaps: string[]
  riskLevel: 'low' | 'medium' | 'high'
  milestones: Milestone[]
  graphLinks: GraphLink[]
  backlog: BacklogItem[]
  activeFocus: string
  definitionOfDone: string
}

@Injectable()
export class ProjectStateService {
  private readonly logger = new Logger(ProjectStateService.name)
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private healthScore: HealthScoreService,
    private eventService: EventService,
    private cache: CacheService,
    private readonly metrics: MetricsService,
  ) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  async get(projectId: string): Promise<ProjectStateData & { id: string; projectId: string; updatedAt: string } | null> {
    type Serialized = ReturnType<ProjectStateService['serialize']>
    const cacheKey = `project-state:${projectId}`
    const cached = await this.cache.get<Serialized>(cacheKey)
    if (cached) return cached

    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) return null
    const result = this.serialize(state)
    await this.cache.set(cacheKey, result, 600)  // 10 min
    return result
  }

  async refresh(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    // Coletar contexto: eventos recentes + artefatos de síntese + documentos gerados
    const [events, artifacts, docs, existing] = await Promise.all([
      this.prisma.event.findMany({
        where: { projectId },
        orderBy: { ts: 'desc' },
        take: 80,
      }),
      this.prisma.sessionArtifact.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.projectDocument.findMany({
        where: { projectId },
      }),
      this.prisma.projectState.findUnique({ where: { projectId } }),
    ])

    const eventsText = events
      .map(e => {
        const meta = e.metadata as Record<string, unknown> | null
        const modules = (meta?.['graphify'] as { modules?: string[] } | null)?.modules
        const modulePart = modules?.length ? ` [módulos:${modules.join(',')}]` : ''
        return `[${e.ts.toISOString().slice(0, 16)}] [${e.intent ?? e.type}]${modulePart} ${e.content}`
      })
      .join('\n')

    // Módulos mais ativos recentemente (derivado do metadata graphify dos eventos)
    const moduleCounts: Record<string, number> = {}
    for (const e of events) {
      const meta = e.metadata as Record<string, unknown> | null
      const modules = (meta?.['graphify'] as { modules?: string[] } | null)?.modules ?? []
      for (const m of modules) moduleCounts[m] = (moduleCounts[m] ?? 0) + 1
    }
    const activeModules = Object.entries(moduleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([m, n]) => `${m} (${n} eventos)`)
      .join(', ')

    const artifactsText = artifacts
      .map(a => {
        const c = a.content as Record<string, unknown>
        const decisions = (c['decisions'] as string[] ?? []).slice(0, 3).join('; ')
        const steps = (c['next_steps'] as string[] ?? []).slice(0, 3).join('; ')
        return `Síntese ${a.createdAt.toISOString().slice(0, 10)}: decisões=[${decisions}] próximos=[${steps}]`
      })
      .join('\n')

    const docTypes = docs.map(d => d.type).join(', ')

    const existingFocus = existing?.activeFocus ?? ''
    const existingDod = existing?.definitionOfDone ?? ''

    const prompt = `Analise o estado atual deste projeto de software e retorne JSON estruturado.

Projeto: ${project.name}
Descrição: ${project.description ?? 'não informada'}
Goals: ${project.goals ?? 'não informados'}

${activeModules ? `Módulos mais ativos recentemente (por nº de eventos):\n${activeModules}\n` : ''}
Eventos recentes (mais novo primeiro, com módulos de código tocados quando disponível):
${eventsText || 'nenhum evento registrado'}

Sínteses de sessões anteriores:
${artifactsText || 'nenhuma síntese disponível'}

Documentos gerados: ${docTypes || 'nenhum'}

Foco ativo atual: ${existingFocus || 'não definido'}
Critério de done atual: ${existingDod || 'não definido'}

Retorne APENAS JSON válido neste formato (sem markdown, sem texto extra):
{
  "objective": "objetivo atual em uma frase clara e específica",
  "stage": "discovery|building|stabilizing|maintaining|paused",
  "blockers": ["bloqueio 1", "bloqueio 2"],
  "recentDecisions": ["decisão recente 1", "decisão recente 2"],
  "nextSteps": ["próximo passo 1", "próximo passo 2", "próximo passo 3"],
  "risks": ["risco 1", "risco 2"],
  "docGaps": ["documentação faltando 1", "documentação faltando 2"],
  "riskLevel": "low|medium|high",
  "milestones": [{ "id": "uuid-curto", "title": "...", "status": "pending|active|done" }],
  "backlog": [{ "id": "uuid-curto", "title": "...", "priority": "high|medium|low" }],
  "activeFocus": "o que está sendo trabalhado agora (string curta) ou vazio",
  "definitionOfDone": "critério de aceite do milestone atual ou vazio"
}

Regras:
- objective: o que o projeto está tentando alcançar AGORA baseado nos eventos mais recentes
- stage: fase atual real com base na atividade observada
- blockers: apenas impedimentos ATIVOS identificados nos eventos recentes
- nextSteps: derive EXCLUSIVAMENTE dos eventos e sínteses mais recentes — não repita itens antigos já concluídos
- riskLevel: "high" se há blockers críticos, "medium" se há riscos mas progresso, "low" se tudo flui
- milestones: derive dos eventos e goals, máximo 5; marque como "done" os que aparecem concluídos nos eventos
- backlog: itens pendentes derivados dos eventos recentes, máximo 10
- activeFocus: o que está sendo trabalhado AGORA com base nos eventos mais recentes
- Máximo 5 itens por array (exceto backlog)
- Se não há dados suficientes para uma categoria, retorne array vazio ou string vazia`

    const llmStart = Date.now()
    let model = 'gpt-4o'
    let res = await this.llm.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }).catch(async (err: unknown) => {
      const status = (err as { status?: number })?.status
      if (status === 429) {
        this.logger.warn('gpt-4o rate limited — fallback para gpt-4o-mini')
        model = 'gpt-4o-mini'
        return this.llm.chat.completions.create({
          model,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        })
      }
      throw err
    })

    const raw = res.choices[0].message.content ?? '{}'
    const psTokens = res.usage?.total_tokens ?? 0
    this.metrics.llmTokensTotal.inc({ module: 'project-state', model }, psTokens)
    this.metrics.llmRequestDuration.observe({ module: 'project-state', model }, (Date.now() - llmStart) / 1000)
    this.prisma.conversationMessage.create({
      data: {
        sessionId: `ps-${randomUUID().slice(0, 8)}`,
        module: 'project-state',
        projectId,
        role: 'assistant',
        content: raw.slice(0, 1000),
        tokensUsed: psTokens,
      },
    }).catch(() => null)
    let derived: ProjectStateData
    try {
      // Extração robusta: strip code fences + regex para encontrar o JSON
      const stripped = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()
      const match = stripped.match(/\{[\s\S]*\}/)
      derived = JSON.parse(match ? match[0] : stripped) as ProjectStateData
    } catch {
      derived = {
        objective: '',
        stage: 'building',
        blockers: [],
        recentDecisions: [],
        nextSteps: [],
        risks: [],
        docGaps: [],
        riskLevel: 'low',
        milestones: [],
        graphLinks: [],
        backlog: [],
        activeFocus: '',
        definitionOfDone: '',
      }
    }

    const state = await this.prisma.projectState.upsert({
      where: { projectId },
      create: {
        projectId,
        objective: derived.objective,
        stage: derived.stage,
        blockers: this.normalizePlanningNodes(derived.blockers, 'blocker') as object,
        recentDecisions: derived.recentDecisions as object,
        nextSteps: this.normalizePlanningNodes(derived.nextSteps, 'next') as object,
        risks: derived.risks as object,
        docGaps: derived.docGaps as object,
        riskLevel: derived.riskLevel,
        milestones: this.normalizeMilestones(derived.milestones) as object,
        graphLinks: [],
        backlog: (derived.backlog ?? []) as object,
        activeFocus: derived.activeFocus || null,
        definitionOfDone: derived.definitionOfDone || null,
      },
      update: {
        objective: derived.objective,
        stage: derived.stage,
        blockers: this.normalizePlanningNodes(derived.blockers, 'blocker') as object,
        recentDecisions: derived.recentDecisions as object,
        nextSteps: this.normalizePlanningNodes(derived.nextSteps, 'next') as object,
        risks: derived.risks as object,
        docGaps: derived.docGaps as object,
        riskLevel: derived.riskLevel,
        milestones: this.normalizeMilestones(derived.milestones) as object,
        graphLinks: (existing?.graphLinks ?? []) as object,
        backlog: (derived.backlog ?? []) as object,
        activeFocus: derived.activeFocus || null,
        definitionOfDone: derived.definitionOfDone || null,
      },
    })

    // Background: compute health score + promote stale events (Fase 12 & 13)
    this.healthScore.compute(projectId).catch(() => null)
    this.eventService.promoteStaleEvents(projectId).catch(() => null)

    const result = this.serialize(state)
    await this.cache.set(`project-state:${projectId}`, result, 600)
    return result
  }

  async resume(projectId: string): Promise<{
    lastState: ReturnType<ProjectStateService['serialize']> | null
    recentActivity: string[]
    blockers: string[]
    nextBestStep: string
    inactiveSince: string | null
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const [state, recentEvents, lastArtifact] = await Promise.all([
      this.prisma.projectState.findUnique({ where: { projectId } }),
      this.prisma.event.findMany({
        where: { projectId },
        orderBy: { ts: 'desc' },
        take: 15,
      }),
      this.prisma.sessionArtifact.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const serialized = state ? this.serialize(state) : null

    // Calcular inatividade
    const lastEventTs = recentEvents[0]?.ts ?? null
    const inactiveSince = lastEventTs ? lastEventTs.toISOString() : null

    // Resumo de atividade recente
    const recentActivity = recentEvents.slice(0, 8).map(e =>
      `[${e.ts.toISOString().slice(0, 16)}] ${e.content.slice(0, 120)}`
    )

    // Blockers do estado atual
    const blockers = (serialized?.blockers ?? []).map(b => b.title)

    // Next best step: activeFocus > primeiro nextStep > primeiro backlog item
    const nextBestStep = serialized?.activeFocus
      ?? serialized?.nextSteps?.[0]?.title
      ?? ((serialized?.backlog as BacklogItem[])?.[0]?.title ?? '')

    // Se há artefato recente de síntese, usar para enriquecer o brief
    if (lastArtifact) {
      const c = lastArtifact.content as Record<string, unknown>
      const artifactSteps = (c['next_steps'] as string[] ?? []).slice(0, 3)
      const artifactDecisions = (c['decisions'] as string[] ?? []).slice(0, 3)
      recentActivity.push(
        ...artifactDecisions.map(d => `[decisão] ${d}`),
        ...artifactSteps.map(s => `[próximo] ${s}`),
      )
    }

    return {
      lastState: serialized,
      recentActivity,
      blockers,
      nextBestStep,
      inactiveSince,
    }
  }

  async updatePlanning(
    projectId: string,
    patch: {
      milestones?: Milestone[]
      backlog?: BacklogItem[]
      activeFocus?: string
      definitionOfDone?: string
      blockers?: Array<string | PlanningNode>
      nextSteps?: Array<string | PlanningNode>
      graphLinks?: GraphLink[]
    },
  ) {
    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) throw new NotFoundException('Estado do projeto não encontrado')

    const milestones = patch.milestones !== undefined ? this.normalizeMilestones(patch.milestones) : undefined
    const blockers = patch.blockers !== undefined ? this.normalizePlanningNodes(patch.blockers, 'blocker') : undefined
    const nextSteps = patch.nextSteps !== undefined ? this.normalizePlanningNodes(patch.nextSteps, 'next') : undefined
    const graphLinks = patch.graphLinks !== undefined ? this.normalizeGraphLinks(patch.graphLinks) : undefined

    const updated = await this.prisma.projectState.update({
      where: { projectId },
      data: {
        ...(milestones !== undefined ? { milestones: milestones as object } : {}),
        ...(patch.backlog !== undefined ? { backlog: patch.backlog as object } : {}),
        ...(patch.activeFocus !== undefined ? { activeFocus: patch.activeFocus || null } : {}),
        ...(patch.definitionOfDone !== undefined ? { definitionOfDone: patch.definitionOfDone || null } : {}),
        ...(blockers !== undefined ? { blockers: blockers as object } : {}),
        ...(nextSteps !== undefined ? { nextSteps: nextSteps as object } : {}),
        ...(graphLinks !== undefined ? { graphLinks: graphLinks as object } : {}),
      },
    })

    await this.cache.del(`project-state:${projectId}`)
    return this.serialize(updated)
  }

  serialize(state: {
    id: string
    projectId: string
    objective: string | null
    stage: string | null
    blockers: unknown
    recentDecisions: unknown
    nextSteps: unknown
    risks: unknown
    docGaps: unknown
    riskLevel: string
    milestones: unknown
    graphLinks?: unknown
    backlog: unknown
    activeFocus: string | null
    definitionOfDone: string | null
    updatedAt: Date
  }) {
    return {
      id: state.id,
      projectId: state.projectId,
      objective: state.objective ?? '',
      stage: state.stage ?? 'building',
      blockers: this.normalizePlanningNodes(state.blockers, 'blocker'),
      recentDecisions: (state.recentDecisions as string[]) ?? [],
      nextSteps: this.normalizePlanningNodes(state.nextSteps, 'next'),
      risks: (state.risks as string[]) ?? [],
      docGaps: (state.docGaps as string[]) ?? [],
      riskLevel: state.riskLevel as 'low' | 'medium' | 'high',
      milestones: this.normalizeMilestones(state.milestones),
      graphLinks: this.normalizeGraphLinks(state.graphLinks),
      backlog: (state.backlog as BacklogItem[]) ?? [],
      activeFocus: state.activeFocus ?? '',
      definitionOfDone: state.definitionOfDone ?? '',
      updatedAt: state.updatedAt.toISOString(),
    }
  }

  private normalizeMilestones(value: unknown): Milestone[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item, index) => {
        if (typeof item === 'string') {
          return { id: this.legacyId('milestone', item, index), title: item, status: 'pending' as const }
        }
        if (!item || typeof item !== 'object') return null
        const raw = item as Record<string, unknown>
        const title = typeof raw.title === 'string' ? raw.title.trim() : ''
        if (!title) return null
        const status = raw.status === 'active' || raw.status === 'done' ? raw.status : 'pending'
        const description = typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined
        return {
          id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : this.legacyId('milestone', title, index),
          title,
          ...(description ? { description } : {}),
          status,
        }
      })
      .filter((item): item is Milestone => Boolean(item))
  }

  private normalizePlanningNodes(value: unknown, prefix: 'blocker' | 'next'): PlanningNode[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item, index) => {
        if (typeof item === 'string') {
          return { id: this.legacyId(prefix, item, index), title: item }
        }
        if (!item || typeof item !== 'object') return null
        const raw = item as Record<string, unknown>
        const title = typeof raw.title === 'string' ? raw.title.trim() : ''
        if (!title) return null
        const description = typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined
        return {
          id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : this.legacyId(prefix, title, index),
          title,
          ...(description ? { description } : {}),
        }
      })
      .filter((item): item is PlanningNode => Boolean(item))
  }

  private normalizeGraphLinks(value: unknown): GraphLink[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const raw = item as Record<string, unknown>
        const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim() : ''
        const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : ''
        if (!sourceId || !targetId || sourceId === targetId) return null
        const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined
        return {
          id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `link-${index}-${sourceId}-${targetId}`,
          sourceId,
          targetId,
          ...(label ? { label } : {}),
        }
      })
      .filter((item): item is GraphLink => Boolean(item))
  }

  private legacyId(prefix: string, title: string, index: number) {
    const slug = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32)
    return `${prefix}-${index}-${slug || 'item'}`
  }
}
