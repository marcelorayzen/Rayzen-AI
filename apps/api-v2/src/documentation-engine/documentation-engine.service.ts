import { Injectable, Logger } from '@nestjs/common'
import { V1ApiService } from '../core/v1-api.service'
import { AiRouterService } from '../ai-router/ai-router.service'
import { MissionService } from '../mission/mission.service'
import { MemoryService } from '../memory/memory.service'

export type DocType =
  | 'project_state' | 'decisions_log' | 'next_actions'
  | 'work_journal'  | 'data_map'       | 'architecture'
  | 'mission_report'

// Docs generated per mission type
const MISSION_DOC_MAP: Record<string, DocType[]> = {
  implementation: ['work_journal', 'decisions_log', 'mission_report'],
  architecture:   ['architecture',  'decisions_log', 'mission_report'],
  debugging:      ['work_journal',  'mission_report'],
  review:         ['decisions_log', 'next_actions'],
  research:       ['decisions_log'],
  default:        ['mission_report'],
}

@Injectable()
export class DocumentationEngineService {
  private readonly logger = new Logger(DocumentationEngineService.name)

  constructor(
    private readonly v1Api:    V1ApiService,
    private readonly aiRouter: AiRouterService,
    private readonly missions: MissionService,
    private readonly memory:   MemoryService,
  ) {}

  // Trigger docs generation when a mission completes
  async onMissionCompleted(missionId: string, projectId: string): Promise<DocType[]> {
    const mission  = await this.missions.findOne(missionId)
    const docTypes = MISSION_DOC_MAP[mission.status] ?? MISSION_DOC_MAP.default

    this.logger.log(`Mission ${missionId} completed — generating docs: ${docTypes.join(', ')}`)
    await this.generate(missionId, projectId, docTypes)
    return docTypes
  }

  async generate(missionId: string, projectId: string, types?: DocType[]): Promise<Array<{ type: DocType; content: string }>> {
    const mission    = await this.missions.findOne(missionId)
    const docTypes   = types ?? MISSION_DOC_MAP.default
    const results: Array<{ type: DocType; content: string }> = []

    // Build context for doc generation
    const stepsText = (mission.steps as Array<{ title: string; status: string; output?: unknown }>)
      .filter((s) => s.status === 'done')
      .map((s) => `- ${s.title}: ${JSON.stringify(s.output ?? {}).slice(0, 200)}`)
      .join('\n')

    for (const docType of docTypes) {
      try {
        const content = await this.generateDoc(docType, mission, stepsText, projectId)
        results.push({ type: docType, content })

        // Index in Memory as consolidated knowledge
        await this.memory.store({
          projectId,
          content:    `[${docType}]\n${content}`,
          sourcePath: `mission/${missionId}/${docType}`,
          sourceType: 'ai_generated',
          memoryClass: 'consolidated',
        }).catch(() => null)

        // Sync to V1 via documentation endpoint
        await this.syncToV1(projectId, docType, content)
      } catch (e) {
        this.logger.warn(`Failed to generate ${docType}: ${e}`)
      }
    }

    return results
  }

  async listDocs(projectId: string) {
    return this.v1Api.getProjectDocs(projectId)
  }

  private async generateDoc(
    type: DocType,
    mission: { title: string; objective: string; steps: unknown },
    stepsText: string,
    projectId: string,
  ): Promise<string> {
    const prompts: Record<DocType, string> = {
      mission_report: `Write a mission completion report for:\nMission: ${mission.title}\nObjective: ${mission.objective}\n\nCompleted steps:\n${stepsText || 'No steps recorded.'}\n\nInclude: summary, decisions made, outcomes, lessons learned.`,
      work_journal:   `Write a work journal entry for this mission:\nMission: ${mission.title}\nSteps: ${stepsText || 'No steps.'}\n\nFormat as a development diary entry.`,
      decisions_log:  `Extract and document decisions made during this mission:\nMission: ${mission.title}\nSteps: ${stepsText || 'No steps.'}\n\nList each decision with rationale.`,
      next_actions:   `Based on this mission:\nMission: ${mission.title}\nObjective: ${mission.objective}\n\nList 3-5 concrete next actions to continue progress.`,
      architecture:   `Document the architecture decisions from this mission:\nMission: ${mission.title}\nSteps: ${stepsText || 'No steps.'}\n\nInclude: components, patterns, trade-offs.`,
      project_state:  `Summarize the current project state after this mission:\nMission: ${mission.title}\nObjective: ${mission.objective}\n\nInclude: current stage, progress, blockers.`,
      data_map:       `Document data flows and entities involved in this mission:\nMission: ${mission.title}\nSteps: ${stepsText || 'No steps.'}\n\nList entities, relationships, and data transformations.`,
    }

    const result = await this.aiRouter.complete({
      prompt:    prompts[type],
      taskType:  'generate_code',
      projectId,
      maxTokens: 1500,
    })

    return result.content
  }

  private async syncToV1(projectId: string, type: DocType, content: string): Promise<void> {
    try {
      const baseUrl = process.env.V1_API_URL ?? 'http://api:3001'
      const token   = process.env.V1_API_TOKEN ?? ''
      await fetch(`${baseUrl}/documentation/generate/${projectId}/${type}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ content }),
      })
    } catch { /* fire-and-forget */ }
  }
}
