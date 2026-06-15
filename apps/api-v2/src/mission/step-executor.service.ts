import { Injectable, Logger } from '@nestjs/common'
import { MissionService } from './mission.service'
import { SpecialistService } from '../specialists/specialist.service'
import { SpecialistAgentService } from '../specialist-agent/specialist-agent.service'
import { SpecialistType } from '../specialists/specialist-registry'

@Injectable()
export class StepExecutorService {
  private readonly logger = new Logger(StepExecutorService.name)

  constructor(
    private readonly missions:    MissionService,
    private readonly specialists: SpecialistService,
    private readonly agents:      SpecialistAgentService,
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

    // Mark step as running
    await this.missions.updateStep(missionId, stepId, { status: 'running' })

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
    return { status: finalStatus, output: inst.output }
  }

  /**
   * Fire-and-forget: runs the first pending step of a mission.
   * Safe to call on mission activation — returns immediately.
   */
  runNext(missionId: string): void {
    this.missions.findOne(missionId).then((mission) => {
      const next = mission.steps.find((s) => s.status === 'pending')
      if (!next) return
      this.run(missionId, next.id).catch((e) =>
        this.logger.warn(`Auto-step execution failed for mission ${missionId}: ${e}`),
      )
    }).catch(() => null)
  }
}
