import { ProjectStateService } from '../project-state.service'

/**
 * A síntese confundia ATIVIDADE com INTENÇÃO.
 *
 * `isNoise` classificava por CAMPO (`type`/`intent`), não pela FORMA do conteúdo, e
 * por isso deixava passar como sinal máximo justamente o que mais poluía. Medido no
 * Rayzen AI em 2026-08-17, janela de 7 dias:
 *
 *   292  ecos de ferramenta (`Edit: <caminho>`, `Write: <caminho>`)  — 20 deles com intent='decision'
 *   137  `Workspace alterado: … — <lista de arquivos>`
 *    48  `hook-timing`
 *
 * Nenhum era filtrado: `type: 'note'` escapava por `if (e.type !== 'execution') return false`,
 * e `intent: 'decision'` era tratado como o sinal MAIS FORTE do pipeline. O prompt
 * perguntava "qual é o objetivo deste projeto?" mostrando 80 linhas de caminho de
 * arquivo, e o modelo respondia ao que via.
 *
 * Consequências reais, medidas no banco:
 *   - Rayzen Commerce: objective = "Realizar alterações nos arquivos orders.ts,
 *     package.json e schema.prisma" desde 2026-06-03, **congelado 75 dias**
 *   - Rayzen AI: "Editar o arquivo CLAUDE.md" virou milestone
 *   - marcelorayzen-site: activeFocus = "Análise da estrutura do projeto" desde junho
 *
 * Nada disso deu erro. As rotas responderam 200 com o dado errado o tempo todo.
 */
