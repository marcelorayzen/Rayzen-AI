import { Injectable, Logger } from '@nestjs/common'
import { MissionService } from '../mission/mission.service'
import { SkillEngineService } from '../skill-engine/skill-engine.service'
import { AiRouterService } from '../ai-router/ai-router.service'
import { SpecialistService } from '../specialists/specialist.service'
import { SpecialistAgentService } from '../specialist-agent/specialist-agent.service'
import { SpecialistType } from '../specialists/specialist-registry'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { DocumentationEngineService, DocType } from '../documentation-engine/documentation-engine.service'
import { ClarificationService } from '../agent-dialogue/clarification.service'

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface Step {
  id:         string
  title:      string
  status:     StepStatus
  skillId?:   string | null
  prompt?:    string | null
  executor:   string
  dependsOn:  string[]
  input:      Record<string, unknown>
  retries:    number
}

interface RetryPolicy { maxRetries: number; backoffMs: number }
const DEFAULT_RETRY: RetryPolicy = { maxRetries: 2, backoffMs: 1000 }

// Sinaliza que o specialist foi interrompido por um gate criado durante tool-use
// (risco medium/high no meio do loop) — distinto de falha real. Sem isso,
// runStepLogic devolvia o output do specialist "interrompido" como se tivesse
// concluído com sucesso, e o step virava 'done' com um gate pendente órfão.
class StepInterruptedError extends Error {
  constructor(public readonly output: Record<string, unknown>) {
    super('Specialist interrompido — aguardando aprovação de gate criado durante tool-use')
  }
}

