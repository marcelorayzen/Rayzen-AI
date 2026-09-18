import {
  consultarFonte,
  avisoDeFontesIndisponiveis,
  avisoDeEstadoDesatualizado,
  SEM_ESTADO_SINTETIZADO,
  DIAS_ATE_ESTADO_VELHO,
  DIAS_MINIMOS_PARA_ATRASADO,
  EVENTOS_24H_ATE_ESTADO_ATRASADO,
} from '../fontes-de-contexto'

/**
 * ── O teste que mede o que a frase do SOUL promete ───────────────────────────
 *
 * *"Prefiro resposta menor e correta a explicação completa inventada."* Um teste que proíbe uma
 * FRASE de voltar ao SOUL não mede isso — crítica externa, e ela está certa. O que mede é o que o
 * sistema entrega ao modelo nos três casos em que a invenção nasce:
 *
 * | caso | o que o sistema fazia | o que faz agora |
 * |---|---|---|
 * | informação ausente | silêncio | diz que não há estado sintetizado |
 * | ferramenta em erro | `catch(() => null)` → parecia vazio | diz que não conseguiu ler |
 * | contexto contraditório | descrição velha servida como atual | declara a idade e o descompasso |
 *
 * É determinístico de propósito: não chama LLM nenhum. Não se testa se o modelo obedece — testa-se
 * se a informação **existe no prompt**. Hoje ela não existia em lugar nenhum, então nem o melhor
 * modelo poderia acertar, e qualquer avaliação de comportamento estaria medindo o modelo em vez do
 * sistema.
 */
describe('1. ferramenta em erro nunca vira ausência', () => {
  it('falha na consulta é `falhou`, não `vazio`', async () => {
    const f = await consultarFonte('o estado', () => Promise.reject(new Error('conexão caiu')), null, (v) => v === null)
    expect(f.estado).toBe('falhou')
  })

  it('consulta bem-sucedida sem resultado é `vazio` — e são coisas diferentes', async () => {
    const f = await consultarFonte('o estado', () => Promise.resolve(null), null, (v) => v === null)
    expect(f.estado).toBe('vazio')
  })

  it('a falha vira aviso nomeando a fonte', () => {
    const aviso = avisoDeFontesIndisponiveis([
      { nome: 'o estado do projeto', estado: 'falhou', valor: null },
      { nome: 'os eventos recentes', estado: 'ok', valor: [] },
    ])
    expect(aviso).toContain('o estado do projeto')
    expect(aviso).not.toContain('os eventos recentes')
  })

  /** A parte que impede a invenção: proibir explicitamente concluir ausência a partir de erro. */
  it('o aviso proíbe concluir ausência a partir da falha', () => {
    const aviso = avisoDeFontesIndisponiveis([{ nome: 'a memoria', estado: 'falhou', valor: null }])
    expect(aviso).toMatch(/N[ÃA]O quer dizer que n[ãa]o exista/i)
    expect(aviso).toMatch(/n[ãa]o afirme aus[êe]ncia/i)
  })

  it('sem falha nenhuma, silêncio — aviso em toda resposta treina a ignorar o aviso', () => {
    expect(avisoDeFontesIndisponiveis([
      { nome: 'a', estado: 'ok', valor: 1 },
      { nome: 'b', estado: 'vazio', valor: null },
    ])).toBe('')
  })
})

describe('2. informação ausente é declarada, não omitida', () => {
  it('projeto sem estado sintetizado diz isso, em vez de calar', () => {
    expect(SEM_ESTADO_SINTETIZADO).toMatch(/ainda n[ãa]o tem estado sintetizado/i)
    expect(SEM_ESTADO_SINTETIZADO).toMatch(/n[ãa]o descreva objetivo, fase ou andamento/i)
  })
})

describe('3. contexto contraditório é declarado', () => {
  const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000)

  /** O caso que importa: descrição parada E trabalho acontecendo agora. */
  it('estado velho com trabalho recente avisa que está ATRASADO', () => {
    const aviso = avisoDeEstadoDesatualizado(
      diasAtras(DIAS_MINIMOS_PARA_ATRASADO + 1), 80, EVENTOS_24H_ATE_ESTADO_ATRASADO + 5,
    )
    expect(aviso).toMatch(/atrasada em rela[çc][ãa]o ao trabalho atual/i)
    expect(aviso).toMatch(/n[ãa]o a apresente como o estado de hoje/i)
  })

  /** Diferente de atrasado: aqui o estado provavelmente está certo, só é antigo. */
  it('estado velho SEM trabalho recente avisa que o projeto está parado', () => {
    const aviso = avisoDeEstadoDesatualizado(diasAtras(DIAS_ATE_ESTADO_VELHO + 3), 4, 0)
    expect(aviso).toMatch(/provavelmente parado/i)
    expect(aviso).not.toMatch(/atrasada/i)
  })

  it('estado fresco não avisa nada', () => {
    expect(avisoDeEstadoDesatualizado(diasAtras(1), 3, 2)).toBe('')
  })

  it('sem marco não inventa idade', () => {
    expect(avisoDeEstadoDesatualizado(null, 0, 0)).toBe('')
    expect(avisoDeEstadoDesatualizado(undefined, 0, 0)).toBe('')
  })
})

