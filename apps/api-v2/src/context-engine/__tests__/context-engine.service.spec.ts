import { ContextEngineService } from '../context-engine.service'

/**
 * O ProjectState era injetado como `Objective` + `Stage`, sem data nenhuma.
 *
 * Toda linha de `recent_events` carrega timestamp; a seção mais categórica do contexto
 * — a que diz o que o projeto ESTÁ fazendo — não carregava. Medido em 2026-08-16 no
 * critério b2: o banco-imob servia um estado sintetizado em 27/05, **81 dias** antes,
 * com exatamente a mesma aparência do estado do Rayzen AI, sintetizado naquele dia.
 *
 * Estado velho apresentado como atual é pior que estado ausente: ausente se percebe,
 * velho não. E aqui não era bug de síntese — ninguém tocou o projeto em 81 dias, então
 * não havia o que sintetizar. O defeito é a omissão da idade, não a idade.
 */
describe('ContextEngineService — frescor do ProjectState', () => {
  function build(marco: Date, eventosDesdeMarco: number, eventos24h = 0, usarContentChangedAt = true) {
    const v1Bridge = {
      getProjectState: jest.fn().mockResolvedValue({
        objective: 'Desenvolver a arquitetura do jogo',
        stage:     'building',
        // `updatedAt` é a marca d'água do refresh e avança em TODA escrita; por isso
        // o teste a mantém sempre recente. Quem responde por idade é contentChangedAt.
        updatedAt: new Date(),
        ...(usarContentChangedAt ? { contentChangedAt: marco } : {}),
      }),
      // O serviço pergunta duas coisas: acumulado desde o marco e volume nas últimas
      // 24h. A distinção é o que separa projeto morto de trabalho em curso.
      countEventsSince: jest.fn().mockImplementation((_id: string, desde: Date) =>
        Promise.resolve(desde.getTime() >= Date.now() - 86_400_000 - 5_000 ? eventos24h : eventosDesdeMarco),
      ),
    }
    const service = new ContextEngineService(
      v1Bridge as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    return { service, v1Bridge }
  }

  function diasAtras(dias: number): Date {
    return new Date(Date.now() - dias * 86_400_000)
  }

  async function secaoEstado(marco: Date, eventos = 0, eventos24h = 0, usarContentChangedAt = true): Promise<string> {
    const { service } = build(marco, eventos, eventos24h, usarContentChangedAt)
    const ctx = await service.build({ projectId: 'proj-1', include: ['project_state'] })
    return ctx.sections.project_state ?? ''
  }

  it('chama de PARADO o estado antigo sem eventos — o estado está certo, ninguém tocou', async () => {
    // banco-imob: 82 dias, 1 evento. A descrição não está errada, só velha.
    const secao = await secaoEstado(diasAtras(81), 1, 0)

    expect(secao).toContain('Objective: Desenvolver a arquitetura do jogo')
    expect(secao).toContain('81 dia')
    expect(secao).toContain('parado')
  })

  /**
   * Regressão medida em produção em 2026-08-17, com o sinal já no ar.
   *
   * A primeira versão do limiar usava a contagem ACUMULADA desde a última mudança de
   * conteúdo, e errava em quatro dos oito projetos: Ray coach (99 dias, 138 eventos
   * acumulados, **zero nas últimas 24h**), VB Ferragens (77 dias, 73, zero) e
   * marcelorayzen-site (50 dias, 111, zero) eram chamados de "atrasados" quando estão
   * simplesmente mortos. Em projeto abandonado o acumulado só cresce, então o aviso
   * vira permanente — que é exatamente o que se aprende a ignorar.
   */
  it('projeto morto com muito evento ACUMULADO é parado, não atrasado', async () => {
    const secao = await secaoEstado(diasAtras(99), 138, 0)

    expect(secao).toContain('parado')
    expect(secao).not.toContain('atrasada')
  })

  /**
   * O caso que a versão por `updatedAt` nunca enxergava.
   *
   * Rayzen Commerce Platform, medido em 2026-08-17: o refresh das 04:07 consumiu
   * commits reais e reescreveu a linha mantendo o objetivo de 24/06 intacto. Como
   * `updatedAt` avança em toda escrita, o contador zerou e o contexto ficou calado —
   * corretamente, pelas regras antigas — sobre um estado que descrevia outro mês.
   * Pior que a ausência do sinal: a data atestava um frescor que o texto não tinha.
   */
  /**
   * Rayzen Commerce, o caso que motivou a coluna: 54 dias com a descrição parada e
   * **67 dos 68 eventos concentrados em hoje**. É o que a versão por `updatedAt` nunca
   * via, porque ela dizia "0 dias".
   */
  it('chama de ATRASADO o que não anda enquanto há trabalho AGORA', async () => {
    const secao = await secaoEstado(diasAtras(54), 68, 67)

    expect(secao).toContain('67 eventos só nas últimas 24h')
    expect(secao).toContain('atrasada')
    expect(secao).not.toContain('parado')
  })

  /**
   * Sessão normal de trabalho não é descompasso. O Rayzen AI faz ~770 eventos/dia;
   * sem o piso em dias, todo dia de trabalho num projeto saudável dispararia o aviso.
   */
  it('um dia de trabalho intenso sobre descrição recente NÃO é atraso', async () => {
    const secao = await secaoEstado(diasAtras(1), 422, 770)

    expect(secao).toContain('Objective: Desenvolver a arquitetura do jogo')
    expect(secao).not.toMatch(/inalterada/)
  })

  it('fica calado quando não há descompasso — nem dias, nem eventos', async () => {
    // Um aviso em todo prompt treina a ignorar o aviso, mesmo princípio dos invariantes.
    const secao = await secaoEstado(diasAtras(1), 3, 3)

    expect(secao).toContain('Objective: Desenvolver a arquitetura do jogo')
    expect(secao).not.toMatch(/inalterada/)
  })

  it('não avisa em cima do limiar de dias, avisa a partir dele', async () => {
    expect(await secaoEstado(diasAtras(6), 0, 0)).not.toMatch(/inalterada/)
    expect(await secaoEstado(diasAtras(7), 0, 0)).toContain('7 dias')
  })

  it('não avisa em cima do limiar de eventos recentes, avisa a partir dele', async () => {
    expect(await secaoEstado(diasAtras(30), 100, 39)).not.toContain('atrasada')
    expect(await secaoEstado(diasAtras(30), 100, 40)).toContain('atrasada')
  })

  it('exige os DOIS: piso de dias e volume recente', async () => {
    expect(await secaoEstado(diasAtras(1), 500, 500)).not.toMatch(/inalterada/)  // recente demais
    expect(await secaoEstado(diasAtras(2), 500, 500)).toContain('atrasada')
  })

  it('ATRASADO vence PARADO quando os dois se aplicam — o descompasso é a notícia', async () => {
    const secao = await secaoEstado(diasAtras(90), 400, 400)

    expect(secao).toContain('atrasada')
    expect(secao).not.toContain('parado')
  })

  /**
   * Enquanto o backfill não passou, `contentChangedAt` é nulo. Recuar para `updatedAt`
   * mantém o comportamento conservador — o sinal fica calado em vez de acusar uma
   * velhice que ainda não sabe medir.
   */
  it('recua para updatedAt quando contentChangedAt ainda é nulo', async () => {
    const secao = await secaoEstado(diasAtras(81), 0, 0, false)

    expect(secao).toContain('Objective: Desenvolver a arquitetura do jogo')
    expect(secao).not.toMatch(/inalterada/)
  })
})

/**
 * `policy_constraints` era 349 chars IDÊNTICOS em todo projeto, todo prompt, todo modo —
 * 10,7% do orçamento no Rayzen AI, 16,3% no Commerce, 8,3% no banco-imob (medido em
 * 2026-08-20, critério m5 da meta ativa).
 *
 * O corte não é por importância, é por **quem faz cumprir**: `block` e `warn` são aplicados
 * no servidor na hora da escrita (`knowledge-storage.service.ts` lança ForbiddenException),
 * então quem lê o contexto não consegue violá-las. `gate` é o oposto: o ApprovalGate só
 * cobre o workflow engine, e um deploy por `git push` nunca passa por lá — ali o texto é o
 * único portador da norma.
 */
describe('ContextEngineService — policy_constraints só carrega o que o leitor pode aplicar', () => {
  function build(rules: Array<{ name: string; action: string; description: string; enabled: boolean; projectId: string | null }>) {
    const policy = { listRules: jest.fn().mockResolvedValue(rules) }
    const service = new ContextEngineService(
      {} as never, {} as never, {} as never, policy as never, {} as never,
    )
    // `fetchSection` é privado — este é o ponto de entrada real da seção.
    const secao = (): Promise<string> =>
      (service as unknown as { fetchSection: (s: string, r: unknown) => Promise<string> })
        .fetchSection('policy_constraints', { projectId: 'p1' })
    return { secao, policy }
  }

  const sistema = (name: string, action: string) =>
    ({ name, action, description: `desc de ${name}`, enabled: true, projectId: null })

  it('regra `gate` entra — o ApprovalGate não cobre deploy por git push', async () => {
    const { secao } = build([sistema('deployment_requires_review', 'gate')])
    expect(await secao()).toContain('[GATE] deployment_requires_review')
  })

  it('regra `block` NÃO entra — o servidor rejeita a escrita, o leitor não pode violar', async () => {
    const { secao } = build([sistema('low_confidence_knowledge', 'block')])
    expect(await secao()).toBe('')
  })

  it('regra `warn` NÃO entra — vira metadata no servidor, não decisão de quem lê', async () => {
    const { secao } = build([sistema('memory_requires_source', 'warn')])
    expect(await secao()).toBe('')
  })

  it('o conjunto real de produção cai de 3 linhas para 1', async () => {
    const { secao } = build([
      sistema('deployment_requires_review', 'gate'),
      sistema('low_confidence_knowledge', 'block'),
      sistema('memory_requires_source', 'warn'),
    ])
    const texto = await secao()
    expect(texto.split('\n').filter(Boolean)).toHaveLength(1)
    expect(texto).toContain('deployment_requires_review')
  })

  it('regra DE PROJETO entra mesmo sendo `warn` — é curadoria explícita, não default', async () => {
    const { secao } = build([{ name: 'nao_tocar_migrations', action: 'warn', description: 'x', enabled: true, projectId: 'p1' }])
    expect(await secao()).toContain('[WARN] nao_tocar_migrations')
  })

  it('regra desabilitada continua fora, como antes', async () => {
    const { secao } = build([{ ...sistema('code_requires_adr', 'gate'), enabled: false }])
    expect(await secao()).toBe('No active policy constraints.')
  })
})

/**
 * Critério m4: projeto parado não pode receber MAIS contexto que projeto ativo.
 *
 * Medido em 2026-08-20, mesma consulta nos 3 projetos: o banco-imob (85 dias parado)
 * recebia 4.200 chars contra 3.248 do Rayzen AI, e a maior fatia da diferença estava em
 * `Recent Activity` — 1.218 contra 765. A causa não é volume: `getRecentEvents(id, 10)`
 * traz os 10 últimos SEM olhar data, e os eventos de maio do banco-imob são payloads
 * crus de Grep/Glob, anteriores ao filtro de sinal do hook (16/08).
 */
describe('ContextEngineService — "recente" em recent_events precisa significar recente', () => {
  function build(eventos: Array<{ ts: Date; type: string; content: string }>) {
    const v1Bridge = { getRecentEvents: jest.fn().mockResolvedValue(eventos) }
    const service = new ContextEngineService(
      v1Bridge as never, {} as never, {} as never, {} as never, {} as never,
    )
    const secao = (): Promise<string> =>
      (service as unknown as { fetchSection: (s: string, r: unknown) => Promise<string> })
        .fetchSection('recent_events', { projectId: 'p1' })
    return { secao, v1Bridge }
  }

  const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000)
  const ev = (dias: number, content = 'Bash: rodar testes') =>
    ({ ts: diasAtras(dias), type: 'execution', content })

  it('evento de hoje entra', async () => {
    expect(await build([ev(0)]).secao()).toContain('execution')
  })

  it('projeto parado há meses NÃO enche a cota — a seção some', async () => {
    // o banco-imob real: 9 eventos de maio + 1 recente
    const { secao } = build([ev(85), ev(86), ev(86), ev(87), ev(90)])
    expect(await secao()).toBe('')
  })

  it('mistura mantém só o que está na janela', async () => {
    const { secao } = build([ev(2, 'recente'), ev(85, 'de maio'), ev(90, 'mais velho')])
    const t = await secao()
    expect(t).toContain('recente')
    expect(t).not.toContain('de maio')
    expect(t).not.toContain('mais velho')
    expect(t.split('\n').filter(Boolean)).toHaveLength(1)
  })

  it('voltar a um projeto depois de duas semanas ainda mostra onde parou', async () => {
    // 30 dias, não 7: este limiar responde "vale mostrar?", não "a descrição parou?"
    expect(await build([ev(14)]).secao()).toContain('execution')
  })

  it('na borda: 29 dias entra, 31 não', async () => {
    expect(await build([ev(29)]).secao()).not.toBe('')
    expect(await build([ev(31)]).secao()).toBe('')
  })
})

