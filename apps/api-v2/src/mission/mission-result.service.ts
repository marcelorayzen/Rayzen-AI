import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'
import { MemoryService } from '../memory/memory.service'
import { V1ApiService } from '../core/v1-api.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { MissionService } from './mission.service'

const RESULT_SYSTEM = `You are an engineering assistant summarizing a completed mission.
Given the mission title, objective and step results, produce a concise summary and suggest the next best action.

Respond with JSON only:
{
  "summary": "2-3 sentences summarizing what was accomplished and key outcomes",
  "nextAction": "one concrete next step the team should take, grounded in what was just done"
}`

@Injectable()
export class MissionResultService {
  private readonly logger = new Logger(MissionResultService.name)

  constructor(
    private readonly missions:  MissionService,
    private readonly llm:       LlmService,
    private readonly memory:    MemoryService,
    private readonly v1Api:     V1ApiService,
    private readonly v1Bridge:  V1BridgeService,
  ) {}

  async processCompletion(missionId: string): Promise<{
    summary:          string
    nextAction:       string
    documentId:       string | null
    plannedNextSteps: string[]
  }> {
    const mission = await this.missions.findOne(missionId)

    // Aggregate step outputs for LLM context
    const stepLines = mission.steps.map((s) => {
      const out = s.output ? ` → ${JSON.stringify(s.output).slice(0, 200)}` : ''
      return `- [${s.status}] ${s.title}${out}`
    })

    let summary    = `Mission "${mission.title}" completed.`
    let nextAction = 'Review the mission output and plan the next milestone.'

    try {
      const res = await this.llm.chat([
        { role: 'system', content: RESULT_SYSTEM },
        {
          role: 'user',
          content:
            `Mission: ${mission.title}\n` +
            `Objective: ${mission.objective}\n\n` +
            `Steps:\n${stepLines.join('\n')}`,
        },
      ], { model: 'gpt-4o-mini', temperature: 0.3 })

      const parsed = this.llm.extractJson(res.content) as { summary?: string; nextAction?: string }
      if (parsed.summary)    summary    = parsed.summary
      if (parsed.nextAction) nextAction = parsed.nextAction
    } catch (e) {
      this.logger.warn(`result LLM failed: ${e}`)
    }

    // Persist result in Brain
    let documentId: string | null = null
    try {
      const doc = await this.memory.store({
        projectId:   mission.projectId,
        content:     this.formatResultDoc(mission, stepLines, summary, nextAction),
        sourcePath:  `mission-result/${missionId}`,
        sourceType:  'ai_generated',
        memoryClass: 'working',
      })
      documentId = doc.documentId
    } catch (e) {
      this.logger.warn(`result indexing failed: ${e}`)
    }

    // Cross-reference with ProjectState.nextSteps — prefer planned steps over LLM suggestion
    let plannedNextSteps: string[] = []
    try {
      const state = await this.v1Bridge.getProjectState(mission.projectId)
      const raw = Array.isArray(state?.nextSteps) ? state.nextSteps : []
      plannedNextSteps = raw
        .map((n) => (typeof n === 'string' ? n : (n as Record<string, unknown>).title ?? String(n)))
        .filter(Boolean) as string[]
      // If there are planned next steps, surface the first as nextAction (grounded in reality)
      if (plannedNextSteps.length > 0) {
        nextAction = plannedNextSteps[0]
      }
    } catch (e) {
      this.logger.warn(`ProjectState fetch failed: ${e}`)
    }

    // Register decision event in V1 timeline
    void this.v1Api.addEvent(
      mission.projectId,
      `Missão concluída: "${mission.title}". ${summary} Próximo: ${nextAction}`,
      'decision',
    )

    this.logger.log(`Mission ${missionId} result loop: summary stored, next="${nextAction}"`)
    return { summary, nextAction, documentId, plannedNextSteps }
  }

  private formatResultDoc(
    mission: { id: string; title: string; objective: string; completedAt: Date | null },
    stepLines: string[],
    summary: string,
    nextAction: string,
  ): string {
    return [
      `# Resultado da Missão: ${mission.title}`,
      `Data de conclusão: ${mission.completedAt?.toISOString() ?? new Date().toISOString()}`,
      `ID: ${mission.id}`,
      '',
      '## Objetivo',
      mission.objective,
      '',
      '## Steps executados',
      stepLines.join('\n'),
      '',
      '## Síntese',
      summary,
      '',
      '## Próximo passo sugerido',
      nextAction,
    ].join('\n')
  }
}
