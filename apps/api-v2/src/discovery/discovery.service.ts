import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LlmService } from '../llm/llm.service'

export type DiscoveryStatus = 'gathering' | 'ready' | 'blueprint_ready'

export interface DiscoveryMessage {
  role:    'user' | 'assistant'
  content: string
  ts:      string
}

export interface Blueprint {
  projectName:   string
  segment:       string
  problem:       string
  solution:      string
  painPoints:    Array<{ description: string; severity: 'low' | 'medium' | 'high' | 'critical' }>
  personas:      Array<{ name: string; role: string; pain: string; expectation: string }>
  requirements:  Array<{ id: string; description: string; priority: 'must' | 'should' | 'could' }>
  businessRules: Array<{ id: string; description: string; enforcement: 'hard' | 'soft' }>
  integrations:  string[]
  opportunities: Array<{ title: string; description: string; value: 'low' | 'medium' | 'high'; effort: 'low' | 'medium' | 'high' }>
  stack:         Array<{ layer: string; tech: string }>
  brief:         string   // passado ao create_project_folder template=rayzen
  contextSummary: string  // resumo denso pro Context Broker / ProjectState inicial
}

export interface DiscoverySession {
  id:          string
  projectName?: string
  status:      DiscoveryStatus
  messages:    DiscoveryMessage[]
  blueprint?:  Blueprint
  createdAt:   string
  updatedAt:   string
}

/** Espelha o SpecData consumido pelo agent (create_project_folder template=rayzen). */
export interface ProjectSpec {
  problem:         string
  solution:        string
  personas:        Array<{ name: string; role: string; pain: string; expectation: string }>
  mvpFeatures:     string[]
  outOfScope:      string[]
  successCriteria: string[]
  stack:           Array<{ layer: string; tech: string }>
  decisions:       Array<{ decision: string; choice: string; reason: string }>
  phase1Name:      string
  phase1Items:     string[]
  phase1Criterion: string
  diaryEntry:      string
}

const SPEC_SYSTEM = `Você é um analista de produto e arquiteto de software. Dado o nome e a ideia de um projeto, gere um JSON de especificação estruturada.

Retorne APENAS JSON válido com esta estrutura exata:
{
  "problem": "descrição do problema em 2-3 frases",
  "solution": "proposta de valor em 2-3 frases",
  "personas": [{ "name": "Nome", "role": "cargo/papel", "pain": "dor principal", "expectation": "o que espera do produto" }],
  "mvpFeatures": ["feature 1", "feature 2", "feature 3"],
  "outOfScope": ["o que não entra no MVP"],
  "successCriteria": ["critério mensurável 1", "critério 2", "critério 3"],
  "stack": [{ "layer": "Frontend", "tech": "tecnologia" }, { "layer": "Backend", "tech": "tecnologia" }, { "layer": "Banco de dados", "tech": "tecnologia" }],
  "decisions": [{ "decision": "escolha técnica", "choice": "o que foi escolhido", "reason": "por quê" }],
  "phase1Name": "Nome da Fase 1",
  "phase1Items": ["item 1", "item 2", "item 3"],
  "phase1Criterion": "critério de done da fase 1 em 1 frase verificável",
  "diaryEntry": "resumo em 2 frases do que é o projeto e por que foi iniciado"
}

Seja específico e técnico. Derive stack e decisões do brief. Se a stack não for mencionada, sugira a mais adequada ao tipo de projeto.`

const DISCOVERY_SYSTEM = `Você é o Rayzen em MODO DESCOBERTA, conduzindo a entrevista de intake de um projeto novo (geralmente de um cliente).
Seu objetivo é colher, por conversa natural em português, o suficiente para montar um Blueprint: problema, processo atual, usuários/personas, integrações existentes, regras de negócio e restrições.

Regras:
- Faça UMA pergunta de cada vez, curta e específica. Não despeje várias.
- Cubra progressivamente: problema → processo atual → usuários → integrações/sistemas → regras → restrições.
- Não invente; pergunte o que falta. Não peça detalhes técnicos que o cliente não saberia.
- Quando já houver o suficiente para um Blueprint útil, sinalize enoughInfo=true (sem parar de ser útil).

Responda SOMENTE com JSON:
{ "reply": "sua próxima fala/pergunta em PT", "enoughInfo": true|false }`

