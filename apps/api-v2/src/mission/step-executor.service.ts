import { Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common'
import { MissionService } from './mission.service'
import { MissionResultService } from './mission-result.service'
import { SpecialistService } from '../specialists/specialist.service'
import { SpecialistAgentService } from '../specialist-agent/specialist-agent.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { EventsService } from '../gateway/events.service'
import { SpecialistType } from '../specialists/specialist-registry'

@Injectable()
export class StepExecutorService implements OnModuleInit {
  private readonly logger = new Logger(StepExecutorService.name)

  constructor(
    private readonly missions:    MissionService,
    private readonly specialists: SpecialistService,
    private readonly agents:      SpecialistAgentService,
    private readonly gates:       ApprovalGatesService,
    private readonly result:      MissionResultService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * SpecialistService guarda instâncias só em memória (Map). Se o processo api-v2
   * reinicia com um step em 'running', a instância morre mas a linha no Postgres
   * fica 'running' pra sempre — nenhum processo vivo algum dia a completa. Reconcilia
   * no boot marcando esses steps órfãos como 'failed' para liberar retry manual.
   */
  async onModuleInit() {
    const orphaned = await this.missions.findRunningSteps()
    for (const step of orphaned) {
      await this.missions.updateStep(step.missionId, step.id, {
        status: 'failed',
        output: { error: 'Specialist instance perdida em restart do api-v2' },
      }).catch((e) => this.logger.warn(`Falha ao reconciliar step órfão ${step.id}: ${e}`))
    }
    if (orphaned.length > 0) {
      this.logger.warn(`Reconciliados ${orphaned.length} step(s) órfão(s) em 'running' de uma instância anterior`)
    }
  }

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

    // Step de ação humana — nenhum dos dois engines de execução tratava isso antes,
    // então um specialist de IA "verificava" o que deveria ser conferido por uma pessoa.
    // Pausa a missão e deixa o step pending; humano resolve via PATCH .../steps/:stepId.
    if (step.executor === 'human') {
      if (mission.status === 'active') {
        await this.missions.transition(missionId, 'paused').catch(() => null)
      }
      this.emitUpdate(missionId)
      this.logger.log(`Step "${step.title}" requer ação humana — missão pausada`)
      return { status: 'blocked', output: { reason: 'awaiting_human' } }
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
    this.missions.findOne(missionId).then(async (mission) => {
      const next = mission.steps.find((s) => s.status === 'pending')
      if (!next) {
        // Sem step pendente: ou a missão terminou, ou está bloqueada num gate.
        // Diferente do WorkflowEngineService.execute() (caminho do gate→resume), este
        // executor não fazia essa transição — missão ficava presa em 'active' pra sempre
        // mesmo com todos os steps concluídos.
        if (mission.status === 'active') {
          const hasFailed = mission.steps.some((s) => s.status === 'failed')
          const allTerminal = mission.steps.every((s) => s.status === 'done' || s.status === 'failed' || s.status === 'skipped')
          if (allTerminal) {
            await this.missions.transition(missionId, hasFailed ? 'failed' : 'done').catch((e) =>
              this.logger.warn(`Falha ao finalizar missão ${missionId}: ${e}`),
            )
            // Síntese (resumo + próxima ação sugerida) — mesma lógica do POST /complete manual,
            // pra missão auto-encadeada não ficar sem essa etapa só porque ninguém clicou "complete".
            this.result.processCompletion(missionId).catch((e) =>
              this.logger.warn(`Falha ao sintetizar resultado da missão ${missionId}: ${e}`),
            )
          }
        }
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
