import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'
import { MissionService } from '../mission/mission.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { ContextEngineService, WorkMode } from '../context-engine/context-engine.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SpecialistAgentService } from '../specialist-agent/specialist-agent.service'
import { SkillEngineService } from '../skill-engine/skill-engine.service'
import { SKILL_DEFINITIONS_EXPORT } from '../skill-engine/skill-registry'
import { WORKFLOW_TEMPLATES } from '../workflow/workflow-engine.service'
import { JARVISHealthService, HealthReport } from './jarvis-health.service'
import { RouteRequestDto, RouteDecision, DecisionType } from './dto/route-request.dto'
import {
  IntentType,
  IntentContract,
  INTENT_TO_ROUTE,
  INTENT_RISK,
  INTENT_SPECIALIST,
  INTENT_SKILL,
  TEMPLATE_FOR_INTENT,
} from './dto/intent-contract.dto'

// ─── System prompts ────────────────────────────────────────────────────────────

const CLASSIFY_INTENT_SYSTEM = `You are an intent classifier for an AI engineering system.
Given a user message and optional project context, classify the intent as one of these exact types:
- generate_code: writing new code, implementing features, building something
- review_code: reviewing, auditing, analyzing existing code for quality or correctness
- create_test: writing unit tests, integration tests, test cases, test plans
- run_tests: running the test suite, executing tests, checking coverage
- analyze_failure: debugging a failure, investigating a bug, root cause analysis
- generate_documentation: writing docs, ADRs, specs, README, changelogs
- update_roadmap: updating the roadmap, backlog, milestones, planning
- retrieve_context: asking about project state, what was done, what exists
- create_architecture: designing architecture, system design, module structure
- client_discovery: understanding client needs, scoping a project, discovery session
- deploy: deployment, CI/CD, release, infrastructure provisioning
- database_migration: schema changes, migrations, data model evolution
- summarize_session: summarizing the session, what was accomplished
- request_approval: asking for approval, requesting a gate, high-risk confirmation
- classify_intent: meta-request about classification itself

Rules:
- If confidence < 0.7 → set ambiguous: true and provide clarificationNeeded
- Respond ONLY with valid JSON, no markdown fences

{
  "intentType": "<one of the types above>",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence",
  "ambiguous": false,
  "clarificationNeeded": null
}`

const SKILL_LIST_FOR_PROMPT = SKILL_DEFINITIONS_EXPORT
  .map((s) => `- ${s.id}: ${s.description} (risk: ${s.risk})`)
  .join('\n')

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
      "skillId": "REQUIRED if executor=skill — must be one of the exact IDs listed below, never invent one",
      "risk": "none|low|medium|high"
    }
  ]
}

Executor selection — this matters, pick carefully:
- "skill": ONLY when the step maps exactly to one of the registered skills below. Use the exact "id" string as skillId.
- "ai": for anything requiring reasoning/judgment that isn't an atomic registered skill — e.g. editing code logic, refactoring, deciding what to change. This is the right choice for most code-editing steps; the executing specialist will read/write files itself.
- "human": only when a human must act outside this system (e.g. manual review, external approval).
If no registered skill fits, use "ai" instead of guessing a skillId — an invalid skillId fails the step at execution time.

Registered skills (only these IDs are valid for executor=skill):
${SKILL_LIST_FOR_PROMPT}

