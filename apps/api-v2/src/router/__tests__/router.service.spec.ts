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