/**
 * Critério m6. A premissa registrada ("a seção só aparece no próprio Rayzen") estava errada:
 * ela aparece onde houver nó. Medido em 2026-08-20 — Rayzen AI tem 535 nós, TODOS do tipo
 * `file` (varredura do graphify); VB Ferragens tem 35, dos quais 33 curados à mão
 * (entity/concept/module/rule/adr); os outros 6 projetos têm zero.
 *
 * O defeito real é o FALLBACK: sem correspondência com a consulta, servia-se `nodes` inteiro
 * ordenado por confiança — ou seja, 15 caminhos de arquivo sorteados. Numa sessão de auditoria
 * a seção trouxe `parse-test-report.ts` e `rayzen-context-hook.mjs`, nada ligado à tarefa.
 */
describe('ContextEngineService — knowledge_graph não chuta caminho de arquivo', () => {
  function build(nodes: Array<{ type: string; label: string; description?: string; confidence: number }>) {
    const knowledge = { listNodes: jest.fn().mockResolvedValue(nodes) }
    const service = new ContextEngineService(
      {} as never, {} as never, knowledge as never, {} as never, {} as never,
    )
    const secao = (query?: string): Promise<string> =>
      (service as unknown as { fetchSection: (s: string, r: unknown) => Promise<string> })
        .fetchSection('knowledge_graph', { projectId: 'p1', query })
    return { secao }
  }

  const arquivo = (label: string) => ({ type: 'file', label, confidence: 1 })
  const curado  = (type: string, label: string) => ({ type, label, confidence: 0.9 })

  it('nó `file` que CASA com a consulta entra — é justamente o que se quer', async () => {
    const { secao } = build([arquivo('apps/api/src/modules/cache/cache.service.ts')])
    expect(await secao('implementar cache de sessao')).toContain('cache.service.ts')
  })

  it('sem correspondência, NÃO sorteia caminho de arquivo', async () => {
    const { secao } = build([arquivo('apps/agent/src/actions/parse-test-report.ts')])
    expect(await secao('auditoria de politicas de contexto')).toBe('')
  })

  it('sem correspondência, nó CURADO ainda entra — ele diz algo sobre o projeto', async () => {
    const { secao } = build([curado('module', 'Modulo de Catalogo'), arquivo('x/y/z.ts')])
    const t = await secao('assunto totalmente diferente')
    expect(t).toContain('[module] Modulo de Catalogo')
    expect(t).not.toContain('z.ts')
  })

  it('acento não impede correspondência — "Catálogo" casa com "catalogo"', async () => {
    const { secao } = build([curado('module', 'Módulo de Catálogo')])
    expect(await secao('revisar as regras do catalogo')).toContain('Catálogo')
  })

  it('projeto sem nó nenhum continua sem seção', async () => {
    expect(await build([]).secao('qualquer coisa')).toBe('')
  })

  it('sem consulta, o comportamento antigo é preservado (não há o que casar)', async () => {
    const { secao } = build([arquivo('a.ts'), curado('rule', 'Regra X')])
    const t = await secao(undefined)
    expect(t).toContain('a.ts')
    expect(t).toContain('Regra X')
  })
})