// Workflow templates — pre-defined step sequences per mission type
export const WORKFLOW_TEMPLATES: Record<string, Array<{ key: string; title: string; executor: string; skillId?: string; dependsOn: string[] }>> = {
  implementation: [
    { key: 'context',   title: 'Gather context',          executor: 'ai',    dependsOn: [] },
    { key: 'plan',      title: 'Plan implementation',     executor: 'ai',    dependsOn: ['context'] },
    { key: 'implement', title: 'Implement solution',      executor: 'ai',    dependsOn: ['plan'] },
    { key: 'test',      title: 'Run tests',               executor: 'skill', skillId: 'jarvis:run_tests', dependsOn: ['implement'] },
    { key: 'review',    title: 'Review changes',          executor: 'ai',    dependsOn: ['test'] },
    { key: 'document',  title: 'Document changes',        executor: 'ai',    dependsOn: ['review'] },
  ],
  debugging: [
    { key: 'reproduce', title: 'Reproduce issue',         executor: 'ai',    dependsOn: [] },
    { key: 'analyze',   title: 'Analyze root cause',      executor: 'ai',    dependsOn: ['reproduce'] },
    { key: 'fix',       title: 'Apply fix',               executor: 'ai',    dependsOn: ['analyze'] },
    { key: 'verify',    title: 'Verify fix',              executor: 'skill', skillId: 'jarvis:run_tests', dependsOn: ['fix'] },
  ],
  review: [
    { key: 'read',      title: 'Read code/docs',          executor: 'ai',    dependsOn: [] },
    { key: 'analyze',   title: 'Analyze quality',         executor: 'ai',    dependsOn: ['read'] },
    { key: 'report',    title: 'Generate review report',  executor: 'ai',    dependsOn: ['analyze'] },
  ],
}

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name)

  constructor(
    private readonly missions:        MissionService,
    private readonly skillEngine:     SkillEngineService,
    private readonly aiRouter:        AiRouterService,
    private readonly specialists:     SpecialistService,
    private readonly specialistAgents: SpecialistAgentService,
    private readonly gates:           ApprovalGatesService,
    private readonly docs:            DocumentationEngineService,
    private readonly clarification:   ClarificationService,
  ) {}

  // Execute all pending steps respecting DAG dependencies
  async execute(missionId: string, projectId: string): Promise<{ completed: number; failed: number; pending: number; docsGenerated: DocType[] }> {
    const mission = await this.missions.findOne(missionId)
    // 'paused' é aceito para permitir retomada após aprovação de gate
    if (!['pending', 'active', 'paused'].includes(mission.status)) {
      return { completed: 0, failed: 0, pending: 0, docsGenerated: [] }
    }

    if (mission.status === 'pending' || mission.status === 'paused') {
      await this.missions.transition(missionId, 'active').catch(() => null)
    }

    const steps = mission.steps as Step[]
    const stats: { completed: number; failed: number; pending: number; docsGenerated: DocType[] } = { completed: 0, failed: 0, pending: 0, docsGenerated: [] }

    // Steps bloqueados por ApprovalGate pendente — não executam até aprovação.
    const gatedStepIds = new Set(
      (await this.gates.findPending(undefined, missionId)).map((g) => g.stepId).filter(Boolean) as string[],
    )

    // Topological sort — find steps that can run now (deps done E sem gate pendente)
    const canRun = (step: Step) => {
      if (step.status !== 'pending') return false
      if (gatedStepIds.has(step.id)) return false
      // Step de ação humana nunca é despachado pra um Specialist de IA — fica
      // pending até alguém resolver via PATCH .../steps/:stepId.
      if (step.executor === 'human') return false
      return step.dependsOn.every((depId) => {
        const dep = steps.find((s) => s.id === depId)
        return dep?.status === 'done'
      })
    }

    // Iterate until no more steps can be executed
    let iteration = 0
    while (iteration < 20) {
      const ready = steps.filter(canRun)
      if (ready.length === 0) break
      iteration++

      // Execute all ready steps in parallel
      await Promise.all(ready.map(async (step) => {
        await this.executeStep(step, missionId, projectId, mission.objective, mission.specialistId, steps, DEFAULT_RETRY)
        // Refresh step from DB
        const updated = await this.missions.listSteps(missionId)
        const fresh   = updated.find((s) => s.id === step.id)
        if (fresh) Object.assign(step, fresh)
      }))
    }

    // Tally results
    const final = await this.missions.listSteps(missionId)
    let blockedByGate = 0
    let blockedByHuman = 0
    for (const s of final) {
      if      (s.status === 'done')    stats.completed++
      else if (s.status === 'failed')  stats.failed++
      else if (s.status === 'pending') {
        stats.pending++
        if (gatedStepIds.has(s.id)) blockedByGate++
        if (s.executor === 'human')   blockedByHuman++
      }
    }

    // Transition mission status
    if (stats.failed > 0) {
      await this.missions.transition(missionId, 'failed').catch(() => null)
    } else if (blockedByGate > 0) {
      // Há steps prontos mas travados em ApprovalGate — pausa aguardando aprovação
      await this.missions.transition(missionId, 'paused').catch(() => null)
      this.logger.log(`Mission ${missionId} pausada — ${blockedByGate} step(s) aguardando aprovação`)
    } else if (blockedByHuman > 0) {
      await this.missions.transition(missionId, 'paused').catch(() => null)
      this.logger.log(`Mission ${missionId} pausada — ${blockedByHuman} step(s) aguardando ação humana`)
    } else if (stats.pending === 0) {
      await this.missions.transition(missionId, 'done').catch(() => null)
      // Fire-and-forget: docs gerados em background após missão concluída
      void this.docs.onMissionCompleted(missionId, projectId)
        .then((types) => {
          this.logger.log(`Docs gerados para missão ${missionId}: ${types.join(', ')}`)
          stats.docsGenerated = types
        })
        .catch((e) => this.logger.warn(`doc generation failed for ${missionId}: ${e}`))
    }

    return stats
  }

  private async executeStep(
    step: Step,
    missionId: string,
    projectId: string,
    objective: string,
    specialistId: string | null,
    allSteps: Step[],
    retry: RetryPolicy,
  ): Promise<void> {
    await this.missions.updateStep(missionId, step.id, { status: 'running' })

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        const output = await this.runStepLogic(step, missionId, projectId, objective, specialistId, allSteps)
        await this.missions.updateStep(missionId, step.id, { status: 'done', output })
        this.logger.debug(`Step ${step.title} done`)
        return
      } catch (e) {
        if (e instanceof StepInterruptedError) {
          // Não retenta — retentar so criaria mais um gate duplicado pro mesmo
          // step. Resume real acontece em ApprovalGatesController.approve()
          // (reseta o step pra pending quando o gate é aprovado).
          await this.missions.updateStep(missionId, step.id, { status: 'skipped', output: e.output })
          this.logger.log(`Step ${step.title} interrompido por gate — aguardando aprovação`)
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        this.logger.warn(`Step ${step.title} attempt ${attempt + 1} failed: ${msg}`)
        if (attempt < retry.maxRetries) {
          await new Promise((r) => setTimeout(r, retry.backoffMs * Math.pow(2, attempt)))
        } else {
          await this.missions.updateStep(missionId, step.id, { status: 'failed', output: { error: msg } })
        }
      }
    }
  }

  private async runStepLogic(step: Step, missionId: string, projectId: string, objective: string, specialistId: string | null, allSteps: Step[]): Promise<Record<string, unknown>> {
    // Build context from previous steps' outputs
    const prevOutputs = step.dependsOn
      .map((id) => allSteps.find((s) => s.id === id))
      .filter(Boolean)
      .map((s) => `[${s!.title}]: ${JSON.stringify(s!.input).slice(0, 200)}`)
      .join('\n')

    if (step.executor === 'skill' && step.skillId) {
      const result = await this.skillEngine.run({
        skillId:   step.skillId,
        input:     step.input,
        projectId,
        missionId,
        stepId:    step.id,
      })
      if (!result.success) {
        if (result.output['status'] === 'pending_approval') throw new StepInterruptedError(result.output)
        throw new Error(result.output['error'] as string ?? 'Skill failed')
      }
      return result.output
    }

    // AI step → spawn a Specialist for richer execution
    const clarificationAnswer = step.input?.['clarificationAnswer'] as string | undefined

    const baseTask = step.prompt
      ? step.prompt
      : `Mission: ${objective}\nStep: ${step.title}\n${prevOutputs ? `\nContext:\n${prevOutputs}` : ''}`

    // Pede esclarecimento se a tarefa for ambígua e ainda não houver resposta prévia.
    // Skip se clarificationAnswer já existe para evitar loop infinito.
    if (!clarificationAnswer) {
      const clarif = await this.clarification.checkTask(baseTask, prevOutputs)
      if (clarif.needsClarification) {
        const gate = await this.gates.createClarificationGate({
          projectId, missionId, stepId: step.id,
          question:    clarif.question,
          taskSummary: baseTask.slice(0, 300),
        })
        throw new StepInterruptedError({ gateId: gate.id, question: clarif.question, status: 'clarification_pending' })
      }
    }

    // Appenda a resposta de clarification à task para que o specialist a veja
    const task = clarificationAnswer
      ? `${baseTask}\n\nClarificação do usuário: ${clarificationAnswer}`
      : baseTask

    // Respeita o specialist escolhido pelo dispatcher da missão — sem isso o tipo
    // era sempre inferido por texto, podendo escolher "reviewer" pra um step de edição.
    let type: SpecialistType | undefined
    if (specialistId) {
      const agent = await this.specialistAgents.findById(specialistId)
      if (agent) type = agent.domain as SpecialistType
    }

    const instance = await this.specialists.spawn({
      type,
      task,
      missionId,
      stepId:    step.id,
      projectId,
      context:   prevOutputs || undefined,
    })

    // Wait for specialist to complete (max 60s)
    let waited = 0
    while (instance.status === 'running' && waited < 60000) {
      await new Promise((r) => setTimeout(r, 2000))
      waited += 2000
      const fresh = this.specialists.getStatus(instance.id)
      if (fresh) Object.assign(instance, fresh)
    }

    if (instance.status === 'interrupted') throw new StepInterruptedError((instance.output ?? {}) as Record<string, unknown>)
    if (instance.status === 'failed') throw new Error('Specialist failed')
    return instance.output ?? { response: 'No output', specialist: instance.type }
  }

  getTemplates() {
    return Object.entries(WORKFLOW_TEMPLATES).map(([type, steps]) => ({ type, steps }))
  }

  // Apply a template to a mission — creates steps from template
  async applyTemplate(missionId: string, templateType: string) {
    const template = WORKFLOW_TEMPLATES[templateType]
    if (!template) throw new Error(`Template '${templateType}' not found`)

    const mission = await this.missions.findOne(missionId)
    const idMap   = new Map<string, string>()

    for (const tStep of template) {
      const created = await this.missions.addStep(missionId, {
        title:     tStep.title,
        executor:  tStep.executor,
        skillId:   tStep.skillId,
        input:     {},
        dependsOn: [], // set after all steps are created
      })
      idMap.set(tStep.key, created.id)
    }

    // Now patch dependsOn with real IDs (updateStep agora suporta dependsOn)
    for (const tStep of template) {
      const realId   = idMap.get(tStep.key)!
      const realDeps = tStep.dependsOn.map((k) => idMap.get(k)!).filter(Boolean)
      if (realDeps.length > 0) {
        await this.missions.updateStep(missionId, realId, { dependsOn: realDeps })
      }
    }

    void mission
    return { missionId, templateType, stepsCreated: template.length, stepIds: [...idMap.values()] }
  }
}
