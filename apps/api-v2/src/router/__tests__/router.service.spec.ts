import { RouterService } from '../router.service'
import { HealthReport } from '../jarvis-health.service'

function healthOk(): HealthReport {
  return {
    healthy:  true,
    degraded: false,
    services: {
      litellm:  { ok: true, latencyMs: 1 },
      database: { ok: true, latencyMs: 1 },
      v1bridge: { ok: true, latencyMs: 1 },
    },
    blockedIntentTypes: [],
    checkedAt: new Date().toISOString(),
  } as HealthReport
}

function buildService(chatResponses: string[]) {
  let call = 0
  const llm = {
    chat: jest.fn().mockImplementation(async () => ({ content: chatResponses[call++], tokensUsed: 10 })),
    extractJson: jest.fn((text: string) => JSON.parse(text)),
  }
  const missions    = {}
  const v1Bridge    = { getProjectState: jest.fn().mockResolvedValue(null) }
  const ctxEngine   = { build: jest.fn().mockResolvedValue({ text: '' }) }
  const gates       = { create: jest.fn().mockResolvedValue({ id: 'gate-1' }) }
  const specialists = { findForTask: jest.fn().mockResolvedValue(null) }
  const health      = { check: jest.fn().mockResolvedValue(healthOk()) }
  const skillEngine = {}

  const svc = new RouterService(
    llm as never, missions as never, v1Bridge as never, ctxEngine as never,
    gates as never, specialists as never, health as never, skillEngine as never,
  )
  return { svc, llm, gates }
}

const classify = (over: Partial<{ intentType: string; confidence: number; ambiguous: boolean; clarificationNeeded: string | null }> = {}) =>
  JSON.stringify({
    intentType: 'retrieve_context', confidence: 0.9, reasoning: 'ok', ambiguous: false, clarificationNeeded: null,
    ...over,
  })

const planSteps = () => JSON.stringify({ steps: [{ title: 't', prompt: 'p', executor: 'ai', risk: 'low' }] })

describe('RouterService.planMode — entrevista por riskLevel (Guardian Blueprint v1.1, item 8)', () => {
  it('riskLevel low — nunca interrompe, retorna o plano direto', async () => {
    const { svc, gates } = buildService([classify({ intentType: 'retrieve_context' }), planSteps()])
    const result = await svc.planMode({ projectId: 'p1', objective: 'o que já foi feito?' })

    expect(result.interviewRequired).toBe(false)
    expect(result.questions).toEqual([])
    expect(result.steps).toHaveLength(1)
    expect(gates.create).not.toHaveBeenCalled()
  })

  it('riskLevel medium + não ambíguo — não interrompe', async () => {
    const { svc, gates } = buildService([classify({ intentType: 'run_tests', ambiguous: false }), planSteps()])
    const result = await svc.planMode({ projectId: 'p1', objective: 'rodar os testes' })

    expect(result.interviewRequired).toBe(false)
    expect(gates.create).not.toHaveBeenCalled()
  })

  it('riskLevel medium + ambíguo — interrompe com a pergunta da classificação, sem steps', async () => {
    const { svc, gates } = buildService([
      classify({ intentType: 'analyze_failure', confidence: 0.5, ambiguous: true, clarificationNeeded: 'Qual o erro exato?' }),
      planSteps(),
    ])
    const result = await svc.planMode({ projectId: 'p1', objective: 'investigar uma falha' })

    expect(result.interviewRequired).toBe(true)
    expect(result.questions).toEqual(['Qual o erro exato?'])
    expect(result.steps).toEqual([])
    expect(result.gateId).toBe('gate-1')
    expect(gates.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'clarification', riskLevel: 'medium' }))
  })

  it('riskLevel high — sempre interrompe e gera perguntas via LLM dedicado, mesmo sem ambiguidade', async () => {
    const { svc, gates } = buildService([
      classify({ intentType: 'deploy', confidence: 0.95, ambiguous: false }),
      planSteps(),
      JSON.stringify({ questions: ['Qual o plano de rollback?', 'Quais serviços serão afetados?'] }),
    ])
    const result = await svc.planMode({ projectId: 'p1', objective: 'fazer deploy em produção' })

    expect(result.interviewRequired).toBe(true)
    expect(result.questions).toEqual(['Qual o plano de rollback?', 'Quais serviços serão afetados?'])
    expect(result.steps).toEqual([])
    expect(gates.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'clarification', riskLevel: 'high' }))
  })

  it('riskLevel high — fallback de pergunta padrão quando a geração via LLM falha', async () => {
    const { svc, llm } = buildService([
      classify({ intentType: 'database_migration', confidence: 0.9, ambiguous: false }),
      planSteps(),
    ])
    llm.chat.mockImplementationOnce(async () => ({ content: classify({ intentType: 'database_migration' }), tokensUsed: 1 }))
    llm.chat.mockImplementationOnce(async () => ({ content: planSteps(), tokensUsed: 1 }))
    llm.chat.mockImplementationOnce(async () => { throw new Error('LLM indisponível') })

    const result = await svc.planMode({ projectId: 'p1', objective: 'migrar schema em produção' })

    expect(result.interviewRequired).toBe(true)
    expect(result.questions).toEqual(['Qual o plano de rollback se esta ação falhar?'])
  })
})

