// `migracoes_aplicadas` lê o diretório de migrações do DISCO, e aqui ele acharia o do
// próprio repositório — 25 nomes reais contra um banco mockado vazio, ou seja, vermelho
// por artefato de teste. Declarar o diretório inexistente faz o check devolver
// "inconclusivo", que é o comportamento correto quando não dá para localizar o alvo.
// Os casos dele vivem em migracoes-aplicadas.spec.ts, com fs mockado de propósito.
jest.mock('node:fs', () => ({ existsSync: () => false, readdirSync: () => [] }))

// `disco_com_folga` chama `statfs('/')`. Sem este mock ele mediria o disco REAL da máquina
// que roda o teste: o resultado passaria a depender de quanto espaço o dev tem livre, e o
// caso "tudo ok" viraria vermelho num laptop cheio. 50% é folga determinística.
jest.mock('node:fs/promises', () => ({
  statfs: () => Promise.resolve({ bsize: 4096, blocks: 1_000_000, bavail: 500_000 }),
}))

import { InvariantsService, GRUPOS_LLM_SONDADOS, SONDA_LLM_TRACE, type InvariantRunResult } from '../invariants.service'
import { INVARIANTES, type InvariantResult } from '../invariant-checks.const'

const N_GRUPOS = GRUPOS_LLM_SONDADOS.length

/**
 * Cada teste aqui reproduz uma falha REAL que passou despercebida em produção.
 * O critério para um invariante existir é esse: já quebrou em silêncio.
 */
