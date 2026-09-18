import { ProjectStateService, PlanningNode } from '../project-state.service'

/**
 * Estabilidade do id de nextSteps/blockers entre refreshes.
 *
 * Bug real (2026-08-07, visto no banco de produção): o estado do projeto tinha DOIS
 * next-steps para o mesmo critério —
 *   `confirmar-b3`                            "Confirmar critério concluído: ...Langfuse"
 *   `next-2-confirmar-criterio-concluido-cri` "Confirmar critério concluído: ...Langfuse"
 *
 * Cadeia: warnPendingGoalProposals grava `confirmar-<criteriaId>` → o refresh seguinte
 * manda ao LLM só os TÍTULOS do estado atual → o LLM devolve o passo sem id →
 * legacyId() cunha `next-<i>-<slug>` e o id semântico morre → o checkpoint seguinte não
 * encontra `confirmar-b3` no dedup e adiciona de novo → e removeConfirmNextStep, que
 * procura por id exato, nunca consegue limpar o órfão. Um item novo por ciclo, para
 * sempre, injetado em "Próximos passos" de toda sessão pelo hook.
 */
describe('ProjectStateService — id de planning node sobrevive ao refresh', () => {
  const service = new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const normalize = (value: unknown, prefix: 'blocker' | 'next', previous?: unknown): PlanningNode[] =>
    (service as unknown as {
      normalizePlanningNodes: (v: unknown, p: 'blocker' | 'next', prev?: unknown) => PlanningNode[]
    }).normalizePlanningNodes(value, prefix, previous)

  const CONFIRM_TITLE = 'Confirmar critério concluído: traces dos specialists visíveis no Langfuse'

  it('reancora o id pelo título quando a síntese devolve o item sem id', () => {
    const previous = [{ id: 'confirmar-b3', title: CONFIRM_TITLE }]
    // Como o LLM devolve: string pura, sem id.
    const derived = [CONFIRM_TITLE]

    const result = normalize(derived, 'next', previous)

    expect(result).toEqual([{ id: 'confirmar-b3', title: CONFIRM_TITLE }])
  })

  it('reancora mesmo com diferença de acento, caixa e pontuação no título', () => {
    const previous = [{ id: 'confirmar-b3', title: CONFIRM_TITLE }]
    const derived = [{ title: 'confirmar criterio concluido: traces dos specialists visiveis no langfuse' }]

    const result = normalize(derived, 'next', previous)

    expect(result[0].id).toBe('confirmar-b3')
  })

  it('não duplica quando o estado já tem o órfão e o id canônico ao mesmo tempo', () => {
    // Exatamente o estado corrompido encontrado no banco.
    const previous = [
      { id: 'next-2-confirmar-criterio-concluido-cri', title: CONFIRM_TITLE },
      { id: 'confirmar-b3', title: CONFIRM_TITLE },
    ]

    const result = normalize(previous, 'next', previous)

    expect(result).toHaveLength(1)
  })

  it('mantém o id explícito quando a síntese devolve um', () => {
    const previous = [{ id: 'confirmar-b3', title: CONFIRM_TITLE }]
    const derived = [{ id: 'id-explicito', title: CONFIRM_TITLE }]

    expect(normalize(derived, 'next', previous)[0].id).toBe('id-explicito')
  })

  it('cunha legacyId para item novo que não existia antes', () => {
    const result = normalize(['Religar o ciclo do QA Scientist'], 'next', [])

    expect(result[0].id).toBe('next-0-religar-o-ciclo-do-qa-scientist')
  })

  it('é estável ao longo de vários refreshes seguidos', () => {
    // O bug só aparecia na repetição: um id novo por ciclo.
    let state: PlanningNode[] = [{ id: 'confirmar-b3', title: CONFIRM_TITLE }]
    for (let i = 0; i < 5; i++) {
      const fromLlm = state.map(s => s.title)   // síntese devolve só títulos
      state = normalize(fromLlm, 'next', state)
    }

    expect(state).toEqual([{ id: 'confirmar-b3', title: CONFIRM_TITLE }])
  })

  it('não confunde itens diferentes que compartilham prefixo', () => {
    const previous = [
      { id: 'confirmar-b1', title: 'Confirmar critério concluído: missão de 3 steps' },
      { id: 'confirmar-b3', title: CONFIRM_TITLE },
    ]

    const result = normalize(previous.map(p => p.title), 'next', previous)

    expect(result.map(r => r.id)).toEqual(['confirmar-b1', 'confirmar-b3'])
  })

  it('preserva o comportamento antigo quando não há estado anterior', () => {
    expect(normalize(['Passo A', { title: 'Passo B' }], 'next')).toEqual([
      { id: 'next-0-passo-a', title: 'Passo A' },
      { id: 'next-1-passo-b', title: 'Passo B' },
    ])
  })

  it('descarta entradas inválidas e mantém description', () => {
    const result = normalize(
      [null, 42, { title: '   ' }, { title: 'Válido', description: ' com descrição ' }],
      'blocker',
    )

    expect(result).toEqual([{ id: 'blocker-3-valido', title: 'Válido', description: 'com descrição' }])
  })
})