/**
 * Limiares diferentes fariam o mesmo projeto ser "parado" num canal e "ativo" no outro — a mesma
 * razão das cópias anti-drift de `memory-ranking` e `event-derived-text`.
 */
describe('anti-drift dos limiares com a V2', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', '..', '..', '..', 'api-v2', 'src', 'context-engine', 'context-engine.service.ts'),
    'utf8',
  ) as string

  const numeroDe = (nome: string) => Number(new RegExp(`const ${nome} = (\\d+)`).exec(fonte)?.[1])

  it.each([
    ['DIAS_ATE_ESTADO_VELHO', DIAS_ATE_ESTADO_VELHO],
    ['DIAS_MINIMOS_PARA_ATRASADO', DIAS_MINIMOS_PARA_ATRASADO],
    ['EVENTOS_24H_ATE_ESTADO_ATRASADO', EVENTOS_24H_ATE_ESTADO_ATRASADO],
  ])('%s é o mesmo nas duas apps', (nome, aqui) => {
    expect(numeroDe(nome)).toBe(aqui)
  })
})

/**
 * ── E o orquestrador precisa USAR o mecanismo ────────────────────────────────
 *
 * Os testes acima provam o módulo. Este prova a ligação, que é onde o defeito morava: a regra
 * *"erro de consulta não vira ausência de conhecimento"* existia desde 14/09 em
 * `project-state.service.ts` e estava aplicada **num lugar só** — o chat fazia o oposto em cinco
 * pontos. Testar só a função deixaria exatamente essa distância sem sensor.
 */
describe('getProjectContext entrega a distinção ao modelo', () => {
  function servicoCom(prisma: unknown) {
    const svc = Object.create(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../orchestrator.service').OrchestratorService.prototype,
    )
    Object.assign(svc, { prisma })
    return (svc as { getProjectContext: (p?: string) => Promise<string> })
  }

  const projetoOk = { findUnique: jest.fn().mockResolvedValue({ name: 'Rayzen AI', description: 'd' }) }

  it('estado que FALHOU ao carregar vira aviso, não silêncio', async () => {
    const ctx = await servicoCom({
      project:      projetoOk,
      projectState: { findFirst: jest.fn().mockRejectedValue(new Error('conexão caiu')) },
      projectGoal:  { findFirst: jest.fn().mockResolvedValue(null) },
      event:        { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    }).getProjectContext('p1')

    expect(ctx).toMatch(/AVISO DE LEITURA/)
    expect(ctx).toContain('o estado do projeto')
  })

  it('estado AUSENTE de verdade diz que não há síntese — e não usa o aviso de falha', async () => {
    const ctx = await servicoCom({
      project:      projetoOk,
      projectState: { findFirst: jest.fn().mockResolvedValue(null) },
      projectGoal:  { findFirst: jest.fn().mockResolvedValue(null) },
      event:        { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    }).getProjectContext('p1')

    expect(ctx).toContain(SEM_ESTADO_SINTETIZADO.trim().slice(0, 40))
    expect(ctx).not.toMatch(/AVISO DE LEITURA/)
  })

  /** O caso que deu origem a tudo: um soluço do banco fazia o projeto parecer recém-criado. */
  it('falha TOTAL do contexto avisa, em vez de devolver vazio', async () => {
    const ctx = await servicoCom({
      project: { findUnique: jest.fn(() => { throw new Error('Promise.all explodiu') }) },
    }).getProjectContext('p1')

    expect(ctx).toMatch(/AVISO DE LEITURA/)
    expect(ctx).not.toBe('')
  })

  it('tudo saudável não injeta aviso nenhum', async () => {
    const ctx = await servicoCom({
      project:      projetoOk,
      projectState: { findFirst: jest.fn().mockResolvedValue({
        objective: 'Obj', stage: 'building', blockers: [], recentDecisions: [], activeFocus: null,
        contentChangedAt: new Date(), updatedAt: new Date(),
      }) },
      projectGoal:  { findFirst: jest.fn().mockResolvedValue(null) },
      event:        { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    }).getProjectContext('p1')

    expect(ctx).not.toMatch(/AVISO DE LEITURA/)
    expect(ctx).not.toContain('ainda não tem estado sintetizado')
    expect(ctx).toContain('Obj')
  })
})
