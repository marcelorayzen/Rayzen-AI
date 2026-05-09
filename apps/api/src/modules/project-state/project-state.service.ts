import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { HealthScoreService } from '../health/health.service'
import { EventService } from '../event/event.service'

export interface Milestone {
  id: string
  title: string
  status: 'pending' | 'active' | 'done'
}

export interface BacklogItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
}

export interface ProjectStateData {
  objective: string
  stage: string
  blockers: string[]
  recentDecisions: string[]
  nextSteps: string[]
  risks: string[]
  docGaps: string[]
  riskLevel: 'low' | 'medium' | 'high'
  milestones: Milestone[]
  backlog: BacklogItem[]
  activeFocus: string
  definitionOfDone: string
}

@Injectable()
export class ProjectStateService {
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private healthScore: HealthScoreService,
    private eventService: EventService,
  ) {
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  async get(projectId: string) {
    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) return null
    return this.serialize(state)
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
      .map(e => `[${e.ts.toISOString().slice(0, 16)}] [${e.intent ?? e.type}] ${e.content}`)
      .join('\n')

    const artifactsText = artifacts
      .map(a => {
        const c = a.content as Record<string, unknown>
        const decisions = (c['decisions'] as string[] ?? []).slice(0, 3).join('; ')
        const steps = (c['next_steps'] as string[] ?? []).slice(0, 3).join('; ')
        return `Síntese ${a.createdAt.toISOString().slice(0, 10)}: decisões=[${decisions}] próximos=[${steps}]`
      })
      .join('\n')

    const docTypes = docs.map(d => d.type).join(', ')

    // Preserve existing planning fields to avoid overwriting manual edits
    const existingMilestones = existing ? JSON.stringify(existing.milestones) : '[]'
    const existingBacklog = JSON.stringify(existing?.backlog ?? '[]')
    const existingFocus = existing?.activeFocus ?? ''
    const existingDod = existing?.definitionOfDone ?? ''

    const prompt = `Analise o estado atual deste projeto de software e retorne JSON estruturado.

Projeto: ${project.name}
Descrição: ${project.description ?? 'não informada'}
Goals: ${project.goals ?? 'não informados'}

Eventos recentes (mais novo primeiro):
${eventsText || 'nenhum evento registrado'}

Sínteses de sessões anteriores:
${artifactsText || 'nenhuma síntese disponível'}

Documentos gerados: ${docTypes || 'nenhum'}

Estado de planejamento atual (preserve se já existe e é válido):
- Milestones: ${existingMilestones}
- Backlog: ${existingBacklog}
- Foco ativo: ${existingFocus || 'não definido'}
- Critério de done: ${existingDod || 'não definido'}

Retorne APENAS JSON válido neste formato:
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
- objective: o que o projeto está tentando alcançar AGORA (não o objetivo final geral)
- stage: fase atual real com base na atividade observada
- blockers: impedimentos concretos identificados nos eventos/sínteses
- riskLevel: "high" se há blockers críticos ou projeto parado há muito tempo, "medium" se há riscos mas progresso, "low" se tudo flui
- milestones: derive dos goals e next steps, máximo 5; preserve os existentes se forem válidos
- backlog: itens pendentes em ordem de prioridade, máximo 10; preserve os existentes se forem válidos
- activeFocus: preserve o existente se ainda faz sentido, caso contrário derive do next step mais urgente
- Máximo 5 itens por array (exceto backlog)
- Se não há dados suficientes para uma categoria, retorne array vazio ou string vazia`

    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })

    let derived: ProjectStateData
    try {
      derived = JSON.parse(res.choices[0].message.content ?? '{}') as ProjectStateData
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
        blockers: derived.blockers as object,
        recentDecisions: derived.recentDecisions as object,
        nextSteps: derived.nextSteps as object,
        risks: derived.risks as object,
        docGaps: derived.docGaps as object,
        riskLevel: derived.riskLevel,
        milestones: (derived.milestones ?? []) as object,
        backlog: (derived.backlog ?? []) as object,
        activeFocus: derived.activeFocus || null,
        definitionOfDone: derived.definitionOfDone || null,
      },
      update: {
        objective: derived.objective,
        stage: derived.stage,
        blockers: derived.blockers as object,
        recentDecisions: derived.recentDecisions as object,
        nextSteps: derived.nextSteps as object,
        risks: derived.risks as object,
        docGaps: derived.docGaps as object,
        riskLevel: derived.riskLevel,
        milestones: (derived.milestones ?? []) as object,
        backlog: (derived.backlog ?? []) as object,
        activeFocus: derived.activeFocus || null,
        definitionOfDone: derived.definitionOfDone || null,
      },
    })

    // Background: compute health score + promote stale events (Fase 12 & 13)
    this.healthScore.compute(projectId).catch(() => null)
    this.eventService.promoteStaleEvents(projectId).catch(() => null)

    return this.serialize(state)
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
    const blockers = (serialized?.blockers ?? []) as string[]

    // Next best step: activeFocus > primeiro nextStep > primeiro backlog item
    const nextBestStep = serialized?.activeFocus
      ?? (serialized?.nextSteps as string[])?.[0]
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
      blockers?: string[]
      nextSteps?: string[]
    },
  ) {
    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) throw new NotFoundException('Estado do projeto não encontrado')

    const updated = await this.prisma.projectState.update({
      where: { projectId },
      data: {
        ...(patch.milestones !== undefined ? { milestones: patch.milestones as object } : {}),
        ...(patch.backlog !== undefined ? { backlog: patch.backlog as object } : {}),
        ...(patch.activeFocus !== undefined ? { activeFocus: patch.activeFocus || null } : {}),
        ...(patch.definitionOfDone !== undefined ? { definitionOfDone: patch.definitionOfDone || null } : {}),
        ...(patch.blockers !== undefined ? { blockers: patch.blockers } : {}),
        ...(patch.nextSteps !== undefined ? { nextSteps: patch.nextSteps } : {}),
      },
    })

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
      blockers: (state.blockers as string[]) ?? [],
      recentDecisions: (state.recentDecisions as string[]) ?? [],
      nextSteps: (state.nextSteps as string[]) ?? [],
      risks: (state.risks as string[]) ?? [],
      docGaps: (state.docGaps as string[]) ?? [],
      riskLevel: state.riskLevel as 'low' | 'medium' | 'high',
      milestones: (state.milestones as Milestone[]) ?? [],
      backlog: (state.backlog as BacklogItem[]) ?? [],
      activeFocus: state.activeFocus ?? '',
      definitionOfDone: state.definitionOfDone ?? '',
      updatedAt: state.updatedAt.toISOString(),
    }
  }
}