const perspectiveJson = (verdict: 'ok' | 'concern' | 'block', findings: string[] = [], recommendation = '') =>
  JSON.stringify({ verdict, findings, recommendation })

// Ordem de Object.keys(PERSPECTIVE_FOCUS) em router.service.ts
const ALL_OK = Array(6).fill(perspectiveJson('ok'))

describe('RouterService.ultraplan — 6 perspectivas paralelas (Guardian Blueprint v1.1, item 9)', () => {
  it('todas as perspectivas ok — overallVerdict ok, sem blockingConcerns', async () => {
    const { svc, llm } = buildService([classify({ intentType: 'generate_code' }), planSteps(), ...ALL_OK])
    const result = await svc.ultraplan({ projectId: 'p1', objective: 'implementar feature X' })

    expect(result.perspectives).toHaveLength(6)
    expect(result.perspectives.map((p) => p.perspective).sort()).toEqual(
      ['architecture', 'performance', 'risk', 'scope', 'security', 'testing'].sort(),
    )
    expect(result.overallVerdict).toBe('ok')
    expect(result.blockingConcerns).toEqual([])
    expect(llm.chat).toHaveBeenCalledTimes(8) // classify + plan-steps + 6 perspectivas
  })

  it('uma perspectiva retorna block — overallVerdict vira block e agrega os findings', async () => {
    const responses = [...ALL_OK]
    responses[3] = perspectiveJson('block', ['Step de deploy sem ApprovalGate'], 'Adicionar gate antes do deploy') // risk é o 4º (índice 3)

    const { svc } = buildService([classify({ intentType: 'deploy' }), planSteps(), ...responses])
    const result = await svc.ultraplan({ projectId: 'p1', objective: 'deploy em produção' })

    expect(result.overallVerdict).toBe('block')
    expect(result.blockingConcerns).toEqual(['Step de deploy sem ApprovalGate'])
    const riskPerspective = result.perspectives.find((p) => p.perspective === 'risk')
    expect(riskPerspective?.verdict).toBe('block')
    expect(riskPerspective?.recommendation).toBe('Adicionar gate antes do deploy')
  })

  it('mistura ok e concern (sem block) — overallVerdict vira concern', async () => {
    const responses = [...ALL_OK]
    responses[2] = perspectiveJson('concern', ['Service novo sem spec correspondente']) // testing é o 3º (índice 2)

    const { svc } = buildService([classify({ intentType: 'generate_code' }), planSteps(), ...responses])
    const result = await svc.ultraplan({ projectId: 'p1', objective: 'implementar feature Y' })

    expect(result.overallVerdict).toBe('concern')
    expect(result.blockingConcerns).toEqual([])
  })

  it('falha de uma perspectiva individual não derruba as outras — vira concern explícito', async () => {
    // 3ª chamada de perspectiva (testing, índice 4 da fila: classify, plan-steps, architecture, security, testing) falha
    const queue: Array<() => string> = [
      () => classify({ intentType: 'generate_code' }),
      () => planSteps(),
      () => perspectiveJson('ok'),
      () => perspectiveJson('ok'),
      () => { throw new Error('rate limited') },
      () => perspectiveJson('ok'),
      () => perspectiveJson('ok'),
      () => perspectiveJson('ok'),
    ]
    let call = 0
    const llm = {
      chat: jest.fn().mockImplementation(async () => ({ content: queue[call++](), tokensUsed: 1 })),
      extractJson: jest.fn((text: string) => JSON.parse(text)),
    }
    const svc = new RouterService(
      llm as never, {} as never, { getProjectState: jest.fn().mockResolvedValue(null) } as never,
      { build: jest.fn().mockResolvedValue({ text: '' }) } as never, { create: jest.fn() } as never,
      { findForTask: jest.fn().mockResolvedValue(null) } as never, { check: jest.fn().mockResolvedValue(healthOk()) } as never,
      {} as never,
    )

    const result = await svc.ultraplan({ projectId: 'p1', objective: 'implementar feature Z' })

    expect(result.perspectives).toHaveLength(6)
    const failed = result.perspectives.find((p) => p.findings.some((f) => f.includes('rate limited')))
    expect(failed?.perspective).toBe('testing')
    expect(failed?.verdict).toBe('concern')
    expect(result.overallVerdict).not.toBe('block')
  })
})
