import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { AiRouterService } from '../ai-router/ai-router.service'
import { ContextEngineService } from '../context-engine/context-engine.service'
import { CostControllerService } from '../cost-controller/cost-controller.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SkillEngineService } from '../skill-engine/skill-engine.service'
import { SpecialistRegistry, SpecialistType, buildToolsForSkills } from './specialist-registry'

export interface SpawnRequest {
  type?:      SpecialistType   // inferred if omitted
  task:       string           // what the specialist must accomplish
  missionId:  string
  stepId:     string
  projectId:  string
  context?:   string           // additional context to inject
}

export interface SpecialistInstance {
  id:         string
  type:       SpecialistType
  missionId:  string
  stepId:     string
  status:     'running' | 'done' | 'failed' | 'interrupted'
  iterations: number
  costUsd:    number
  output?:    Record<string, unknown>
  startedAt:  Date
  endedAt?:   Date
}

@Injectable()
export class SpecialistService {
  private readonly logger   = new Logger(SpecialistService.name)
  private readonly registry = new SpecialistRegistry()

  // In-memory instance tracking — destroyed on completion
  private readonly instances = new Map<string, SpecialistInstance>()
  private readonly interrupted = new Set<string>()

  constructor(
    private readonly aiRouter:    AiRouterService,
    private readonly ctxEngine:   ContextEngineService,
    private readonly costs:       CostControllerService,
    private readonly gates:       ApprovalGatesService,
    private readonly skillEngine: SkillEngineService,
  ) {}

  async spawn(req: SpawnRequest): Promise<SpecialistInstance> {
    const type = req.type ?? this.registry.infer(req.task)
    const def  = this.registry.get(type)
    const id   = randomUUID()

    // Approval gate for high-risk specialists
    if (def.requiresApproval) {
      const { required, gate } = await this.gates.checkAndCreate(
        'high',
        req.projectId,
        req.missionId,
        req.stepId,
        `Specialist ${def.name} requires approval`,
        { type, task: req.task },
      )
      if (required && gate?.status === 'pending') {
        const pending: SpecialistInstance = {
          id, type, missionId: req.missionId, stepId: req.stepId,
          status: 'failed', iterations: 0, costUsd: 0,
          output: { gateId: gate?.id, message: 'Awaiting approval' },
          startedAt: new Date(), endedAt: new Date(),
        }
        return pending
      }
    }

    const instance: SpecialistInstance = {
      id, type, missionId: req.missionId, stepId: req.stepId,
      status: 'running', iterations: 0, costUsd: 0,
      startedAt: new Date(),
    }
    this.instances.set(id, instance)

    // Run async — don't await
    this.runLoop(id, req, def).catch((e) => {
      this.logger.error(`Specialist ${id} loop failed: ${e}`)
      const inst = this.instances.get(id)
      if (inst) { inst.status = 'failed'; inst.endedAt = new Date() }
    })

    return instance
  }

  private async runLoop(
    id: string,
    req: SpawnRequest,
    def: ReturnType<SpecialistRegistry['get']>,
  ): Promise<void> {
    const inst = this.instances.get(id)!

    // Build isolated context for this specialist
    let contextText = ''
    try {
      const ctx = await this.ctxEngine.build({
        projectId: req.projectId,
        taskType:  def.type === 'debugger' ? 'analyze' : 'implement',
        query:     req.task,
      })
      contextText = ctx.text
    } catch { /* context is optional */ }

    const messages: Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }> = [
      { role: 'system', content: `${def.systemPrompt}\n\n${contextText ? `Project context:\n${contextText}` : ''}` },
      { role: 'user',   content: req.task },
    ]

    if (req.context) {
      messages.push({ role: 'user', content: `Additional context:\n${req.context}` })
    }

    // Tools reais — só as skills que o specialist tem permissão de usar (allowedSkills).
    // Sem isso, executor "ai" nunca toca o filesystem real (era o bug original).
    const tools = buildToolsForSkills(def.allowedSkills)
    const actionsExecuted: Array<{ skillId: string; success: boolean }> = []

    let totalCost = 0