describe('InvariantsService', () => {
  function buildService(over: Record<string, unknown> = {}) {
    const prisma = {
      // Nenhuma migração registrada + nenhum diretório localizável a partir do build de
      // teste = "inconclusivo", que é verde. Ver migracoes-aplicadas.spec.ts.
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      invariantReport: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })),
        findFirst: jest.fn(), findMany: jest.fn(),
      },
      projectCatalog:  { findMany: jest.fn().mockResolvedValue([]) },
      strategy:        { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      benchmarkResult: { count: jest.fn().mockResolvedValue(0) },
      approvalGate:    { findMany: jest.fn().mockResolvedValue([]) },
      hypothesis:      { findMany: jest.fn().mockResolvedValue([]) },
      benchmarkCase:   { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      mission:         { findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    }
    const bridge  = {
      listProjects: jest.fn().mockResolvedValue([]),
      getProject: jest.fn().mockResolvedValue({ id: 'p1', name: 'P', repoSlug: 'p' }),
      registrosSemProjeto: jest.fn().mockResolvedValue({
        eventos: 0, eventosRecentes: 0, documentos: 0, documentosRecentes: 0,
      }),
    }
    // SystemStatusService: o beat e contabilidade, nao comportamento sob teste.
    const system = { beat: jest.fn().mockResolvedValue(undefined) }
    // Sem memoria servida o check fica "calado, como deve" — ausencia nao e defeito.
    const contexto = { diagnosticarMemoria: jest.fn().mockResolvedValue([]) }
    const service = new InvariantsService(prisma as never, bridge as never, system as never, contexto as never)
    return { service, prisma, bridge, system, contexto }
  }

  // Rede indisponível no ambiente de teste: o check de relógio devolve
  // "inconclusivo" e não polui os demais casos.
  beforeEach(() => {
    global.fetch = jest.fn().mockRejectedValue(new Error('sem rede')) as unknown as typeof fetch
  })

  const acha = (r: InvariantRunResult, id: string): InvariantResult =>
    r.resultados.find((x) => x.id === id)!

  it('projeto V1 ativo fora do project_catalog é falha — o QA Scientist nunca o varre', async () => {
    const { service } = buildService({
      projectCatalog: { findMany: jest.fn().mockResolvedValue([{ v1ProjectId: 'outro' }]) },
    })
    ;(service as unknown as { bridge: { listProjects: jest.Mock } }).bridge.listProjects
      .mockResolvedValue([{ id: 'rayzen-id', name: 'Rayzen AI' }, { id: 'outro', name: 'Banco Imob' }])

    const r = await service.run('p1')
    const check = acha(r, 'projeto_ativo_no_catalogo')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('Rayzen AI')
  })

  it('estratégia com BenchmarkResult e fitnessScore null é falha', async () => {
    const { service } = buildService({
      strategy:        { findMany: jest.fn().mockResolvedValue([{ id: 'strat-aaaa1111', taskType: 'summarize' }]), findUnique: jest.fn() },
      benchmarkResult: { count: jest.fn().mockResolvedValue(5) },
    })

    const check = acha(await service.run('p1'), 'strategy_com_resultado_tem_fitness')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('5 resultado(s)')
  })

  it('estratégia nunca avaliada com fitness null NÃO é falha', async () => {
    const { service } = buildService({
      strategy:        { findMany: jest.fn().mockResolvedValue([{ id: 'nova', taskType: 'classify' }]), findUnique: jest.fn() },
      benchmarkResult: { count: jest.fn().mockResolvedValue(0) },
    })

    expect(acha(await service.run('p1'), 'strategy_com_resultado_tem_fitness').ok).toBe(true)
  })

  it('gate de promoção aprovado sem estratégia promovida é falha', async () => {
    const { service } = buildService({
      approvalGate: { findMany: jest.fn().mockResolvedValue([{ id: 'gate-1283c977', context: { strategyId: 'strat-d3cc9a40' } }]) },
      strategy:     { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ promotedAt: null }) },
    })

    const check = acha(await service.run('p1'), 'gate_aprovado_foi_aplicado')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('sem efeito aplicado')
  })

  it('gate aprovado com estratégia de fato promovida é ok', async () => {
    const { service } = buildService({
      approvalGate: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', context: { strategyId: 's1' } }]) },
      strategy:     { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ promotedAt: new Date() }) },
    })

    expect(acha(await service.run('p1'), 'gate_aprovado_foi_aplicado').ok).toBe(true)
  })

  it('detecta o placeholder do schema gravado como taskType', async () => {
    const { service } = buildService({
      hypothesis: { findMany: jest.fn().mockResolvedValue([
        { id: 'h1', taskType: 'classify|summarize|context_synthesis|null' },
        { id: 'h2', taskType: 'summarize' },
        { id: 'h3', taskType: null },
      ]) },
    })

    const check = acha(await service.run('p1'), 'hipotese_com_tasktype_valido')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('classify|summarize')
  })

  it('ignora hipótese já rejeitada — dado ruim neutralizado é história, não falha', async () => {
    // Sem este filtro o relatório nunca ficaria limpo: as 3 hipóteses com taskType
    // inválido foram rejeitadas na limpeza de 2026-08-13 e continuavam acusando.
    const findMany = jest.fn().mockResolvedValue([])
    const { service } = buildService({ hypothesis: { findMany } })

    await service.run('p1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { notIn: ['rejected', 'resolved'] } } }),
    )
  })

  it('taskType misturando JSON e rótulo simples é conjunto incoerente', async () => {
    const { service } = buildService({
      benchmarkCase: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([
          { taskType: 'classify', expected: 'deploy' },
          { taskType: 'classify', expected: '{"type":"execution","source":"cli"}' },
          { taskType: 'summarize', expected: 'resumo em texto' },
        ]),
      },
    })

    const check = acha(await service.run('p1'), 'benchmark_set_coerente')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('classify')
    expect(check.detalhe).not.toContain('summarize')
  })

  it('caso de benchmark sem projeto dono é falha — ninguém o coleta', async () => {
    // Desde que o escopo do QA Scientist virou estrito, órfão some do sistema em
    // silêncio. Antes era o oposto: 46 órfãos contavam para TODO projeto.
    const { service } = buildService({
      benchmarkCase: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy:  jest.fn().mockResolvedValue([{ taskType: 'classify', _count: { _all: 18 } }]),
      },
    })

    const check = acha(await service.run('p1'), 'benchmark_case_tem_dono')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('classify (18)')
  })

  it('registro órfão RECENTE é falha — é a assinatura de a resolução de slug ter quebrado', async () => {
    // Registro nasce órfão quando o hook não resolve o repoSlug. Foi o que
    // aconteceu com os dois projetos criados por jarvis:create_project_folder:
    // pasta com nome cru, projeto registrado em kebab-case, nada casando.
    const { service, bridge } = buildService()
    bridge.registrosSemProjeto.mockResolvedValue({
      eventos: 236, eventosRecentes: 2, documentos: 4, documentosRecentes: 4,
    })

    const check = acha(await service.run('p1'), 'registro_sem_projeto')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('2 evento(s)')
    expect(check.detalhe).toContain('4 documento(s)')
    // O passivo histórico aparece, mas como número — não é o que derruba o check.
    expect(check.detalhe).toContain('236')
  })

  it('passivo histórico sozinho NÃO é falha — vermelho permanente é o que se aprende a ignorar', async () => {
    const { service, bridge } = buildService()
    bridge.registrosSemProjeto.mockResolvedValue({
      eventos: 236, eventosRecentes: 0, documentos: 4, documentosRecentes: 0,
    })

    const check = acha(await service.run('p1'), 'registro_sem_projeto')

    expect(check.ok).toBe(true)
    expect(check.detalhe).toContain('236')
  })

  // Em 2026-08-19 o histórico exibia 20 linhas idênticas chamadas "Conversa": a
  // telemetria de módulo interno (4.459 sessões contra 210 reais) empurrava a primeira
  // conversa para a posição 661 de um corte em 20. Nada dava erro — o endpoint respondia
  // 200 e a suíte passava, porque o defeito morava na FORMA DO DADO e todo teste da casa
  // mocka o Prisma.
  //
  // Por isso este check sonda o ENDPOINT, não o banco: medir a composição de
  // conversation_messages daria vermelho permanente (a telemetria domina a tabela por
  // desenho), e replicar a query do SessionService aqui seria testar uma cópia — o erro
  // do "Invariante 1" da V1, que passou verde com 236 órfãos no banco.
  describe('historico_serve_conversa — sonda o endpoint real', () => {
    const respondeCom = (body: unknown, status = 200) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300, status, json: async () => body,
      }) as never
    }

    it('todas as entradas com o título genérico é falha — o histórico virou telemetria', async () => {
      respondeCom(Array.from({ length: 20 }, () => ({ title: 'Conversa' })))
      const { service } = buildService()

      const check = acha(await service.run('p1'), 'historico_serve_conversa')

      expect(check.ok).toBe(false)
      expect(check.detalhe).toContain('20')
      expect(check.correcao).toContain('role=user')
    })

    it('uma conversa real entre as servidas já basta — pergunta se ALGUMA chega, não quantas', async () => {
      respondeCom([{ title: 'qual estado atual do projeto?' }, ...Array.from({ length: 19 }, () => ({ title: 'Conversa' }))])
      const { service } = buildService()

      const check = acha(await service.run('p1'), 'historico_serve_conversa')

      expect(check.ok).toBe(true)
      expect(check.detalhe).toContain('1 das 20')
    })

    it('histórico vazio NÃO é falha — instalação nova não tem conversa', async () => {
      respondeCom([])
      const { service } = buildService()

      expect(acha(await service.run('p1'), 'historico_serve_conversa').ok).toBe(true)
    })

    it('endpoint fora do ar (500) é falha — o histórico não está sendo servido', async () => {
      respondeCom({}, 500)
      const { service } = buildService()

      const check = acha(await service.run('p1'), 'historico_serve_conversa')
      expect(check.ok).toBe(false)
      expect(check.detalhe).toContain('500')
    })

    // Mesma distinção estrutural de `modelos_llm_respondem`: sem resposta HTTP quem
    // não respondeu foi a rede local, e culpar o histórico por isso seria vermelho
    // por motivo errado.
    it('sem resposta HTTP é INCONCLUSIVO, não falha', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never
      const { service } = buildService()

      const check = acha(await service.run('p1'), 'historico_serve_conversa')
      expect(check.ok).toBe(true)
      expect(check.detalhe).toContain('Inconclusivo')
    })
  })

  it('a janela consultada é a recente, não a base inteira', async () => {
    const { service, bridge } = buildService()

    await service.run('p1')

    const desde = bridge.registrosSemProjeto.mock.calls[0]?.[0] as Date
    const dias  = (Date.now() - desde.getTime()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThan(7.1)
  })

  it('missão ativa parada há semanas é falha', async () => {
    const antiga = new Date('2026-06-20')
    const { service } = buildService({
      mission: { findMany: jest.fn().mockResolvedValue([{ id: 'm1', title: 'Stress Test v3', updatedAt: antiga }]) },
    })

    const check = acha(await service.run('p1'), 'missao_nao_travada')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('Stress Test v3')
  })

  it('sem rede o check de relógio fica inconclusivo, não vira falha', async () => {
    const { service } = buildService()

    expect(acha(await service.run('p1'), 'relogio_sincronizado').ok).toBe(true)
  })

  it('detecta deriva grande de relógio quando há rede', async () => {
    // O caso real: servidor 115 dias atrasado, sem erro nenhum.
    const agora = new Date()
    const passado = new Date(agora.getTime() - 115 * 24 * 60 * 60 * 1000)
    jest.spyOn(Date, 'now').mockReturnValue(passado.getTime())
    global.fetch = jest.fn().mockResolvedValue({
      headers: { get: () => agora.toUTCString() },
    }) as unknown as typeof fetch

    const { service } = buildService()
    const check = acha(await service.run('p1'), 'relogio_sincronizado')

    expect(check.ok).toBe(false)
    expect(check.detalhe).toContain('dias')
    jest.restoreAllMocks()
  })

  it('um check que explode vira falha própria sem derrubar os outros', async () => {
    const { service } = buildService({
      hypothesis: { findMany: jest.fn().mockRejectedValue(new Error('coluna sumiu')) },
    })

    const r = await service.run('p1')

    // Derivado do catálogo: acrescentar invariante não pode exigir editar teste.
    expect(r.resultados).toHaveLength(INVARIANTES.length)
    expect(r.resultados.some((x) => x.detalhe.includes('coluna sumiu'))).toBe(true)
    expect(acha(r, 'benchmark_set_coerente').ok).toBe(true)
  })

  it('resumo nomeia os invariantes quebrados e a pior gravidade', async () => {
    const { service } = buildService({
      approvalGate: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', context: { strategyId: 's1' } }]) },
      strategy:     { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue({ promotedAt: null }) },
    })

    const r = await service.run('p1')

    expect(r.gravidadeMax).toBe('alta')
    expect(r.resumo).toContain('gate_aprovado_foi_aplicado')
    expect(r.totalFalha).toBe(1)
  })

  it('tudo ok produz resumo positivo e gravidade ok', async () => {
    const { service } = buildService()

    const r = await service.run('p1')

    expect(r.totalFalha).toBe(0)
    expect(r.gravidadeMax).toBe('ok')
    expect(r.resumo).toContain(`Todos os ${INVARIANTES.length} invariantes ok`)
  })

  /**
   * O ciclo do servidor existe porque em 2026-08-14 o relógio derrapou 8h43m e
   * ninguém soube: o check pegaria com folga, mas quem o dispara era o watcher
   * do agent desktop, que estava parado. Um sensor que só liga quando alguém
   * está olhando não é sensor.
   */
  describe('ciclo do servidor', () => {
    const catalogo = (ids: string[]) => ({
      projectCatalog: { findMany: jest.fn().mockResolvedValue(ids.map((v1ProjectId) => ({ v1ProjectId }))) },
    })

    it('não grava relatório quando está tudo ok e já há um recente', async () => {
      const { service, prisma } = buildService(catalogo(['p1']))
      prisma.invariantReport.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })

      await service.runForAllProjects()

      // 30 em 30 minutos, 9 projetos: gravar sempre seria ~432 linhas/dia
      // dizendo "tudo ok" e o histórico deixaria de servir para achar quebra.
      expect(prisma.invariantReport.create).not.toHaveBeenCalled()
    })

    it('grava mesmo sem falha quando o último relatório passou do heartbeat', async () => {
      const { service, prisma } = buildService(catalogo(['p1']))
      prisma.invariantReport.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000) })

      await service.runForAllProjects()

      // Silêncio total é indistinguível de "o ciclo morreu".
      expect(prisma.invariantReport.create).toHaveBeenCalledTimes(1)
    })

    it('grava sempre que há falha, por mais recente que seja o último', async () => {
      const { service, prisma } = buildService({
        ...catalogo(['p1']),
        strategy:        { findMany: jest.fn().mockResolvedValue([{ id: 's1', fitnessScore: null }]), findUnique: jest.fn() },
        benchmarkResult: { count: jest.fn().mockResolvedValue(3) },
      })
      prisma.invariantReport.findFirst.mockResolvedValue({ createdAt: new Date() })

      await service.runForAllProjects()

      expect(prisma.invariantReport.create).toHaveBeenCalledTimes(1)
      expect(prisma.invariantReport.create.mock.calls[0][0].data.totalFalha).toBeGreaterThan(0)
    })

    it('projeto que falha não impede a varredura dos seguintes', async () => {
      const { service, prisma } = buildService(catalogo(['p1', 'p2']))
      prisma.invariantReport.findFirst
        .mockRejectedValueOnce(new Error('banco caiu'))
        .mockResolvedValue(null)

      await service.runForAllProjects()

      expect(prisma.invariantReport.create).toHaveBeenCalledTimes(1)
    })

    it('catálogo indisponível não derruba o ciclo', async () => {
      const { service } = buildService({
        projectCatalog: { findMany: jest.fn().mockRejectedValue(new Error('sem banco')) },
      })

      await expect(service.runForAllProjects()).resolves.toBeUndefined()
    })

    /**
     * Em 2026-08-17 a Groq descontinuou os DOIS modelos configurados. Todo `gpt-4o`
     * virou 404, o fallback caiu no Anthropic sem crédito, e tudo que usa LLM passou
     * a devolver 500 em produção — inclusive a síntese do ProjectState.
     *
     * Nenhum sensor acusou: heartbeats saudáveis, invariantes 8 de 9, painel verde.
     * Todos mediam estado INTERNO. Foi descoberto por acaso.
     */
    describe('modelos_llm_respondem', () => {
      /** Respostas por grupo, na ordem em que a sonda os chama. */
      // Sequencia CRUA de respostas do fetch, na ordem em que sao consumidas — inclusive
      // as retentativas. Use quando o teste for SOBRE o retry.
      const comSequencia = (respostas: Array<{ ok: boolean; status?: number; body?: string } | Error>) => {
        const fn = jest.fn()
        for (const r of respostas) {
          if (r instanceof Error) fn.mockRejectedValueOnce(r)
          else fn.mockResolvedValueOnce({
            ok: r.ok, status: r.status ?? (r.ok ? 200 : 500),
            text: () => Promise.resolve(r.body ?? ''),
            headers: { get: () => null },
          })
        }
        global.fetch = fn as unknown as typeof fetch
        return fn
      }

      /**
       * Respostas POR GRUPO, na ordem de `GRUPOS_LLM_SONDADOS`; grupo nao citado responde
       * ok. Derivar da constante em vez de fixar 3 foi o conserto de 2026-08-22, quando
       * entraram os dois grupos Gemini e nove testes quebraram de uma vez sem que nenhum
       * comportamento tivesse mudado.
       */
      const comSondas = (respostas: Array<{ ok: boolean; status?: number; body?: string } | Error>) =>
        comSequencia([...respostas, ...Array(Math.max(0, N_GRUPOS - respostas.length)).fill({ ok: true })])

      /** Uma rodada inteira de erros — inclui a retentativa de cada grupo. */
      const rodadaDeErros = () => Array.from({ length: N_GRUPOS * 2 }, () => new Error('fetch failed'))
      /** Uma rodada inteira de sucessos. */
      const rodadaOk = () => Array.from({ length: N_GRUPOS }, () => ({ ok: true }))
      /** Sucesso em todos menos o segundo grupo, que recebe `falha`. */
      const soOSegundoFalha = (falha: { ok: boolean; status?: number; body?: string } | Error) =>
        [{ ok: true }, falha, ...Array.from({ length: N_GRUPOS - 2 }, () => ({ ok: true }))]

      const sondar = async () => {
        const { service } = buildService()
        return (service as unknown as {
          modelosLlmRespondem: () => Promise<InvariantResult>
        }).modelosLlmRespondem()
      }

      /**
       * A sonda e a maior consumidora de LLM da plataforma: 5 grupos a cada 30min, 24h por
       * dia. Medido em 06/09 no Langfuse, ela respondia por ~60% de TODAS as chamadas — e
       * caia em `litellm-acompletion`, o balde dos anonimos. O efeito colateral e pior que
       * o rastro sujo: a taxa de erro POR GRUPO passava a medir o sensor, nao o trabalho.
       *
       * Assercao no CORPO enviado, nao no fato de haver metadata: nome errado e tao anonimo
       * quanto nome nenhum na hora de perguntar quem gastou a cota.
       */
      it('se identifica no Langfuse em TODOS os grupos sondados', async () => {
        const fn = comSondas([])
        await sondar()

        expect(fn).toHaveBeenCalledTimes(N_GRUPOS)
        for (const [, init] of fn.mock.calls) {
          const corpo = JSON.parse((init as RequestInit).body as string) as {
            metadata?: { trace_name?: string }
          }
          expect(corpo.metadata?.trace_name).toBe(SONDA_LLM_TRACE)
        }
      })

      it('falha quando o provedor descontinua o modelo — o caso real da Groq', async () => {
        comSondas([
          { ok: false, status: 404, body: '{"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."}}' },
          { ok: true },
          { ok: true },
        ])

        const r = await sondar()

        expect(r.ok).toBe(false)
        expect(r.detalhe).toContain('gpt-4o')
        expect(r.detalhe).toContain('does not exist')
        expect(r.correcao).toContain('force-recreate litellm')
      })

      /**
       * Pego na primeira semana do check, em producao: `gpt-4o-mini` devolveu 429 com
       * `cooldown_list` — cota do free tier da Groq, agravada pelas proprias sondas.
       *
       * 429 e modelo OCUPADO, nao modelo quebrado: vem com retry-after e se cura
       * sozinho. Contar como falha transformaria o invariante em vermelho recorrente,
       * que e o que se aprende a ignorar.
       */
      it('429 e cota, nao quebra — reporta sem falhar', async () => {
        comSondas([
          { ok: true },
          { ok: false, status: 429, body: '{"error":{"message":"No deployments available for selected model, Try again in 24 seconds"}}' },
          { ok: true },
        ])

        const r = await sondar()

        expect(r.ok).toBe(true)
        expect(r.detalhe).toContain('gpt-4o-mini')
        expect(r.detalhe).toContain('transitório')
      })

      it('429 nao mascara uma quebra de verdade no mesmo lote', async () => {
        comSondas([
          { ok: false, status: 404, body: '{"error":{"message":"model does not exist"}}' },
          { ok: false, status: 429, body: '{"error":{"message":"rate limited"}}' },
          { ok: true },
        ])

        const r = await sondar()

        expect(r.ok).toBe(false)
        expect(r.detalhe).toContain('does not exist')
        expect(r.detalhe).toContain(`1 de ${N_GRUPOS}`)       // conta só o quebrado de verdade
      })

      it('passa quando todos os grupos respondem', async () => {
        comSondas([{ ok: true }, { ok: true }, { ok: true }])

        const r = await sondar()

        expect(r.ok).toBe(true)
        expect(r.detalhe).toContain('gpt-4o')
      })

      /**
       * Se NENHUMA sonda teve resposta HTTP, quem não respondeu foi o LiteLLM local.
       * Culpar o provedor nesse caso seria acusar descontinuação onde houve falha de
       * rede — e a distinção é estrutural (houve status?), nunca por texto de erro,
       * que muda com runtime e versão do fetch.
       */
      it('LiteLLM inacessível é inconclusivo, não falha', async () => {
        comSequencia(rodadaDeErros())

        const r = await sondar()

        expect(r.ok).toBe(true)
        expect(r.detalhe).toContain('inconclusivo')
      })

      it('um grupo fora do ar com os outros de pé continua sendo falha', async () => {
        comSondas([{ ok: true }, new Error('fetch failed'), { ok: true }])

        const r = await sondar()

        expect(r.ok).toBe(false)
        expect(r.detalhe).toContain(`1 de ${N_GRUPOS}`)
      })

      /**
       * O ciclo do servidor varre até 10 projetos por rodada e esta pergunta não é por
       * projeto. Sem cache seriam 30 chamadas de LLM a cada 30min para responder três
       * vezes a mesma coisa — e aqui cada sonda custa token.
       */
      it('usa cache entre projetos da mesma rodada', async () => {
        const fetchMock = comSondas([{ ok: true }, { ok: true }, { ok: true }])
        const { service } = buildService()
        const priv = service as unknown as { modelosLlmRespondem: () => Promise<InvariantResult> }

        await priv.modelosLlmRespondem()
        await priv.modelosLlmRespondem()

        expect(fetchMock).toHaveBeenCalledTimes(N_GRUPOS)   // uma rodada só
      })

      /**
       * Sonda sem status tenta uma segunda vez, então uma rodada "sem rede" gasta 6
       * chamadas: 3 primeiras tentativas + 3 retentativas. Ver o teste do 429 abaixo.
       */
      it('resultado inconclusivo não é cacheado', async () => {
        const fetchMock = comSequencia([...rodadaDeErros(), ...rodadaOk()])
        const { service } = buildService()
        const priv = service as unknown as { modelosLlmRespondem: () => Promise<InvariantResult> }

        const primeiro = await priv.modelosLlmRespondem()
        const segundo  = await priv.modelosLlmRespondem()

        expect(primeiro.detalhe).toContain('inconclusivo')
        expect(segundo.ok).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(N_GRUPOS * 3)
      })

      /**
       * Falso vermelho real, em 2026-08-22: o invariante reportou `gpt-4o-mini` com
       * "operation was aborted due to timeout" enquanto um `curl` direto devolvia **429 em
       * 400ms**.
       *
       * A causa é o próprio LiteLLM — ao levar 429 da Groq ele retenta com backoff e
       * estoura os 20s da sonda; depois o grupo entra em cooldown e passa a responder 429
       * na hora. O efeito é que **todo o tratamento de 429 nunca rodava**: a requisição
       * morria antes de ter status, e modelo apenas ocupado era reportado como quebrado.
       * Exatamente o vermelho por engano que faz um sensor ser abandonado.
       */
      it('timeout que na segunda tentativa devolve 429 NÃO derruba o invariante', async () => {
        const fetchMock = comSequencia([
          ...soOSegundoFalha(new Error('The operation was aborted due to timeout')),
          { ok: false, status: 429, body: '{"error":{"message":"Try again in 24 seconds"}}' }, // retentativa do 2o
        ])

        const r = await sondar()

        expect(r.ok).toBe(true)
        expect(r.detalhe).toContain('gpt-4o-mini limitado(s) por cota')
        expect(r.detalhe).toContain('não contado como falha')
        expect(fetchMock).toHaveBeenCalledTimes(N_GRUPOS + 1)   // só o grupo que falhou repete
      })

      /**
       * Terceira aparição do mesmo padrão em 2026-08-22, junto com o cache do contexto:
       * **falha guardada faz o erro durar mais que a causa.**
       *
       * O invariante ficou vermelho com "gpt-4o-mini: operation was aborted due to timeout"
       * enquanto uma sonda idêntica, rodada DENTRO do mesmo container, devolvia 200 em
       * 297ms nos três grupos. Era o resultado da sonda de arranque, servido por 10 minutos.
       *
       * Status HTTP é evidência e merece cache — um 404 do provedor não muda em dez
       * minutos. Silêncio não é evidência.
       */
      it('falha só por silêncio não é cacheada — a próxima execução sonda de novo', async () => {
        const fetchMock = comSequencia([
          ...soOSegundoFalha(new Error('timeout')), new Error('timeout'), // rodada 1 + retentativa
          ...rodadaOk(),                                                  // rodada 2
        ])
        const { service } = buildService()
        const priv = service as unknown as { modelosLlmRespondem: () => Promise<InvariantResult> }

        expect((await priv.modelosLlmRespondem()).ok).toBe(false)
        expect((await priv.modelosLlmRespondem()).ok).toBe(true)
        expect(fetchMock).toHaveBeenCalledTimes(N_GRUPOS * 2 + 1)
      })

      it('falha COM status HTTP continua cacheada — 404 do provedor não muda em 10min', async () => {
        const fetchMock = comSequencia([
          { ok: false, status: 404, body: '{"error":{"message":"model does not exist"}}' },
          ...Array.from({ length: N_GRUPOS - 1 }, () => ({ ok: true })),
          ...rodadaOk(),
        ])
        const { service } = buildService()
        const priv = service as unknown as { modelosLlmRespondem: () => Promise<InvariantResult> }

        expect((await priv.modelosLlmRespondem()).ok).toBe(false)
        expect((await priv.modelosLlmRespondem()).ok).toBe(false)
        expect(fetchMock).toHaveBeenCalledTimes(N_GRUPOS)   // a segunda leitura veio do cache
      })

      it('modelo de fato pendurado estoura as DUAS tentativas e continua sendo detectado', async () => {
        comSequencia([
          ...soOSegundoFalha(new Error('The operation was aborted due to timeout')),
          new Error('The operation was aborted due to timeout'), // a retentativa tambem estoura
        ])

        const r = await sondar()

        expect(r.ok).toBe(false)
        expect(r.detalhe).toContain('gpt-4o-mini')
      })

      /**
       * `gpt-4o-premium` aponta para a Anthropic, sem crédito por decisão. Incluí-lo
       * deixaria o invariante vermelho para sempre, e vermelho permanente é o que se
       * aprende a ignorar — mesmo princípio do `registro_sem_projeto`.
       */
      it('não sonda os grupos premium — ficariam vermelhos para sempre', async () => {
        const fetchMock = comSondas([{ ok: true }, { ok: true }, { ok: true }])
        await sondar()

        const gruposChamados = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).model)
        expect(gruposChamados).not.toContain('gpt-4o-premium')
        expect(gruposChamados).not.toContain('gpt-4o-mini-premium')
      })

      /**
       * Os casos acima exercitam o método. Este exercita **o caminho que roda**: um
       * check pode estar perfeito e simplesmente não constar da lista do `avaliar()`,
       * e nenhum teste do método perceberia. Já aconteceu nesta base — um teste passou
       * 11/11 com o defeito reintroduzido por testar o auxiliar em vez do caminho.
       */
      it('aparece no relatório de run() — não basta o método existir', async () => {
        comSondas([
          { ok: false, status: 404, body: '{"error":{"message":"model does not exist"}}' },
          { ok: true }, { ok: true },
        ])
        const { service } = buildService()

        const r = await service.run('proj-1')

        const check = r.resultados.find((x) => x.id === 'modelos_llm_respondem')
        expect(check).toBeDefined()
        expect(check!.ok).toBe(false)
        expect(r.totalFalha).toBeGreaterThanOrEqual(1)
      })
    })

    it('onModuleInit respeita INVARIANTS_CYCLE_ENABLED=false', () => {
      const anterior = process.env.INVARIANTS_CYCLE_ENABLED
      process.env.INVARIANTS_CYCLE_ENABLED = 'false'
      const { service } = buildService()

      service.onModuleInit()
      const timers = service as unknown as { warmupTimer: unknown }
      expect(timers.warmupTimer).toBeNull()

      process.env.INVARIANTS_CYCLE_ENABLED = anterior
      service.onModuleDestroy()
    })
  })
})

