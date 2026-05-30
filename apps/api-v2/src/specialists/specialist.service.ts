import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { AiRouterService } from '../ai-router/ai-router.service'
import { ContextEngineService } from '../context-engine/context-engine.service'
import { CostControllerService } from '../cost-controller/cost-controller.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SpecialistRegistry, SpecialistType } from './specialist-registry'

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

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: `${def.systemPrompt}\n\n${contextText ? `Project context:\n${contextText}` : ''}` },
      { role: 'user',   content: req.task },
    ]

    if (req.context) {
      messages.push({ role: 'user', content: `Additional context:\n${req.context}` })
    }

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
          prompt:       messages[messages.length - 1].content,
          systemPrompt: messages[0].content,
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
          }
          inst.endedAt = new Date()
          this.logger.log(`Specialist ${def.type} ${id} done in ${inst.iterations} iterations, $${totalCost.toFixed(4)}`)
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
    }
    inst.endedAt = new Date()
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