    for (let i = 0; i < def.maxIterations; i++) {
      if (this.interrupted.has(id)) {
        inst.status = 'interrupted'
        inst.endedAt = new Date()
        this.interrupted.delete(id)
        this.logger.log(`Specialist ${id} interrupted at iteration ${i}`)
        return
      }

      // Check cost budget
      if (totalCost >= def.maxCostUsd) {
        this.logger.warn(`Specialist ${id} hit cost limit $${def.maxCostUsd}`)
        break
      }

      const canSpend = await this.costs.canSpend(req.projectId, 0.10)
      if (!canSpend.allowed) {
        this.logger.warn(`Specialist ${id} blocked by cost controller: ${canSpend.reason}`)
        break
      }

      try {
        const result = await this.aiRouter.complete({
          messages,
          tools:        tools.length ? tools : undefined,
          taskType:     def.type === 'architect' ? 'strategic' : 'implement',
          projectId:    req.projectId,
          maxTokens:    2000,
        })

        totalCost += result.costUsd
        inst.iterations++
        inst.costUsd = totalCost

        // Record cost
        void this.costs.record({
          projectId: req.projectId,
          missionId: req.missionId,
          stepId:    req.stepId,
          model:     result.modelUsed,
          tokensIn:  result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd:   result.costUsd,
          module:    `specialist:${def.type}`,
        }).catch(() => null)

        if (result.toolCalls?.length) {
          // Specialist pediu pra executar ações reais — despacha via SkillEngine
          // (que já reaproveita o approval-gate de risco medium/high) e devolve o
          // resultado real pra LLM decidir o próximo passo, em vez de só narrar.
          messages.push({
            role: 'assistant',
            content: result.content,
            tool_calls: result.toolCalls.map((tc) => ({
              id: tc.id, type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          })

          for (const tc of result.toolCalls) {
            try {
              const skillResult = await this.skillEngine.run({
                skillId:   tc.name,
                input:     tc.arguments,
                projectId: req.projectId,
                missionId: req.missionId,
                stepId:    req.stepId,
              })
              actionsExecuted.push({ skillId: tc.name, success: skillResult.success })
              messages.push({
                role: 'tool', tool_call_id: tc.id,
                content: JSON.stringify(skillResult.output).slice(0, 2000),
              })
            } catch (e) {
              actionsExecuted.push({ skillId: tc.name, success: false })
              messages.push({
                role: 'tool', tool_call_id: tc.id,
                content: `Error: ${e instanceof Error ? e.message : String(e)}`,
              })
            }
          }
          // Sempre continua o loop após executar tool calls — a conclusão real
          // só conta quando o specialist responde SEM pedir mais ações.
          continue
        }

        messages.push({ role: 'assistant', content: result.content })

        // Check if specialist signals completion
        const isDone = /DONE|COMPLETE|FINISHED|APPROVED|REVIEWED/i.test(result.content) ||
                       result.content.includes('## Summary') ||
                       i === def.maxIterations - 1

        if (isDone) {
          inst.status = 'done'
          inst.output = {
            result:      result.content,
            iterations:  inst.iterations,
            costUsd:     totalCost,
            type:        def.type,
            ...(actionsExecuted.length ? { actionsExecuted } : {}),
          }
          inst.endedAt = new Date()
          this.logger.log(`Specialist ${def.type} ${id} done in ${inst.iterations} iterations, $${totalCost.toFixed(4)}, ${actionsExecuted.length} ações reais`)
          return
        }

        // Continue loop — ask specialist to continue
        messages.push({ role: 'user', content: 'Continue. What is the next step?' })

      } catch (e) {
        this.logger.warn(`Specialist ${id} iteration ${i} error: ${e}`)
        break
      }
    }

    // Exhausted iterations without explicit done
    inst.status = inst.iterations > 0 ? 'done' : 'failed'
    inst.output = {
      result:     messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n\n'),
      iterations: inst.iterations,
      costUsd:    totalCost,
      ...(actionsExecuted.length ? { actionsExecuted } : {}),
    }
    inst.endedAt = new Date()
  }

  inferType(text: string) {
    return this.registry.infer(text)
  }

  /** Blocking version of spawn — awaits the full loop and returns the final instance. */
  async spawnAndWait(req: SpawnRequest): Promise<SpecialistInstance> {
    const type = req.type ?? this.registry.infer(req.task)
    const def  = this.registry.get(type)
    const id   = randomUUID()

    if (def.requiresApproval) {
      const { required, gate } = await this.gates.checkAndCreate(
        'high', req.projectId, req.missionId, req.stepId,
        `Specialist ${def.name} requires approval`, { type, task: req.task },
      )
      if (required && gate?.status === 'pending') {
        return { id, type, missionId: req.missionId, stepId: req.stepId,
          status: 'interrupted', iterations: 0, costUsd: 0,
          output: { gateId: gate?.id, message: 'Awaiting approval' },
          startedAt: new Date(), endedAt: new Date() }
      }
    }

    const instance: SpecialistInstance = {
      id, type, missionId: req.missionId, stepId: req.stepId,
      status: 'running', iterations: 0, costUsd: 0, startedAt: new Date(),
    }
    this.instances.set(id, instance)
    await this.runLoop(id, req, def)
    return this.instances.get(id) ?? instance
  }

  getStatus(id: string): SpecialistInstance | null {
    return this.instances.get(id) ?? null
  }

  interrupt(id: string) {
    this.interrupted.add(id)
    return { id, message: 'Interrupt signal sent' }
  }

  getTypes() {
    return this.registry.list().map(({ type, name, maxIterations, maxCostUsd, model, requiresApproval }) => ({
      type, name, maxIterations, maxCostUsd, model, requiresApproval,
    }))
  }

  listActive() {
    return [...this.instances.values()].filter((i) => i.status === 'running')
  }
}