/**
 * ── Conversa geral não é registro órfão (17/09) ──────────────────────────────
 *
 * `registro_sem_projeto` conta `Event`/`Document` sem `projectId`. Isso conflundia duas coisas
 * opostas: trabalho que **perdeu** o dono (hook fora de repositório registrado, indexação sem
 * escopo) e conversa que **nunca teve** dono por escolha.
 *
 * Marcelo decidiu em 17/09 que conversa sem projeto é o **contexto geral**, e é deliberada — o HUB
 * vai abrir assim. `source: 'chat'` com `projectId` nulo é exatamente essa marca: o orquestrador
 * SEMPRE passa `projectId`, ele só vem `undefined` quando a conversa não tem projeto.
 *
 * A exclusão é por `source` e não por um campo novo porque **a distinção já estava no dado** —
 * criar marcador seria inventar mecanismo para algo que o schema já dizia.
 *
 * Medido no mesmo dia, dos 245 órfãos: 162 eram `execution` (defeito do `enqueue`, que nunca
 * passava `projectId`), 20 eram `chat` (geral legítimo) e o resto `cli`/`index` (perderam o dono).
 */
describe('registrosSemProjeto — exclui o escopo geral', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'core', 'v1-bridge.service.ts'),
    'utf8',
  ) as string

  /**
   * ── A lista de canais saiu em 18/09, e a saída é o conserto ───────────────
   *
   * Ela nasceu excluindo `source: 'chat'` (17/09) e no dia seguinte precisou de `hub`. Isso já era
   * o sintoma: **ausência não distingue nada**, então o `source` fazia as vezes de marcador e a
   * lista cresceria a cada canal novo. Pior, `Document` não tem `source` — lá a distinção nem
   * existia.
   *
   * Com o contexto geral virando um `Project` de verdade, o registro geral **tem dono**, e o que
   * sobra sem dono é só o que de fato perdeu. O teste exige as duas coisas: o critério simples, e
   * nenhuma lista sobrevivendo.
   */
  it('o critério é só "sem dono", sem lista de canais', () => {
    expect(fonte).toMatch(/const soPerdeuDono = \{ projectId: null \}/)
    expect(fonte).not.toMatch(/CANAIS_DE_CONVERSA/)
  })

  /**
   * As duas contagens de EVENTO usam o mesmo critério. Sem isso, passivo e recente mediriam
   * populações diferentes e o detalhe do invariante compararia números que não se comparam.
   *
   * Uma versão anterior exigia simetria também nos DOCUMENTOS e **reprovou o código**; a lição
   * ficou que o teste estava errado — `Document` não tem `source`, e forçar a simetria teria posto
   * filtro por um campo que a tabela não tem. Em 18/09 a assimetria sumiu sozinha: o critério
   * deixou de mencionar `source`.
   */
  it('o critério vale para os dois lados de EVENTO — passivo e recente', () => {
    const bloco = fonte.slice(fonte.indexOf('registrosSemProjeto'), fonte.indexOf('registrosSemProjeto') + 3200)
    // Sem isso, passivo e recente mediriam populacoes diferentes e o detalhe do invariante
    // compararia numeros que nao se comparam.
    expect((bloco.match(/soPerdeuDono/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(bloco).toMatch(/event\.count\(\{ where: soPerdeuDono \}\)/)
    expect(bloco).toMatch(/event\.count\(\{ where: \{ \.\.\.soPerdeuDono/)
  })

  it('documento não filtra por source — a tabela não tem esse campo', () => {
    const bloco = fonte.slice(fonte.indexOf('registrosSemProjeto'), fonte.indexOf('registrosSemProjeto') + 3200)
    expect(bloco).toMatch(/document\.count\(\{ where: \{ projectId: null \}/)
  })
})
