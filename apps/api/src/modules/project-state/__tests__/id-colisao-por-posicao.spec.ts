import { ProjectStateService, PlanningNode, BacklogItem, Milestone } from '../project-state.service'

/**
 * `legacyId(prefix, title, index)` usa a POSIÇÃO do item no array como parte do id — e essa
 * posição não é um contador estável. Um item reancorado (`idsAnteriores`) carrega o índice de
 * QUANDO foi cunhado originalmente, possivelmente semanas atrás; um item genuinamente novo
 * ganha o índice de HOJE. Os dois podem coincidir, e se o slug de 32 caracteres também
 * coincidir, o id sai IDÊNTICO — duas identidades diferentes respondendo pela mesma chave.
 *
 * Medido em produção em 2026-09-11 (Rayzen AI): o QA Scientist (`gpt-local`) abriu uma
 * recomendação `consistency` de severidade `high` apontando "Duplicate ID in Structured State
 * Next Steps — Two next steps share the same ID 'next-3'". O `nextSteps` real continha:
 *
 *   next-3-implementar-medicao-de-volume-de   (reancorado, cunhado numa rodada antiga)
 *   next-3-medir-latencia-real-de-modelos-l   (novo, cunhado hoje na posição 3)
 *
 * **As duas strings completas não eram idênticas** — colidiam só no prefixo `next-3-`,
 * porque os slugs de 32 chars divergiam a partir do 8º caractere. O primeiro teste abaixo
 * fixa esse dado exato como âncora de regressão, mas ele passaria mesmo sem a correção: o
 * caso real foi um quase-acerto, não uma colisão de fato. Quem prova que a correção importa
 * é o segundo teste, construído para colidir em STRING EXATA — o mecanismo é o mesmo, só a
 * sorte do slug diverge é que salvou a produção desta vez.
 *
 * A cura (`cunharId`) não muda o formato do id — nenhuma migração é necessária para o que já
 * está gravado — só garante que um id novo nunca reutiliza um que já está em jogo nesta
 * passada, reancorado ou recém-cunhado.
 */
describe('ProjectStateService — id não colide entre item reancorado e item novo', () => {
  const service = new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const nextSteps = (value: unknown, previous?: unknown): PlanningNode[] =>
    (service as unknown as {
      normalizePlanningNodes: (v: unknown, p: 'blocker' | 'next', prev?: unknown) => PlanningNode[]
    }).normalizePlanningNodes(value, 'next', previous)

  const backlog = (value: unknown, previous?: unknown): BacklogItem[] =>
    (service as unknown as {
      normalizeBacklog: (v: unknown, p?: unknown) => BacklogItem[]
    }).normalizeBacklog(value, previous)

  const milestones = (value: unknown, previous?: unknown): Milestone[] =>
    (service as unknown as {
      normalizeMilestones: (v: unknown, p?: unknown) => Milestone[]
    }).normalizeMilestones(value, previous)

  const semDuplicata = (ids: string[]) => new Set(ids).size === ids.length

  it('âncora do dado real de produção: nada se perde, nada colide — mas este caso nunca colidiu em string exata', () => {
    const previous = [
      { id: 'next-3-implementar-medicao-de-volume-de', title: 'Implementar medição de volume de documentação como métrica de validação' },
    ]
    const derived = [
      'Analisar resultados do spike Groq e atualizar configuração do provedor',
      'Medir variação de conteúdo e frequência de regenerações para garantir ausência de duplicação',
      'Implementar medição de volume de documentação como métrica de validação',
      'Medir latência real de modelos locais versus modelos em nuvem',
      'Atualizar script de limpeza do cron e garantir registro de falhas',
    ]

    const result = nextSteps(derived, previous)

    expect(result).toHaveLength(5)
    expect(semDuplicata(result.map(r => r.id))).toBe(true)
    expect(result.find(r => r.title.startsWith('Implementar medição'))?.id)
      .toBe('next-3-implementar-medicao-de-volume-de')
  })

  /**
   * Colisão forçada em STRING EXATA — o caso que a correção existe para fechar.
   *
   * Dois títulos diferentes, construídos para que `legacyId` gere o MESMO slug de 32
   * caracteres para os dois (um prefixo comum de 32 letras, antes de qualquer texto que os
   * distinga — o corte em 32 chars nunca alcança a parte que diverge). Um deles é reancorado
   * com um id que embute o índice 1; o outro é um item novo que cai exatamente na posição 1
   * do array de hoje. Sem o guard, os dois ids saem BYTE A BYTE IGUAIS.
   */
  it('resolve colisão em string exata — mesmo slug de 32 chars, mesmo índice', () => {
    const slugComum = 'x'.repeat(32)
    const tituloA = `${slugComum} tarefa numero um`
    const tituloB = `${slugComum} tarefa numero dois totalmente diferente`
    const idReancorado = `next-1-${slugComum}`

    const previous = [{ id: idReancorado, title: tituloA }]
    const derived  = [tituloA, tituloB] // tituloB cai no índice 1 — o mesmo que idReancorado embute

    const result = nextSteps(derived, previous)

    expect(result).toHaveLength(2)
    expect(semDuplicata(result.map(r => r.id))).toBe(true)
    expect(result[0].id).toBe(idReancorado)        // reancorado, intacto
    expect(result[1].id).not.toBe(idReancorado)     // novo, NÃO pode ter roubado o id do outro
  })

  it('a mesma colisão forçada, reproduzida em backlog', () => {
    const slugComum = 'y'.repeat(32)
    const tituloA = `${slugComum} item um`
    const tituloB = `${slugComum} item dois bem diferente do primeiro`
    const idReancorado = `backlog-1-${slugComum}`

    const previous = [{ id: idReancorado, title: tituloA, priority: 'low' }]
    const derived  = [tituloA, tituloB]

    const result = backlog(derived, previous)

    expect(result).toHaveLength(2)
    expect(semDuplicata(result.map(r => r.id))).toBe(true)
    expect(result[0].id).toBe(idReancorado)
    expect(result[1].id).not.toBe(idReancorado)
  })

  it('a mesma colisão forçada, reproduzida em milestones', () => {
    const slugComum = 'z'.repeat(32)
    const tituloA = `${slugComum} marco um`
    const tituloB = `${slugComum} marco dois bem diferente do primeiro`
    const idReancorado = `milestone-1-${slugComum}`

    const previous = [{ id: idReancorado, title: tituloA, status: 'done' }]
    const derived  = [{ title: tituloA }, { title: tituloB }]

    const result = milestones(derived, previous)

    expect(result).toHaveLength(2)
    expect(semDuplicata(result.map(r => r.id))).toBe(true)
    expect(result[0].id).toBe(idReancorado)
    expect(result[1].id).not.toBe(idReancorado)
  })

  it('sem colisão nenhuma, o comportamento de antes não muda', () => {
    // Garante que o guard é passivo: quando não há conflito, os ids saem exatamente como
    // `legacyId` sempre produziu — mesmo teste de regressão que já existia para isto.
    const result = nextSteps(['Passo A', { title: 'Passo B' }])

    expect(result).toEqual([
      { id: 'next-0-passo-a', title: 'Passo A' },
      { id: 'next-1-passo-b', title: 'Passo B' },
    ])
  })
})