/**
 * `memory_relevant` pegava os 5 melhores por cosseno SEM PISO — então um projeto sem nada
 * a ver com a tarefa recebia 5 trechos assim mesmo, 400 chars cada. Depois de m4/m5/m6 ela
 * virou 58% do orçamento no Rayzen AI e 70% no banco-imob, não por crescer, mas por todo o
 * resto ter encolhido.
 *
 * Medido em 2026-08-20, mesma consulta nos 4 projetos com acervo: a curva é PLANA dentro de
 * cada projeto (4–7% do 1º ao 5º), mas o nível absoluto separa — o melhor do banco-imob
 * (0.480) é pior que o PIOR do Rayzen AI (0.561).
 */
/**
 * Conta trechos pelos ÍNDICES do bloco, não pelo separador.
 *
 * Até 15/09 estes testes faziam `split('\n---\n')`: o separador era `---` cru, porque a seção
 * emitia conteúdo de terceiro sem rótulo nenhum. Com a fronteira de `trecho-de-terceiro.const.ts`
 * cada trecho passou a ser numerado e a carregar procedência.
 *
 * O que estes testes medem — o piso de relevância e o teto de 4 trechos — **não mudou**; mudou o
 * formato. Contar por `[n]` é asserção mais forte que contar separadores: verifica também que a
 * numeração existe, que é o que dá ao modelo como citar a origem de cada trecho.
 */
