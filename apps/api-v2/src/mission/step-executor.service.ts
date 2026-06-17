import { Injectable, Logger, Optional } from '@nestjs/common'
import { MissionService } from './mission.service'
import { SpecialistService } from '../specialists/specialist.service'
import { SpecialistAgentService } from '../specialist-agent/specialist-agent.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { EventsService } from '../gateway/events.service'
import { SpecialistType } from '../specialists/specialist-registry'

@Injectable()
export class StepExecutorService {
  private readonly logger = new Logger(StepExecutorService.name)

  constructor(
    private readonly missions:    MissionService,
    private readonly specialists: SpecialistService,
    private readonly agents:      SpecialistAgentService,
    private readonly gates:       ApprovalGatesService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * Executes a single step using the appropriate Specialist.
   * Marks the step as running, spawns the Specialist, writes back the result.
   * Returns the updated step output.
   */
  async run(missionId: string, stepId: string): Promise<{ status: string; output: unknown }> {
    const mission = await this.missions.findOne(missionId)
    const step = mission.steps.find((s) => s.id === stepId)

    if (!step) throw new Error(`Step ${stepId} not found in mission ${missionId}`)
    if (step.status === 'done' || step.status === 'running') {
      return { status: step.status, output: step.output }
    }

    // Gate check — se há um ApprovalGate pendente para este step, pausa a missão
    // em vez de executar. A retomada acontece em ApprovalGatesController.approve().
    const pendingGate = (await this.gates.findPending(undefined, missionId)).find((g) => g.stepId === stepId)
    if (pendingGate) {
      if (mission.status === 'active') {
        await this.missions.transition(missionId, 'paused').catch(() => null)
      }
      this.emitUpdate(missionId)
      this.logger.log(`Step "${step.title}" bloqueado pelo gate ${pendingGate.id} — missão pausada aguardando aprovação`)
      return { status: 'blocked', output: { gateId: pendingGate.id, reason: 'awaiting_approval' } }
    }

    // Resolve specialist type — prefer mission-level agent, fall back to step inference
    let specialistType: SpecialistType | undefined
    if (mission.specialistId) {
      const agent = await this.agents.findById(mission.specialistId)
      if (agent) specialistType = agent.domain as SpecialistType
    }
    if (!specialistType) {
      specialistType = this.specialists.inferType(`${step.title} ${step.prompt ?? ''}`)
    }

    this.logger.log(`Running step "${step.title}" with specialist: ${specialistType}`)

    // Mark step as running + push live update
    await this.missions.updateStep(missionId, stepId, { status: 'running' })
    this.emitUpdate(missionId)

    // Spawn specialist and await completion
    const inst = await this.specialists.spawnAndWait({
      type:       specialistType,
      task:       step.prompt ?? step.title,
      missionId,
      stepId,
      projectId:  mission.projectId,
      context:    `Mission: ${mission.title}\nObjective: ${mission.objective}`,
    })

    const finalStatus = inst.status === 'done' ? 'done'
      : inst.status === 'interrupted'           ? 'skipped'
      : 'failed'

    // Write back result to step
    await this.missions.updateStep(missionId, stepId, {
      status: finalStatus,
      output: (inst.output ?? {}) as Record<string, unknown>,
    })

    this.logger.log(`Step "${step.title}" finished: ${finalStatus} (${inst.iterations} iterations, $${inst.costUsd.toFixed(4)})`)

    // Push live update to WebSocket clients
    this.emitUpdate(missionId)

    // Auto-chain: advance to next pending step if this one succeeded
    if (finalStatus === 'done') {
      this.runNext(missionId)
    }

    return { status: finalStatus, output: inst.output }
  }

  /**
   * Fire-and-forget: runs the first pending step of a mission.
   * Safe to call on mission activation — returns immediately.
   */
  runNext(missionId: string): void {
    this.missions.findOne(missionId).then((mission) => {
      const next = mission.steps.find((s) => s.status === 'pending')
      if (!next) {
        // All steps done — emit final mission state
        this.emitUpdate(missionId)
        return
      }
      this.run(missionId, next.id).catch((e) =>
        this.logger.warn(`Auto-step execution failed for mission ${missionId}: ${e}`),
      )
    }).catch(() => null)
  }

  private emitUpdate(missionId: string): void {
    if (!this.events) return
    this.missions.findOne(missionId).then((mission) => {
      this.events!.missionUpdate(mission.projectId, {
        id:     mission.id,
        title:  mission.title,
        status: mission.status,
        steps:  mission.steps,
      })
    }).catch(() => null)
  }
}
