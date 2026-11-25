import { ProjectStateService, BacklogItem, Milestone } from '../project-state.service'

/**
 * O modelo copia o placeholder do schema como se fosse valor.
 *
 * Medido em 2026-08-17 chamando `rayzen_update_planning`: o `backlog` do
 * ProjectState voltou com DEZ itens e **todos** com `id: "uuid-curto"` — o
 * placeholder literal que o prompt mostrava — mais duas duplicatas exatas.
 * Nada deu erro: a rota respondeu 200 com o dado errado.
 *
 * Consequência: item de backlog não é endereçável. Nada consegue apontar para UM
 * item porque todos respondem pela mesma chave — o mesmo modo de falha que fez o
 * `removeConfirmNextStep` nunca conseguir limpar o órfão (ver planning-node-ids).
 *
 * Mesma família do invariante `hipotese_com_tasktype_valido`, onde o LLM gravou
 * `"classify|summarize|context_synthesis|null"` como taskType.
 *
 * A defesa de verdade foi tirar `id` do prompt — identidade é de quem persiste,
 * não de quem redige. Estes testes cobrem o cinto: o que já está no banco e um
 * modelo que invente o campo mesmo sem ser pedido.
 */
describe('ProjectStateService — backlog e milestone não herdam id placeholder', () => {
  const service = new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const backlog = (value: unknown, previous?: unknown): BacklogItem[] =>
    (service as unknown as {
      normalizeBacklog: (v: unknown, p?: unknown) => BacklogItem[]
    }).normalizeBacklog(value, previous)

  const milestones = (value: unknown, previous?: unknown): Milestone[] =>
    (service as unknown as {
      normalizeMilestones: (v: unknown, p?: unknown) => Milestone[]
    }).normalizeMilestones(value, previous)

  describe('placeholder', () => {
    it.each(['uuid-curto', 'uuid1', 'uuid2', 'uuid-3', 'id', '<id>', '...'])(
      'descarta o id "%s" e cunha um derivado do título',
      (placeholder) => {
        const r = backlog([{ id: placeholder, title: 'Purgar health checks', priority: 'high' }])

        expect(r[0].id).not.toBe(placeholder)
        expect(r[0].id).toContain('purgar-health-checks')
      },
    )

    it('preserva id de verdade', () => {
      const r = backlog([{ id: 'backlog-langfuse-purge', title: 'Purgar health checks', priority: 'low' }])

      expect(r[0].id).toBe('backlog-langfuse-purge')
    })

    it('milestone com uuid1 também é descartado — o guard antigo só pegava uuid-curto', () => {
      // O banco-imob tem `uuid1`/`uuid2` em milestones e `uuid3`/`uuid4` em backlog,
      // de versões anteriores do prompt. O guard anterior comparava só com a string
      // 'uuid-curto', então esses passavam.
      const r = milestones([{ id: 'uuid1', title: 'Desenvolver a arquitetura do jogo', status: 'active' }])

      expect(r[0].id).not.toBe('uuid1')
      expect(r[0].status).toBe('active')
    })
  })

  describe('duplicata', () => {
    it('remove item repetido, ainda que a segunda vez tenha caixa e acento diferentes', () => {
      const r = backlog([
        { title: 'Medir o que o Rayzen entrega hoje', priority: 'high' },
        { title: 'MEDIR O QUE O RAYZEN ENTREGA HOJE', priority: 'low' },
      ])

      expect(r).toHaveLength(1)
      expect(r[0].priority).toBe('high')  // vence a primeira ocorrência
    })
  })

  describe('âncora de id', () => {
    it('reancora pelo título quando a síntese devolve o item sem id', () => {
      const previous = [{ id: 'backlog-purga', title: 'Purgar health checks', priority: 'low' }]
      const r = backlog([{ title: 'Purgar health checks', priority: 'low' }], previous)

      expect(r[0].id).toBe('backlog-purga')
    })

    it('NÃO reancora num id placeholder já gravado — senão o lixo se perpetua', () => {
      const previous = [{ id: 'uuid-curto', title: 'Purgar health checks', priority: 'low' }]
      const r = backlog([{ title: 'Purgar health checks', priority: 'low' }], previous)

      expect(r[0].id).not.toBe('uuid-curto')
    })
  })

  describe('campos', () => {
    it('prioridade inválida vira medium em vez de ir crua para o banco', () => {
      const r = backlog([{ title: 'Item', priority: 'urgentíssimo' }])

      expect(r[0].priority).toBe('medium')
    })

    it('item sem título é descartado — não existe backlog anônimo', () => {
      expect(backlog([{ priority: 'high' }, { title: '   ' }, 'válido'])).toHaveLength(1)
    })

    it('aceita string pura, como o LLM às vezes devolve', () => {
      const r = backlog(['Purgar health checks'])

      expect(r[0]).toMatchObject({ title: 'Purgar health checks', priority: 'medium' })
    })

    it('valor não-array vira lista vazia', () => {
      expect(backlog(null)).toEqual([])
      expect(backlog('texto solto')).toEqual([])
    })
  })
})