function trechosServidos(secao: string): number {
  return secao.match(/^\[\d+\]/gm)?.length ?? 0
}

describe('ContextEngineService — memory_relevant tem piso de relevância', () => {
  function build(scores: number[]) {
    const memory = {
      search: jest.fn().mockResolvedValue({
        results: scores.map((score, i) => ({ score, content: `trecho ${i} `.repeat(60) })),
        total: scores.length,
      }),
    }
    const service = new ContextEngineService(
      {} as never, memory as never, {} as never, {} as never, {} as never,
    )
    // `req` montado explicitamente: com parâmetro default, passar `undefined` cairia no
    // default e o teste de "sem consulta" testaria o oposto do que diz.
    const secao = (req: Record<string, unknown> = { projectId: 'p1', query: 'implementar cache de sessao' }): Promise<string> =>
      (service as unknown as { fetchSection: (s: string, r: unknown) => Promise<string> })
        .fetchSection('memory_relevant', req)
    return { secao, memory }
  }

  it('projeto com acervo relevante mantém os trechos que a seção serve', async () => {
    // Rayzen AI real: 0.601 … 0.561. São 4 desde 2026-08-21 — medido slot a slot, o 5º
    // era útil em 1 de 10 consultas, então saiu.
    const t = await build([0.601, 0.595, 0.564, 0.562, 0.561]).secao()
    expect(trechosServidos(t)).toBe(4)
  })

  it('projeto sem nada relevante NÃO recebe o menos ruim — a seção some', async () => {
    // banco-imob real: melhor 0.480, e o projeto está parado há 85 dias
    expect(await build([0.480, 0.468, 0.464, 0.459, 0.455]).secao()).toBe('')
  })

  it('o piso olha só o MELHOR — a curva é plana, cortar item a item seria arbitrário', async () => {
    // um bom resultado seguido de fracos: mantém todos os servidos, porque há sinal ali
    const t = await build([0.60, 0.40, 0.39, 0.38, 0.37]).secao()
    expect(trechosServidos(t)).toBe(4)
  })

  it('a folga de 0.52 cobre o boost por modo (+0.030)', async () => {
    // 0.480 do banco-imob + boost máximo = 0.510, que ainda fica de fora
    expect(await build([0.510]).secao()).toBe('')
    expect(await build([0.521]).secao()).not.toBe('')
  })

  it('acervo vazio continua sem seção', async () => {
    expect(await build([]).secao()).toBe('')
  })

  it('sem consulta não há o que buscar', async () => {
    const { secao, memory } = build([0.9])
    expect(await secao({ projectId: 'p1' })).toBe('')
    expect(memory.search).not.toHaveBeenCalled()
  })
})