describe('ProjectStateService — atividade não vira intenção', () => {
  const novoService = () => new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const service = novoService()

  const classificar = (e: { type: string; intent: string | null; content: string }) =>
    (service as unknown as {
      classificarEvento: (e: unknown) => 'ruido' | 'atividade' | 'intencao'
    }).classificarEvento(e)

  const ehDerivado = (s: unknown) =>
    (service as unknown as {
      ehTextoDerivadoDeEvento: (s: unknown) => boolean
    }).ehTextoDerivadoDeEvento(s)

  const resumir = (events: Array<{ content: string }>) =>
    (service as unknown as {
      resumirAtividade: (e: Array<{ content: string }>) => string
    }).resumirAtividade(events)

  describe('classificação por forma, não por campo', () => {
    it('eco de escrita é ATIVIDADE mesmo vindo com intent=decision', () => {
      // 20 dos 292 ecos medidos chegavam assim — e a primeira linha do isNoise
      // antigo (`if (e.intent === 'decision') return false`) os promovia a sinal máximo.
      const tier = classificar({
        type: 'note',
        intent: 'decision',
        content: 'Edit: c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md',
      })

      expect(tier).toBe('atividade')
    })

    it('eco de escrita é ATIVIDADE mesmo com type=note — que era a porta de escape', () => {
      expect(classificar({ type: 'note', intent: null, content: 'Write: /home/user/proj/api.ts' })).toBe('atividade')
      expect(classificar({ type: 'note', intent: null, content: 'Workspace alterado: rayzen-ai [main@85ad502d] — a.ts, b.ts' })).toBe('atividade')
    })

    it('escrita em scratchpad é RUÍDO — arquivo temporário da sessão não é o projeto', () => {
      const tier = classificar({
        type: 'note',
        intent: null,
        content: 'Write: C:\\Users\\marce\\AppData\\Local\\Temp\\claude\\c--proj\\scratchpad\\q1.sql',
      })

      expect(tier).toBe('ruido')
    })

    it('telemetria do hook e eco de leitura são RUÍDO', () => {
      expect(classificar({ type: 'note', intent: null, content: 'hook-timing' })).toBe('ruido')
      expect(classificar({ type: 'execution', intent: null, content: 'Grep: buscar padrão' })).toBe('ruido')
      expect(classificar({ type: 'execution', intent: null, content: 'mcp__rayzen__rayzen_list_projects' })).toBe('ruido')
    })

    it('decisão de verdade continua INTENÇÃO, ainda que cite um caminho no meio da frase', () => {
      // O guard de caminho temporário é checado DENTRO do eco de escrita justamente
      // para não engolir prosa que menciona arquivo.
      const tier = classificar({
        type: 'decision',
        intent: 'decision',
        content: 'Manter onDelete: SetNull em Event/Document — apagar projeto não deve apagar o registro',
      })

      expect(tier).toBe('intencao')
    })

    it('comando de diagnóstico continua RUÍDO, e só quando é execution', () => {
      expect(classificar({ type: 'execution', intent: null, content: 'Bash: verificar status do container' })).toBe('ruido')
      expect(classificar({ type: 'execution', intent: null, content: 'Bash: Commit revenue dashboard' })).toBe('intencao')
    })
  })

  describe('agregado de atividade', () => {
    it('vira contagem por arquivo, não lista de linhas', () => {
      const eventos = [
        { content: 'Edit: c:\\proj\\CLAUDE.md' },
        { content: 'Edit: c:\\proj\\CLAUDE.md' },
        { content: 'Edit: c:\\proj\\api.ts' },
      ]

      expect(resumir(eventos)).toBe('CLAUDE.md (2×), api.ts (1×)')
    })

    it('lê a lista de arquivos do Workspace alterado, que vem depois do travessão', () => {
      const r = resumir([
        { content: 'Workspace alterado: rayzen-ai [main@3da6378e] — ROADMAP.md, .mcp.json' },
      ])

      expect(r).toContain('ROADMAP.md')
      expect(r).toContain('.mcp.json')
      expect(r).not.toContain('main@')
    })

    it('sem atividade não inventa seção', () => {
      expect(resumir([])).toBe('')
    })
  })

  describe('cinto: texto que só repete o que a ferramenta fez', () => {
    it.each([
      'Realizar alterações nos arquivos orders.ts, package.json e schema.prisma',
      'Desenvolver a plataforma Rayzen Commerce com base nas alterações realizadas nos arquivos orders.ts, package.json e schema.prisma',
      'Editar o arquivo CLAUDE.md',
      'Edit: c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md',
      'Workspace alterado: rayzen-ai [main@85ad502d] — .claude/settings.json',
      'Ajustes nos arquivos de configuração',
    ])('rejeita %s', (texto) => {
      expect(ehDerivado(texto)).toBe(true)
    })

    it.each([
      'Sustentar projeto novo sem manutenção',
      'Migrar schema.prisma para multi-schema',            // 1 arquivo não condena
      'Corrigir orders.ts e package.json no build',        // 2 arquivos também não
      'Onboarding de projeto novo ponta a ponta',
      'Purgar traces de health do Langfuse',
    ])('preserva %s', (texto) => {
      expect(ehDerivado(texto)).toBe(false)
    })

    it('três nomes de arquivo já configuram lista, mesmo sem verbo de edição', () => {
      expect(ehDerivado('orders.ts, package.json, schema.prisma')).toBe(true)
    })
  })

  describe('milestone e backlog derivados de evento são descartados na normalização', () => {
    const milestones = (v: unknown) =>
      (service as unknown as { normalizeMilestones: (v: unknown) => unknown[] }).normalizeMilestones(v)
    const backlog = (v: unknown) =>
      (service as unknown as { normalizeBacklog: (v: unknown) => unknown[] }).normalizeBacklog(v)

    it('descarta o milestone que o Rayzen AI carregava', () => {
      const r = milestones([
        { title: 'Editar o arquivo CLAUDE.md', status: 'active' },
        { title: 'Onboarding de projeto novo validado ponta a ponta', status: 'done' },
      ])

      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ title: 'Onboarding de projeto novo validado ponta a ponta' })
    })

    it('vale para backlog também', () => {
      expect(backlog([{ title: 'Edit: src/api.ts', priority: 'high' }])).toHaveLength(0)
    })
  })
})

/**
 * Os testes acima exercitam as funções auxiliares. Estes exercitam **o caminho que
 * roda** — `refresh()` de ponta a ponta, com Prisma e LLM mockados.
 *
 * A distinção não é acadêmica: em 2026-08-17 um teste desta base passou 11/11 com o
 * defeito reintroduzido, porque testava o auxiliar e não o caminho real.
 */