const BLUEPRINT_SYSTEM = `Você é um analista de produto e arquiteto. A partir da transcrição de uma entrevista de descoberta, gere um Blueprint estruturado.
Derive dores, requisitos rastreáveis (REQ-001...), regras de negócio (RN-001...), personas, integrações, stack adequada e OPORTUNIDADES não pedidas explicitamente (features/integrações/automações que agregam valor).
O campo "brief" deve ser um parágrafo denso que sirva de input para gerar a documentação do projeto. O "contextSummary" é um resumo curto e denso do projeto.

Responda SOMENTE com JSON válido nesta estrutura:
{
  "projectName": "", "segment": "", "problem": "", "solution": "",
  "painPoints": [{ "description": "", "severity": "high" }],
  "personas": [{ "name": "", "role": "", "pain": "", "expectation": "" }],
  "requirements": [{ "id": "REQ-001", "description": "", "priority": "must" }],
  "businessRules": [{ "id": "RN-001", "description": "", "enforcement": "hard" }],
  "integrations": [""],
  "opportunities": [{ "title": "", "description": "", "value": "high", "effort": "medium" }],
  "stack": [{ "layer": "Frontend", "tech": "" }],
  "brief": "", "contextSummary": ""
}`

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name)
  private readonly sessions = new Map<string, DiscoverySession>()

  constructor(private readonly llm: LlmService) {}

  /** Conversa de descoberta — acumula respostas e sinaliza quando há contexto suficiente. */
  async message(content: string, sessionId?: string, projectName?: string): Promise<{
    sessionId: string
    reply: string
    status: DiscoveryStatus
    enoughInfo: boolean
  }> {
    const sess = (sessionId && this.sessions.get(sessionId)) || this.createSession(projectName)
    if (projectName && !sess.projectName) sess.projectName = projectName

    sess.messages.push({ role: 'user', content, ts: new Date().toISOString() })

    let reply = 'Pode me contar um pouco mais?'
    let enoughInfo = false
    try {
      // gpt-4o (llama 70b) segue o formato JSON bem melhor que o 8b — menos fallback genérico.
      const result = await this.llm.chat(
        [{ role: 'system', content: DISCOVERY_SYSTEM }, ...sess.messages.map((m) => ({ role: m.role, content: m.content }))],
        { model: 'gpt-4o', temperature: 0.4 },
      )
      try {
        const parsed = this.llm.extractJson(result.content) as { reply?: string; enoughInfo?: boolean }
        reply = parsed.reply ?? reply
        enoughInfo = Boolean(parsed.enoughInfo)
      } catch {
        // Modelo respondeu em texto puro (sem JSON): usa a fala real dele em vez do fallback genérico.
        const raw = result.content?.replace(/```[\s\S]*?```/g, '').trim()
        if (raw) reply = raw
        this.logger.warn('discovery: resposta sem JSON, usando texto cru como reply')
      }
    } catch (e) {
      this.logger.warn(`discovery message LLM error: ${e}`)
    }

    sess.messages.push({ role: 'assistant', content: reply, ts: new Date().toISOString() })
    sess.status = enoughInfo ? 'ready' : 'gathering'
    sess.updatedAt = new Date().toISOString()

    return { sessionId: sess.id, reply, status: sess.status, enoughInfo }
  }

  /** Consolida a entrevista num Blueprint estruturado (para revisão do Marcelo antes de aplicar). */
  async generateBlueprint(sessionId: string): Promise<Blueprint> {
    const sess = this.sessions.get(sessionId)
    if (!sess) throw new NotFoundException(`Discovery session ${sessionId} not found`)

    const transcript = sess.messages.map((m) => `${m.role === 'user' ? 'Cliente' : 'Rayzen'}: ${m.content}`).join('\n')
    const messages = [
      { role: 'system' as const, content: BLUEPRINT_SYSTEM },
      { role: 'user' as const, content: `Projeto: ${sess.projectName ?? '(a definir)'}\n\nTranscrição da descoberta:\n${transcript}` },
    ]

    // Premium (Claude direto) para qualidade do output estruturado; cai pro mini se indisponível.
    const models = ['gpt-4o-premium', 'gpt-4o-mini']
    for (const model of models) {
      try {
        const result = await this.llm.chat(messages, { model, temperature: 0.2, maxTokens: 2500 })
        const blueprint = this.llm.extractJson(result.content) as Blueprint
        if (sess.projectName && !blueprint.projectName) blueprint.projectName = sess.projectName
        sess.blueprint = blueprint
        sess.status = 'blueprint_ready'
        sess.updatedAt = new Date().toISOString()
        return blueprint
      } catch (e) {
        this.logger.warn(`blueprint via ${model} falhou: ${e}`)
      }
    }
    throw new ServiceUnavailableException('Não foi possível gerar o Blueprint agora (LLM indisponível/limite). Tente novamente em instantes.')
  }

  /**
   * Gera a especificação estruturada do projeto a partir de um brief.
   * Roda no servidor (LiteLLM acessível na VPS) — o agent desktop NÃO alcança o LiteLLM
   * direto, então delega aqui em vez de chamar :4100 localmente.
   */
  async specFromBrief(name: string, brief: string): Promise<ProjectSpec> {
    const messages = [
      { role: 'system' as const, content: SPEC_SYSTEM },
      { role: 'user' as const, content: `Projeto: ${name}\n\nIdeia/Brief:\n${brief}` },
    ]
    const models = ['gpt-4o-mini', 'gpt-4o-premium']
    for (const model of models) {
      try {
        const result = await this.llm.chat(messages, { model, temperature: 0.2, maxTokens: 2000 })
        return this.llm.extractJson(result.content) as ProjectSpec
      } catch (e) {
        this.logger.warn(`spec via ${model} falhou: ${e}`)
      }
    }
    throw new ServiceUnavailableException('Não foi possível gerar a especificação agora (LLM indisponível/limite).')
  }

  /** Converte um Blueprint já revisado em ProjectSpec — sem nova chamada de LLM. */
  blueprintToSpec(bp: Blueprint): ProjectSpec {
    const must = bp.requirements.filter((r) => r.priority === 'must')
    const phaseItems = (must.length ? must : bp.requirements).map((r) => r.description)
    return {
      problem:  bp.problem,
      solution: bp.solution,
      personas: bp.personas,
      mvpFeatures: phaseItems.slice(0, 8),
      outOfScope: bp.requirements.filter((r) => r.priority === 'could').map((r) => r.description),
      successCriteria: bp.painPoints
        .filter((p) => p.severity === 'high' || p.severity === 'critical')
        .map((p) => `Resolver: ${p.description}`)
        .slice(0, 5),
      stack: bp.stack,
      decisions: bp.stack.map((s) => ({
        decision: `${s.layer}`,
        choice: s.tech,
        reason: 'Adequação ao problema e à stack do projeto.',
      })),
      phase1Name: `MVP — ${bp.projectName || 'Fase 1'}`,
      phase1Items: phaseItems.slice(0, 5),
      phase1Criterion: must[0]?.description ?? bp.solution,
      diaryEntry: bp.contextSummary || `${bp.projectName}: ${bp.problem}`,
    }
  }

  get(sessionId: string): DiscoverySession {
    const sess = this.sessions.get(sessionId)
    if (!sess) throw new NotFoundException(`Discovery session ${sessionId} not found`)
    return sess
  }

  private createSession(projectName?: string): DiscoverySession {
    const now = new Date().toISOString()
    const sess: DiscoverySession = {
      id: randomUUID(),
      projectName,
      status: 'gathering',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(sess.id, sess)
    return sess
  }
}