/**
 * O 5º trecho quase nunca ganhava o lugar. Medido em 2026-08-21 slot a slot sobre as 10
 * consultas do baseline: 1º útil em 7 de 10, 2º em 5, 3º em 4, 4º em 5, **5º em 1**.
 *
 * O corte não é por score de propósito: o score não separa útil de inútil nessa
 * granularidade — na consulta 1 o lixo pontua 0,58 e na 5 o documento certo pontua 0,557.
 */
describe('ContextEngineService — a seção serve 4 trechos, não 5', () => {
  function build(scores: number[]) {
    const memory = {
      search: jest.fn().mockResolvedValue({
        results: scores.map((score, i) => ({ score, id: `d${i}`, content: `trecho ${i}` })),
        total: scores.length,
      }),
    }
    const service = new ContextEngineService({} as never, memory as never, {} as never, {} as never, {} as never)
    const secao = () => (service as unknown as { fetchSection: (s: string, r: unknown) => Promise<string> })
      .fetchSection('memory_relevant', { projectId: 'p1', query: 'x' })
    return { secao, memory }
  }

  it('pede 4 à busca, não 5', async () => {
    const { secao, memory } = build([0.7, 0.69, 0.68, 0.67])
    await secao()
    expect(memory.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 4 }))
  })

  it('serve no máximo 4 trechos', async () => {
    const { secao } = build([0.7, 0.69, 0.68, 0.67, 0.66])
    expect(trechosServidos(await secao())).toBe(4)
  })

  it('serve menos que 4 quando a busca devolve menos — não completa com nada', async () => {
    const { secao } = build([0.7, 0.69])
    expect(trechosServidos(await secao())).toBe(2)
  })

  it('o piso continua decidindo se a seção aparece, independente da quantidade', async () => {
    expect(await build([0.51, 0.50, 0.49, 0.48]).secao()).toBe('')
  })
})

