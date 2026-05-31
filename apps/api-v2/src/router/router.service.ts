import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'
import { MissionService } from '../mission/mission.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { ContextEngineService, WorkMode } from '../context-engine/context-engine.service'
import { RouteRequestDto, RouteDecision, DecisionType } from './dto/route-request.dto'

const CLASSIFY_SYSTEM = `You are a routing classifier for an AI engineering system.
Given a user message and project context, classify the intent as one of:
- mission: complex multi-step task that requires planning and execution (build, implement, create, analyze, migrate, refactor, deploy)
- skill: direct action that maps to a specific tool (git, docker, screenshot, test, search)
- ai: simple question, explanation or short generation (what is, explain, summarize, write a snippet)
- clarification: ambiguous request that needs more information

Respond with JSON only:
{
  "type": "mission|skill|ai|clarification",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "suggestedTitle": "short title if mission",
  "suggestedSkill": "skill key if skill"
}`

const PLAN_SYSTEM = `You are a senior software engineer planning a mission.
Given an objective and project context, generate 3-7 concrete steps to achieve it.
Each step should be actionable and specific.

Respond with JSON only:
{
  "steps": [
    {
      "title": "short step title",
      "prompt": "detailed instructions for this step",
      "executor": "ai|skill|human",
      "skillId": "optional skill key if executor=skill"
    }
  ]
}`

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name)

  constructor(
    private readonly llm: LlmService,
    private readonly missions: MissionService,
    private readonly v1Bridge: V1BridgeService,
    private readonly ctxEngine: ContextEngineService,
  ) {}

  /**
   * Context Broker: builds the compressed project context and injects it into
   * the LLM prompt instead of forcing the user to re-explain the project.
   * Returns empty string on failure — context is an enhancement, never a hard dependency.
   */
  private async brokerContext(projectId: string, query: string, mode: WorkMode): Promise<string> {
    try {
      const ctx = await this.ctxEngine.build({ projectId, query, mode })
      return ctx.text
    } catch (e) {
      this.logger.warn(`broker context failed: ${e}`)
      return ''
    }
  }

  async route(dto: RouteRequestDto): Promise<RouteDecision & { result?: unknown }> {
    const mode = dto.mode ?? 'auto'

    // Forced mode skips classification
    if (mode !== 'auto') {
      const type = mode === 'chat' ? 'ai' : (mode as DecisionType)
      return this.dispatch({ type, confidence: 1, reasoning: 'forced mode', target: '', payload: {} }, dto)
    }

    const decision = await this.classify(dto)
    return this.dispatch(decision, dto)
  }

  private async classify(dto: RouteRequestDto): Promise<RouteDecision> {
    // Fetch minimal project context for classification
    let projectCtx = ''
    try {
      const state = await this.v1Bridge.getProjectState(dto.projectId)
      if (state) projectCtx = `Project stage: ${state.stage ?? 'unknown'}. Blockers: ${JSON.stringify(state.blockers ?? [])}`
    } catch { /* ignore — classification still works without context */ }

    const result = await this.llm.chat([
      { role: 'system', content: CLASSIFY_SYSTEM },
      { role: 'user', content: `Message: "${dto.content}"\n\nProject context: ${projectCtx || 'none'}` },
    ], { model: 'gpt-4o-mini', temperature: 0 })

    try {
      const parsed = this.llm.extractJson(result.content) as {
        type: DecisionType
        confidence: number
        reasoning: string
        suggestedTitle?: string
        suggestedSkill?: string
      }

      return {
        type:       parsed.type,
        confidence: parsed.confidence,
        reasoning:  parsed.reasoning,
        target:     parsed.suggestedSkill ?? '',
        payload:    { suggestedTitle: parsed.suggestedTitle },
      }
    } catch (e) {
      this.logger.warn(`classify parse error: ${e}`)
      return { type: 'ai', confidence: 0.5, reasoning: 'parse fallback', target: 'chat', payload: {} }
    }
  }

  private async dispatch(
    decision: RouteDecision,
    dto: RouteRequestDto,
  ): Promise<RouteDecision & { result?: unknown }> {
    switch (decision.type) {
      case 'mission':
        return this.createMission(decision, dto)
      case 'ai':
        return this.chat(decision, dto)
      case 'clarification':
        return { ...decision, target: 'user', payload: { question: 'Could you provide more details?' } }
      default:
        // skill — placeholder until SkillEngine is built (Fase 2)
        return { ...decision, payload: { note: 'Skill Engine not yet implemented (Fase 2)' } }
    }
  }

  private async createMission(
    decision: RouteDecision,
    dto: RouteRequestDto,
  ): Promise<RouteDecision & { result?: unknown }> {
    const title = (decision.payload.suggestedTitle as string) || dto.content.slice(0, 80)

    // Context Broker: ground the planner in the real project state, goal, planning and blockers
    const brokerCtx = await this.brokerContext(dto.projectId, dto.content, 'architecture')

    // Plan steps via LLM
    let steps: Array<{ title: string; prompt: string; executor: string; skillId?: string }> = []
    let planRaw = ''
    try {
      const planResult = await this.llm.chat([
        { role: 'system', content: PLAN_SYSTEM },
        {
          role: 'user',
          content: `Objective: "${dto.content}"\n\nProject ID: ${dto.projectId}` +
            (brokerCtx
              ? `\n\nProject context (ground the plan in this; respect active blockers and current stage):\n${brokerCtx}`
              : ''),
        },
      ], { model: 'gpt-4o', temperature: 0.2 })
      planRaw = planResult.content

      const parsed = this.llm.extractJson(planRaw) as { steps: typeof steps }
      steps = parsed.steps ?? []
    } catch (e) {
      this.logger.warn(`plan parse error: ${e} | raw: ${planRaw.slice(0, 300)}`)
    }

    // Create Mission
    const mission = await this.missions.create({
      projectId: dto.projectId,
      title,
      objective: dto.content,
      context:   dto.context,
    })

    // Add steps
    for (const step of steps) {
      await this.missions.addStep(mission.id, {
        title:    step.title,
        prompt:   step.prompt,
        executor: step.executor ?? 'ai',
        skillId:  step.skillId,
        input:    {},
        dependsOn: [],
      })
    }

    const missionWithSteps = await this.missions.findOne(mission.id)

    return {
      ...decision,
      target:  mission.id,
      payload: { missionId: mission.id, stepsCount: steps.length, contextChars: brokerCtx.length },
      result:  missionWithSteps,
    }
  }

  private async chat(
    decision: RouteDecision,
    dto: RouteRequestDto,
  ): Promise<RouteDecision & { result?: unknown }> {
    // Context Broker: inject the compressed project context (state, memory, recent activity)
    let systemPrompt = 'You are Rayzen AI, a helpful engineering assistant.'
    const brokerCtx = await this.brokerContext(dto.projectId, dto.content, 'study')
    if (brokerCtx) systemPrompt += `\n\nProject context:\n${brokerCtx}`

    const result = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: dto.content },
    ], { model: 'gpt-4o', temperature: 0.7 })

    return {
      ...decision,
      target:  'chat',
      payload: { sessionId: dto.sessionId },
      result:  { answer: result.content, tokensUsed: result.tokensUsed },
    }
  }
}