Risk levels:
- none/low: read-only, reversible, safe operations
- medium: writes to files or external state, but reversible
- high: deploys, database writes, irreversible actions, external API calls with side effects`

// ─── Success criteria por IntentType ──────────────────────────────────────────

const SUCCESS_CRITERIA: Record<IntentType, string[]> = {
  generate_code:          ['Code compiles without errors', 'Follows project TypeScript conventions', 'No security vulnerabilities introduced'],
  review_code:            ['All issues documented with severity', 'Suggestions are actionable', 'No false positives'],
  create_test:            ['Tests are runnable', 'Coverage target met', 'Tests are deterministic'],
  run_tests:              ['All tests pass', 'Coverage report generated', 'Failures have root cause identified'],
  analyze_failure:        ['Root cause identified', 'Reproduction steps documented', 'Fix proposed'],
  generate_documentation: ['Document is accurate to the current codebase', 'Follows project doc conventions'],
  update_roadmap:         ['Roadmap reflects current state', 'Milestones are dated and measurable'],
  retrieve_context:       ['Context is relevant to the query', 'No sensitive data exposed', 'Sources cited'],
  create_architecture:    ['Architecture decision is documented as ADR', 'Trade-offs are explicit'],
  client_discovery:       ['Problem named in one sentence', 'Scope defined (in/out)', 'IntentContract generated'],
  deploy:                 ['Deployment successful', 'Health checks pass', 'Rollback plan documented'],
  database_migration:     ['Migration runs without error', 'Data integrity verified', 'Rollback tested'],
  summarize_session:      ['Summary captures decisions and artifacts', 'Stored in memory', 'Next steps identified'],
  request_approval:       ['Approval gate created', 'Risk documented', 'Rollback plan present'],
  classify_intent:        ['Intent classified with confidence ≥ 0.7'],
}

const TOOLS_BY_INTENT: Record<IntentType, string[]> = {
  generate_code:          ['filesystem', 'litellm', 'github'],
  review_code:            ['filesystem', 'litellm'],
  create_test:            ['filesystem', 'litellm', 'terminal'],
  run_tests:              ['terminal', 'filesystem'],
  analyze_failure:        ['filesystem', 'litellm', 'terminal'],
  generate_documentation: ['filesystem', 'litellm'],
  update_roadmap:         ['mcp', 'filesystem'],
  retrieve_context:       ['mcp', 'memory-engine'],
  create_architecture:    ['filesystem', 'litellm'],
  client_discovery:       ['mcp', 'litellm'],
  deploy:                 ['terminal', 'github'],
  database_migration:     ['terminal', 'filesystem'],
  summarize_session:      ['mcp', 'litellm'],
  request_approval:       ['mcp'],
  classify_intent:        ['litellm'],
}

// ─── RouterService ─────────────────────────────────────────────────────────────

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name)

  constructor(
    private readonly llm:         LlmService,
    private readonly missions:    MissionService,
    private readonly v1Bridge:    V1BridgeService,
    private readonly ctxEngine:   ContextEngineService,
    private readonly gates:       ApprovalGatesService,
    private readonly specialists: SpecialistAgentService,
    private readonly health:      JARVISHealthService,
    private readonly skillEngine: SkillEngineService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  async route(dto: RouteRequestDto): Promise<IntentContract & { result?: unknown }> {
    // 0. Guard — projectId/content obrigatórios (callers internos burlam a validação do DTO)
    if (!dto.projectId?.trim()) throw new BadRequestException('route: projectId é obrigatório')
    if (!dto.content?.trim())   throw new BadRequestException('route: content é obrigatório')

    // 1. Classify intent (granular IntentType)
    const classification = await this.classifyIntent(dto)

    // 2. JARVIS health check (cached 30s)
    const healthReport = await this.health.check()

    // 3. Build IntentContract
    const contract = this.buildContract(classification, healthReport, dto)

    // 4. Enforce forced mode override
    if (dto.mode && dto.mode !== 'auto') {
      contract.routeTo   = dto.mode === 'chat' ? 'ai' : (dto.mode as 'mission' | 'skill' | 'ai' | 'clarification')
      contract.riskLevel = 'low'
    }

    // 5. Block if intent is unavailable in current health state
    if (healthReport.blockedIntentTypes.includes(contract.intentType)) {
      return {
        ...contract,
        routeTo: 'clarification',
        result: {
          blocked: true,
          reason:  `Intent "${contract.intentType}" unavailable — degraded services: ${healthReport.services.litellm.ok ? '' : 'litellm '}${healthReport.services.database.ok ? '' : 'database'}`.trim(),
          healthReport,
        },
      }
    }

    // 6. Handle ambiguity before dispatching
    if (contract.ambiguous) {
      return { ...contract, routeTo: 'clarification', result: { question: contract.clarificationNeeded } }
    }

    // 7. Dispatch by IntentContract
    return this.dispatchContract(contract, dto)
  }

  /** Dry-run: plano sem criar registros no banco. */
  async plan(dto: { projectId: string; objective: string }): Promise<{
    steps:        Array<{ title: string; prompt: string; executor: string; skillId?: string; risk: string }>
    specialist:   { id: string; name: string; domain: string } | null
    contextChars: number
    warnings:     string[]
    contract?:    Omit<IntentContract, 'createdAt'>
  }> {
    if (!dto.projectId?.trim()) throw new BadRequestException('plan: projectId é obrigatório')
    if (!dto.objective?.trim()) throw new BadRequestException('plan: objective é obrigatório')

    const [specialist, brokerCtx, classification, healthReport] = await Promise.all([
      this.specialists.findForTask(dto.objective, dto.projectId).catch(() => null),
      this.brokerContext(dto.projectId, dto.objective, 'architecture'),
      this.classifyIntent({ content: dto.objective, projectId: dto.projectId }),
      this.health.check(),
    ])

    const contract = this.buildContract(classification, healthReport, { content: dto.objective, projectId: dto.projectId })

    const specialistSection = specialist
      ? `\n\n## Specialist: ${specialist.name} (${specialist.domain})\n${specialist.systemPrompt}`
      : ''

    let steps: Array<{ title: string; prompt: string; executor: string; skillId?: string; risk?: string }> = []
    try {
      const planResult = await this.llm.chat([
        { role: 'system', content: PLAN_SYSTEM + specialistSection },
        {
          role: 'user',
          content: `Objective: "${dto.objective}"\n\nProject ID: ${dto.projectId}` +
            (brokerCtx ? `\n\nProject context:\n${brokerCtx}` : ''),
        },
      ], { model: specialist?.model ?? 'gpt-4o', temperature: 0.2 })

      const parsed = this.llm.extractJson(planResult.content) as { steps: typeof steps }
      steps = parsed.steps ?? []
    } catch (e) {
      this.logger.warn(`plan dry-run error: ${e}`)
    }

    const warnings = steps
      .filter((s) => s.risk === 'high')
      .map((s) => `Step "${s.title}" é alto risco — ApprovalGate será criado automaticamente`)

    return {
      steps: steps.map((s) => ({ ...s, risk: s.risk ?? 'none' })),
      specialist: specialist ? { id: specialist.id, name: specialist.name, domain: specialist.domain } : null,
      contextChars: brokerCtx.length,
      warnings,
      contract: (({ createdAt: _c, ...rest }) => rest)(contract),
    }
  }

  // ── Intent Classification ───────────────────────────────────────────────────

  private async classifyIntent(dto: { content: string; projectId: string; sessionId?: string }): Promise<{
    intentType:          IntentType
    confidence:          number
    reasoning:           string
    ambiguous:           boolean
    clarificationNeeded?: string
  }> {
    let projectCtx = ''
    try {
      const state = await this.v1Bridge.getProjectState(dto.projectId)
      if (state) projectCtx = `Project stage: ${state.stage ?? 'unknown'}. Blockers: ${JSON.stringify(state.blockers ?? [])}`
    } catch { /* context is optional */ }

    try {
      const result = await this.llm.chat([
        { role: 'system', content: CLASSIFY_INTENT_SYSTEM },
        {
          role: 'user',
          content: `Message: "${dto.content}"\n\nProject context: ${projectCtx || 'none'}`,
        },
      ], { model: 'gpt-4o-mini', temperature: 0 })

      const parsed = this.llm.extractJson(result.content) as {
        intentType:          IntentType
        confidence:          number
        reasoning:           string
        ambiguous:           boolean
        clarificationNeeded: string | null
      }

      // Validate intentType is in the known set
      const validTypes = Object.keys(INTENT_TO_ROUTE) as IntentType[]
      const intentType = validTypes.includes(parsed.intentType) ? parsed.intentType : 'generate_code'

      return {
        intentType,
        confidence:          parsed.confidence ?? 0.7,
        reasoning:           parsed.reasoning  ?? 'classified by LLM',
        ambiguous:           parsed.ambiguous  ?? parsed.confidence < 0.7,
        clarificationNeeded: parsed.clarificationNeeded ?? undefined,
      }
    } catch (e) {
      this.logger.warn(`classifyIntent error: ${e}`)
      // Conservative fallback — treat as mission/generate_code
      return {
        intentType:  'generate_code',
        confidence:  0.5,
        reasoning:   'fallback — LLM classification failed',
        ambiguous:   false,
      }
    }
  }

  // ── Contract Builder ────────────────────────────────────────────────────────

  private buildContract(
    classification: Awaited<ReturnType<RouterService['classifyIntent']>>,
    health: HealthReport,
    dto: { content: string; projectId: string; sessionId?: string },
  ): IntentContract {
    const { intentType, confidence, reasoning, ambiguous, clarificationNeeded } = classification

    return {
      intentType,
      confidence,
      reasoning,
      ambiguous,
      clarificationNeeded,

      projectId: dto.projectId,
      sessionId: dto.sessionId,
      rawInput:  dto.content,

      successCriteria: SUCCESS_CRITERIA[intentType] ?? [],
      riskLevel:       INTENT_RISK[intentType] ?? 'low',
      toolsRequired:   TOOLS_BY_INTENT[intentType] ?? [],
      environment:     (process.env.NODE_ENV === 'production' ? 'production' : 'local') as IntentContract['environment'],

      routeTo:          INTENT_TO_ROUTE[intentType],
      specialistDomain: INTENT_SPECIALIST[intentType],

      healthSnapshot: {
        degraded:            health.degraded,
        unavailableServices: Object.entries(health.services)
          .filter(([, v]) => !v.ok)
          .map(([k]) => k),
      },

      createdAt: new Date().toISOString(),
    }
  }

  // ── Dispatch by IntentContract ──────────────────────────────────────────────

  private async dispatchContract(
    contract: IntentContract,
    dto: RouteRequestDto,
  ): Promise<IntentContract & { result?: unknown }> {
    switch (contract.routeTo) {
      case 'mission':
        return this.createMission(contract, dto)
      case 'ai':
        return this.chat(contract, dto)
      case 'skill':
        return this.executeSkill(contract, dto)
      case 'clarification':
      default:
        return { ...contract, result: { question: contract.clarificationNeeded ?? 'Could you provide more details?' } }
    }
  }

  // ── Skill Executor ──────────────────────────────────────────────────────────

  /**
   * Executa uma skill atômica via SkillEngine. O skillId vem de dto.context.skillId
   * (explícito) ou do mapa INTENT_SKILL. Sem skill mapeada → degrada para chat,
   * em vez da nota morta anterior.
   */
  private async executeSkill(
    contract: IntentContract,
    dto: RouteRequestDto,
  ): Promise<IntentContract & { result?: unknown }> {
    const skillId = (dto.context?.skillId as string | undefined) ?? INTENT_SKILL[contract.intentType]

    if (!skillId) {
      this.logger.warn(`Sem skill mapeada para a intenção "${contract.intentType}" — fallback para chat`)
      return this.chat(contract, dto)
    }

    try {
      const result = await this.skillEngine.run({
        skillId,
        input:     (dto.context ?? {}) as Record<string, unknown>,
        projectId: dto.projectId,
      })
      return { ...contract, result: { ...result, skillId } }
    } catch (e) {
      this.logger.warn(`Falha ao executar skill "${skillId}": ${e}`)
      return { ...contract, result: { skillId, success: false, error: e instanceof Error ? e.message : String(e) } }
    }
  }

  /**
   * Aplica um workflow template (steps com dependsOn) a uma missão recém-criada.
   * Fallback quando o LLM não consegue planejar steps. Retorna o template usado.
   */
  private async applyTemplateSteps(missionId: string, intentType: IntentType): Promise<string> {
    const templateType = TEMPLATE_FOR_INTENT[intentType] ?? 'implementation'
    const template = WORKFLOW_TEMPLATES[templateType]
    const idMap = new Map<string, string>()

    for (const t of template) {
      const created = await this.missions.addStep(missionId, {
        title: t.title, executor: t.executor, skillId: t.skillId, input: {}, dependsOn: [],
      })
      idMap.set(t.key, created.id)
    }
    // Segunda passada: liga as dependências com os IDs reais
    for (const t of template) {
      const deps = t.dependsOn.map((k) => idMap.get(k)).filter(Boolean) as string[]
      if (deps.length) await this.missions.updateStep(missionId, idMap.get(t.key)!, { dependsOn: deps })
    }
    return templateType
  }

  // ── Mission Creator ─────────────────────────────────────────────────────────

  private async createMission(
    contract: IntentContract,
    dto: RouteRequestDto,
  ): Promise<IntentContract & { result?: unknown }> {
    const [specialist, brokerCtx] = await Promise.all([
      contract.specialistDomain
        ? this.specialists.findForTask(dto.content, dto.projectId).catch(() => null)
        : Promise.resolve(null),
      this.brokerContext(dto.projectId, dto.content, 'architecture'),
    ])

    const specialistSection = specialist
      ? `\n\n## Specialist: ${specialist.name} (${specialist.domain})\n${specialist.systemPrompt}`
      : ''

    // Inject success criteria from contract into the plan prompt
    const criteriaSection = contract.successCriteria.length
      ? `\n\n## Success Criteria (must be met by the plan)\n${contract.successCriteria.map((c) => `- ${c}`).join('\n')}`
      : ''

    let steps: Array<{ title: string; prompt: string; executor: string; skillId?: string; risk?: string }> = []
    let planRaw = ''
    try {
      const planResult = await this.llm.chat([
        { role: 'system', content: PLAN_SYSTEM + specialistSection + criteriaSection },
        {
          role: 'user',
          content: `Objective: "${dto.content}"\n\nProject ID: ${dto.projectId}` +
            (brokerCtx ? `\n\nProject context:\n${brokerCtx}` : ''),
        },
      ], { model: specialist?.model ?? 'gpt-4o', temperature: 0.2 })
      planRaw = planResult.content

      const parsed = this.llm.extractJson(planRaw) as { steps: typeof steps }
      steps = parsed.steps ?? []
    } catch (e) {
      this.logger.warn(`plan parse error: ${e} | raw: ${planRaw.slice(0, 300)}`)
    }

    const title = dto.content.slice(0, 80)

    const mission = await this.missions.create({
      projectId:    dto.projectId,
      title,
      objective:    dto.content,
      // Persiste o resumo do IntentContract para rastreabilidade na UI (mission detail)
      context: {
        ...(dto.context ?? {}),
        _contract: {
          intentType:      contract.intentType,
          confidence:      contract.confidence,
          riskLevel:       contract.riskLevel,
          successCriteria: contract.successCriteria,
          reasoning:       contract.reasoning,
        },
      },
      specialistId: specialist?.id,
    })

    let gatesCreated = 0
    let stepsCount = 0
    let templateApplied: string | undefined

    if (steps.length === 0) {
      // Fallback: o LLM não gerou steps — aplica o template do work-mode da intenção.
      templateApplied = await this.applyTemplateSteps(mission.id, contract.intentType)
      stepsCount = (await this.missions.listSteps(mission.id)).length
      this.logger.log(`LLM retornou 0 steps — template "${templateApplied}" aplicado (${stepsCount} steps)`)
    } else {
      const knownSkillIds = new Set(SKILL_DEFINITIONS_EXPORT.map((s) => s.id))
      for (const step of steps) {
        let executor = step.executor ?? 'ai'
        let skillId = step.skillId
        if (executor === 'skill' && (!skillId || !knownSkillIds.has(skillId))) {
          this.logger.warn(`Step "${step.title}" tinha skillId inválido ("${skillId}") — rebaixado para executor "ai"`)
          executor = 'ai'
          skillId = undefined
        }
        const missionStep = await this.missions.addStep(mission.id, {
          title:    step.title,
          prompt:   step.prompt,
          executor,
          skillId,
          input:    {},
          dependsOn: [],
        })
        stepsCount++

        const risk = (step.risk ?? 'none') as 'none' | 'low' | 'medium' | 'high'
        if (risk !== 'none' && risk !== 'low') {
          try {
            const { required } = await this.gates.checkAndCreate(
              risk, dto.projectId, mission.id, missionStep.id, step.title,
              { prompt: step.prompt, executor },
            )
            if (required) gatesCreated++
          } catch (e) {
            this.logger.warn(`gate creation failed for step "${step.title}": ${e}`)
          }
        }
      }
    }

    const missionWithSteps = await this.missions.findOne(mission.id)

    return {
      ...contract,
      result: {
        missionId:    mission.id,
        stepsCount,
        templateApplied,
        gatesCreated,
        contextChars: brokerCtx.length,
        specialist:   specialist ? { id: specialist.id, name: specialist.name, domain: specialist.domain } : null,
        mission:      missionWithSteps,
      },
    }
  }

  // ── AI Chat ─────────────────────────────────────────────────────────────────

  private async chat(
    contract: IntentContract,
    dto: RouteRequestDto,
  ): Promise<IntentContract & { result?: unknown }> {
    let systemPrompt = 'You are Rayzen AI, a helpful engineering assistant.'
    const brokerCtx = await this.brokerContext(dto.projectId, dto.content, 'study')
    if (brokerCtx) systemPrompt += `\n\nProject context:\n${brokerCtx}`

    const result = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: dto.content },
    ], { model: 'gpt-4o', temperature: 0.7 })

    return {
      ...contract,
      result: { answer: result.content, tokensUsed: result.tokensUsed },
    }
  }

  // ── Context Broker ──────────────────────────────────────────────────────────

  private async brokerContext(projectId: string, query: string, mode: WorkMode): Promise<string> {
    try {
      const ctx = await this.ctxEngine.build({ projectId, query, mode })
      return ctx.text
    } catch (e) {
      this.logger.warn(`broker context failed: ${e}`)
      return ''
    }
  }
}

// Re-export legacy types so controllers that reference RouteDecision still compile
export type { RouteDecision, DecisionType }