/**
 * Seção que falha sumia calada.
 *
 * O `catch` do `Promise.all` só logava, e o log fica no servidor — quem consome o
 * contexto nunca o vê. Do lado de fora, `memory_relevant` ausente por falha transitória
 * é indistinguível de `memory_relevant` ausente por não haver memória relevante. As duas
 * pedem reações opostas: uma é "não há o que saber", a outra é "eu não sei o que há".
 *
 * Não relança de propósito — retrato parcial vale mais que exceção, e essa parte já
 * estava certa. O que faltava era o rastro. E o cache: sem a guarda, meio segundo de
 * falha congelava o buraco pelo TTL inteiro, fazendo o erro durar ordens de magnitude
 * mais que a causa.
 */
describe('ContextEngineService — seção que falha não some calada', () => {
  type Privado = { fetchSection: (s: string, r: unknown) => Promise<string> }

  function build(quebrar: string[]) {
    const service = new ContextEngineService({} as never, {} as never, {} as never, {} as never, {} as never)
    const chamadas: string[] = []
    jest.spyOn(service as unknown as Privado, 'fetchSection').mockImplementation(async (s: string) => {
      chamadas.push(s)
      if (quebrar.includes(s)) throw new Error('boom')
      return `conteudo de ${s}`
    })
    const montar = (query = 'q') => service.build({
      projectId: 'p1', mode: 'implementation', query,
      include: ['project_state', 'memory_relevant'] as never,
    })
    return { service, montar, chamadas }
  }

  it('registra a seção que errou em `falhas`', async () => {
    const ctx = await build(['memory_relevant']).montar()
    expect(ctx.falhas).toEqual(['memory_relevant'])
  })

  it('seção vazia NÃO é falha — a distinção é o ponto', async () => {
    const ctx = await build([]).montar()
    expect(ctx.falhas).toEqual([])
    expect(ctx.text).not.toMatch(/indispon/i)
  })

  it('o aviso vai no TEXTO, não só no log — é o texto que o consumidor lê', async () => {
    const ctx = await build(['memory_relevant']).montar()
    expect(ctx.text).toMatch(/indisponível nesta consulta/i)
    expect(ctx.text).toMatch(/não.*por ausência de dado/i)
  })

  it('as outras seções continuam sendo servidas — falha parcial não derruba o pacote', async () => {
    const ctx = await build(['memory_relevant']).montar()
    expect(ctx.sections.project_state).toBe('conteudo de project_state')
    expect(ctx.sections.memory_relevant).toBeUndefined()
  })

  it('contexto com falha NÃO entra no cache — a retentativa refaz a busca', async () => {
    const { montar, chamadas } = build(['memory_relevant'])
    await montar()
    await montar()
    expect(chamadas.filter((c) => c === 'memory_relevant')).toHaveLength(2)
  })

  it('contexto íntegro continua sendo cacheado — a guarda não desliga o cache', async () => {
    const { montar, chamadas } = build([])
    await montar()
    await montar()
    expect(chamadas.filter((c) => c === 'memory_relevant')).toHaveLength(1)
  })
})
