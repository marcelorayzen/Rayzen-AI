import { LlmService } from '../llm.service'
import { costUsdFor, COST_PER_1M_FALLBACK } from '../model-pricing.const'
import type { CostControllerService } from '../../cost-controller/cost-controller.service'

/**
 * Registro de custo no LlmService.
 *
 * Até 2026-08-13 nada gravava `cost_records`: as 220 linhas da tabela vinham de
 * `specialist:*` (executor de missões, congelado em junho) e o único outro
 * caminho — `AiRouterService.setCostController()` — é um setter que **nenhum
 * módulo jamais chamou**, então o campo ficava null e o bloco de gravação nunca
 * executava. Benchmark, QA Scientist, evolutionary e router falam com o LiteLLM
 * por aqui, e gastavam sem deixar rastro: um painel de custo mostraria $0.69 de
 * junho enquanto a operação real seguia consumindo.
 */
describe('LlmService — registro de custo', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  const respondWith = (usage: Record<string, number>, model = 'groq/llama-3.1-8b-instant') => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model,
        choices: [{ message: { content: 'ok' } }],
        usage,
      }),
    }) as unknown as typeof fetch
  }

  const costsMock = () => ({ record: jest.fn().mockResolvedValue(undefined) }) as unknown as
    CostControllerService & { record: jest.Mock }

  it('grava projeto, modelo resolvido e custo quando há projectId', async () => {
    const costs = costsMock()
    respondWith({ total_tokens: 1000, prompt_tokens: 800, completion_tokens: 200 })

    await new LlmService(costs).chat([{ role: 'user', content: 'oi' }], {
      model: 'gpt-4o-mini',
      caller: 'benchmark:geracao',
      projectId: 'proj-1',
    })

    expect(costs.record).toHaveBeenCalledTimes(1)
    expect(costs.record).toHaveBeenCalledWith({
      projectId: 'proj-1',
      // O modelo que respondeu, não o alias pedido: um fallback silencioso para
      // outro provedor precisa ser visível no painel.
      model:     'groq/llama-3.1-8b-instant',
      tokensIn:  800,
      tokensOut: 200,
      costUsd:   costUsdFor('gpt-4o-mini', 1000),
      module:    'benchmark:geracao',
    })
  })

  it('não grava sem projectId — custo sem dono não é agregável por projeto', async () => {
    const costs = costsMock()
    respondWith({ total_tokens: 500 })

    await new LlmService(costs).chat([{ role: 'user', content: 'oi' }], { model: 'gpt-4o-mini' })

    expect(costs.record).not.toHaveBeenCalled()
  })

  it('não grava chamada de 0 tokens — não houve consumo a atribuir', async () => {
    const costs = costsMock()
    respondWith({ total_tokens: 0 })

    await new LlmService(costs).chat([{ role: 'user', content: 'oi' }], { projectId: 'proj-1' })

    expect(costs.record).not.toHaveBeenCalled()
  })

  it('deriva tokensOut quando o provedor só devolve o total', async () => {
    const costs = costsMock()
    respondWith({ total_tokens: 1000, prompt_tokens: 700 })

    await new LlmService(costs).chat([{ role: 'user', content: 'oi' }], { projectId: 'proj-1' })

    expect(costs.record).toHaveBeenCalledWith(expect.objectContaining({ tokensIn: 700, tokensOut: 300 }))
  })

  it('falha de gravação não derruba a resposta do LLM', async () => {
    const costs = { record: jest.fn().mockRejectedValue(new Error('db down')) } as unknown as CostControllerService
    respondWith({ total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 })

    const res = await new LlmService(costs).chat([{ role: 'user', content: 'oi' }], { projectId: 'proj-1' })

    expect(res.content).toBe('ok')
  })

  it('sem CostControllerService a chamada funciona — a ausência vira log, não crash', async () => {
    respondWith({ total_tokens: 100 })
    const res = await new LlmService().chat([{ role: 'user', content: 'oi' }], { projectId: 'proj-1' })
    expect(res.content).toBe('ok')
  })
})

describe('costUsdFor', () => {
  it('precifica pelo alias pedido', () => {
    expect(costUsdFor('gpt-4o-mini', 1_000_000)).toBeCloseTo(0.10, 6)
    expect(costUsdFor('gpt-4o',      1_000_000)).toBeCloseTo(0.70, 6)
    expect(costUsdFor('gpt-4o-premium', 1_000_000)).toBeCloseTo(9.00, 6)
  })

  it('gpt-local custa zero — mas registra, que é diferente de sumir do painel', () => {
    expect(costUsdFor('gpt-local', 1_000_000)).toBe(0)
  })

  it('alias desconhecido usa o fallback em vez de virar zero silencioso', () => {
    expect(costUsdFor('modelo-que-ninguem-cadastrou', 1_000_000)).toBeCloseTo(COST_PER_1M_FALLBACK, 6)
  })
})