describe('ProjectStateService.refresh — caminho real', () => {
  const criarEventos = () => ([
    { ts: new Date('2026-08-17T10:00:00Z'), type: 'note', intent: 'decision', content: 'Edit: c:\\proj\\orders.ts', metadata: null },
    { ts: new Date('2026-08-17T09:00:00Z'), type: 'note', intent: null, content: 'Edit: c:\\proj\\package.json', metadata: null },
    { ts: new Date('2026-08-17T08:00:00Z'), type: 'note', intent: null, content: 'Write: c:\\proj\\schema.prisma', metadata: null },
    { ts: new Date('2026-08-17T07:00:00Z'), type: 'note', intent: null, content: 'hook-timing', metadata: null },
    { ts: new Date('2026-08-17T06:00:00Z'), type: 'decision', intent: 'decision', content: 'Fechar a V1 do Commerce e migrar o checkout', metadata: null },
  ])

  /** Monta o serviço com todas as dependências mockadas e o LLM sob controle. */
  const montar = (
    respostaLlm: object,
    existing: Record<string, unknown> | null = null,
    meta: { title: string; description?: string; successCriteria?: unknown } | null = null,
  ) => {
    const upsert = jest.fn().mockImplementation(({ create, update }) => ({
      id: 'st1',
      projectId: 'p1',
      graphLinks: [],
      updatedAt: new Date('2026-08-17T11:00:00Z'),
      ...(existing ? update : create),
    }))
    const create = jest.fn().mockResolvedValue(null)

    const prisma = {
      project:          { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'Rayzen Commerce Platform', description: null, goals: null }) },
      projectState:     { findUnique: jest.fn().mockResolvedValue(existing), upsert },
      event:            { findMany: jest.fn().mockResolvedValue(criarEventos()) },
      sessionArtifact:  { findMany: jest.fn().mockResolvedValue([]) },
      projectDocument:  { findMany: jest.fn().mockResolvedValue([]) },
      projectGoal:      { findFirst: jest.fn().mockResolvedValue(meta) },
      conversationMessage: { create },
    }

    const service = new ProjectStateService(
      prisma as never,
      { get: () => undefined } as never,
      { compute: jest.fn().mockResolvedValue(null) } as never,
      { promoteStaleEvents: jest.fn().mockResolvedValue(null) } as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() } } as never,
      { getConfig: () => ({}) } as never,
    )

    const completions = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(respostaLlm) } }],
      usage: { total_tokens: 10 },
    })
    ;(service as unknown as { llm: unknown }).llm = { chat: { completions: { create: completions } } }

    return { service, upsert, completions }
  }

  const promptDe = (completions: jest.Mock): string =>
    completions.mock.calls[0][0].messages[0].content

  it('não persiste o objetivo derivado de arquivo que o Commerce carrega desde junho', async () => {
    const { service, upsert } = montar({
      objective: 'Realizar alterações nos arquivos orders.ts, package.json e schema.prisma',
      stage: 'building', blockers: [], recentDecisions: [], nextSteps: [], risks: [],
      docGaps: [], riskLevel: 'low', milestones: [], backlog: [], activeFocus: '', definitionOfDone: '',
    })

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].create.objective).not.toContain('orders.ts')
    expect(upsert.mock.calls[0][0].create.objective).toBe('')
  })

  it('recua para o objetivo já gravado quando ele é limpo, em vez de zerar', async () => {
    const { service, upsert } = montar(
      {
        objective: 'Editar o arquivo CLAUDE.md',
        stage: 'building', blockers: [], recentDecisions: [], nextSteps: [], risks: [],
        docGaps: [], riskLevel: 'low', milestones: [], backlog: [], activeFocus: '', definitionOfDone: '',
      },
      { objective: 'Lançar o checkout do Commerce', activeFocus: null, updatedAt: new Date('2026-08-16T00:00:00Z'), blockers: [], nextSteps: [], recentDecisions: [], risks: [], backlog: [], milestones: [], graphLinks: [] },
    )

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].update.objective).toBe('Lançar o checkout do Commerce')
  })

  it('não persiste activeFocus derivado de arquivo, e não o herda do estado anterior', async () => {
    // Herdar é o que trava "Desenvolvimento do QA Scientist" por semanas.
    const { service, upsert } = montar(
      {
        objective: 'Lançar o checkout', stage: 'building', blockers: [], recentDecisions: [],
        nextSteps: [], risks: [], docGaps: [], riskLevel: 'low', milestones: [], backlog: [],
        activeFocus: 'Alterações nos arquivos orders.ts, package.json e schema.prisma',
        definitionOfDone: '',
      },
      { objective: 'Lançar o checkout', activeFocus: 'Desenvolvimento do QA Scientist', updatedAt: new Date('2026-08-16T00:00:00Z'), blockers: [], nextSteps: [], recentDecisions: [], risks: [], backlog: [], milestones: [], graphLinks: [] },
    )

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].update.activeFocus).toBeNull()
  })

  /**
   * O objetivo não se pede ao modelo quando existe meta ativa — mesma lição do `id`.
   *
   * Medido sobre os 939 refreshes reais do Rayzen AI: 105 núcleos de objetivo distintos
   * em 85 dias, 76,8% das trocas substituindo a primeira oração inteira, com meta ativa
   * disponível quase o tempo todo. A instrução equivalente já existia no prompt.
   */
  describe('objetivo ancorado na meta ativa', () => {
    const resposta = (objective: string) => ({
      objective, stage: 'building', blockers: [], recentDecisions: [], nextSteps: [],
      risks: [], docGaps: [], riskLevel: 'low', milestones: [], backlog: [],
      activeFocus: '', definitionOfDone: '',
    })

    it('ignora o objetivo do LLM e usa o título da meta', async () => {
      const { service, upsert } = montar(
        resposta('Corrigir a inicialização dos módulos agent-session e Telegram'),
        null,
        { title: 'Rayzen serve um projeto que nao e ele mesmo' },
      )

      await service.refresh('p1')

      expect(upsert.mock.calls[0][0].create.objective).toBe('Rayzen serve um projeto que nao e ele mesmo')
    })

    it('é estável entre refreshes ainda que o LLM proponha algo novo a cada vez', async () => {
      const meta = { title: 'Rayzen serve um projeto que nao e ele mesmo' }
      const objetivos: string[] = []

      for (const proposta of ['Corrigir o agent-session', 'Implementar a fase 3', 'Ajustar o Telegram']) {
        const { service, upsert } = montar(resposta(proposta), null, meta)
        await service.refresh('p1')
        objetivos.push(upsert.mock.calls[0][0].create.objective as string)
      }

      expect(new Set(objetivos).size).toBe(1)
    })

    it('sem meta ativa, a síntese volta a valer', async () => {
      const { service, upsert } = montar(resposta('Lançar o checkout do Commerce'), null, null)

      await service.refresh('p1')

      expect(upsert.mock.calls[0][0].create.objective).toBe('Lançar o checkout do Commerce')
    })
  })

  it('descarta o milestone derivado de evento antes de gravar', async () => {
    const { service, upsert } = montar({
      objective: 'Lançar o checkout', stage: 'building', blockers: [], recentDecisions: [],
      nextSteps: [], risks: [], docGaps: [], riskLevel: 'low',
      milestones: [
        { title: 'Editar o arquivo CLAUDE.md', status: 'active' },
        { title: 'Implementar sistema de pagamento', status: 'pending' },
      ],
      backlog: [], activeFocus: '', definitionOfDone: '',
    })

    await service.refresh('p1')

    const gravados = upsert.mock.calls[0][0].create.milestones as Array<{ title: string }>
    expect(gravados.map(m => m.title)).toEqual(['Implementar sistema de pagamento'])
  })

  describe('o prompt que chega ao modelo', () => {
    const respostaVazia = {
      objective: 'Lançar o checkout', stage: 'building', blockers: [], recentDecisions: [],
      nextSteps: [], risks: [], docGaps: [], riskLevel: 'low', milestones: [], backlog: [],
      activeFocus: '', definitionOfDone: '',
    }

    it('não lista eco de ferramenta como linha de evento', async () => {
      const { service, completions } = montar(respostaVazia)
      await service.refresh('p1')
      const prompt = promptDe(completions)

      // O bloco de eventos vai até a seção de atividade; nenhum `Edit:` cru ali.
      const blocoEventos = prompt.slice(0, prompt.indexOf('ATIVIDADE —'))
      expect(blocoEventos).not.toContain('Edit: c:\\proj\\orders.ts')
      expect(blocoEventos).toContain('Fechar a V1 do Commerce')
    })

    it('apresenta a atividade agregada e rotulada como não-intenção', async () => {
      const { service, completions } = montar(respostaVazia)
      await service.refresh('p1')
      const prompt = promptDe(completions)

      expect(prompt).toContain('ATIVIDADE — arquivos tocados')
      expect(prompt).toContain('orders.ts (1×)')
      expect(prompt).toContain('NÃO é enunciado de intenção')
    })

    it('proíbe explicitamente lista de arquivo como objetivo', async () => {
      const { service, completions } = montar(respostaVazia)
      await service.refresh('p1')

      expect(promptDe(completions)).toContain('PROIBIDO em objective')
    })

    it('não realimenta o foco antigo quando ele é derivado de evento', async () => {
      const { service, completions } = montar(respostaVazia, {
        objective: 'Atualizar Portfolio',
        activeFocus: 'Alterações nos arquivos orders.ts, package.json e schema.prisma',
        updatedAt: new Date('2026-08-16T00:00:00Z'),
        blockers: [], nextSteps: [], recentDecisions: [], risks: [], backlog: [], milestones: [], graphLinks: [],
      })
      await service.refresh('p1')

      expect(promptDe(completions)).toContain('Foco ativo atual: não definido')
    })
  })

  /**
   * Limpeza na LEITURA — mesmo princípio já usado para o `uuid-curto` do backlog.
   * Sem isso o objetivo do Commerce continuaria sendo injetado em todo contexto até
   * alguém rodar um refresh bem-sucedido, e o valor gravado sobreviveria a qualquer
   * conserto de prompt.
   */
  it('serialize não serve objetivo nem foco derivados de evento já gravados', () => {
    const { service } = montar({})

    const r = service.serialize({
      id: 's', projectId: 'p1',
      objective: 'Realizar alterações nos arquivos orders.ts, package.json e schema.prisma',
      stage: 'building', blockers: [], recentDecisions: [], nextSteps: [], risks: [], docGaps: [],
      riskLevel: 'low', milestones: [], graphLinks: [], backlog: [],
      activeFocus: 'Alterações nos arquivos orders.ts, package.json e schema.prisma',
      definitionOfDone: null, updatedAt: new Date('2026-08-17T00:00:00Z'),
    })

    expect(r.objective).toBe('')
    expect(r.activeFocus).toBe('')
  })

  /**
   * O outro modo de falha do activeFocus NÃO é eco de ferramenta: `Análise da estrutura
   * do projeto` (marcelorayzen-site, congelado desde junho) e `Desenvolvimento do QA
   * Scientist` (Rayzen AI, semanas) são prosa legítima que apenas envelheceu. O cinto
   * não os pega de propósito — descartar prosa válida por suspeita seria pior. Quem
   * responde por eles é a regra de reavaliação no prompt e o fato de o foco não ser
   * mais herdado do estado anterior.
   */
  it('prosa legítima que apenas envelheceu NÃO é confundida com eco de ferramenta', () => {
    const { service } = montar({})
    const ehDerivado = (s: unknown) =>
      (service as unknown as { ehTextoDerivadoDeEvento: (s: unknown) => boolean }).ehTextoDerivadoDeEvento(s)

    expect(ehDerivado('Análise da estrutura do projeto')).toBe(false)
    expect(ehDerivado('Desenvolvimento do QA Scientist')).toBe(false)
  })
})
