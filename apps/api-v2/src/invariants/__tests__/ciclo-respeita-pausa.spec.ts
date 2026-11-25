import { readFileSync } from 'fs'
import { join } from 'path'
import { InvariantsService } from '../invariants.service'

/**
 * ── A metade da promessa que não tinha sido entregue ────────────────────────
 *
 * `Project.status` ganhou ciclo de vida em 20/09 (`active` · `paused` · `done`), e o que foi
 * prometido era: *"os ciclos que varrem `active` param de varrê-los sozinhos"*.
 *
 * Só o auto-checkpoint parava. **Este ciclo não**: ele itera `project_catalog` com
 * `archivedAt: null`, e o sync do catálogo só **cria** entradas — nunca arquiva. Oito projetos
 * marcados como pausados continuavam sendo avaliados 48 vezes por dia, e nada acusaria: o
 * relatório sai igual, verde, sobre um projeto que ninguém toca desde maio.
 *
 * ── Interseção, e não arquivar a entrada ──────────────────────────────────
 *
 * `archivedAt` também é curadoria humana. Um sync que arquivasse sozinho desfaria a decisão de
 * quem arquivou à mão, ou a reintroduziria ao reabrir o projeto. Filtrando na leitura, nada é
 * escrito e reabrir devolve a varredura sem passo nenhum.
 *
 * ── E a falha ABRE, não fecha ─────────────────────────────────────────────
 *
 * Se a lista de ativos não vier, varre tudo — o comportamento anterior. Sensor que emudece
 * quando não consegue ler é exatamente o modo de falha que este catálogo existe para evitar; é a
 * mesma razão pela qual `historico_serve_conversa` devolve *inconclusivo* em vez de `ok` quando a
 * V1 não responde.
 */
describe('o ciclo de invariantes respeita o projeto pausado', () => {
  const fonte = readFileSync(join(__dirname, '..', 'invariants.service.ts'), 'utf8')
  const ciclo = fonte.slice(
    fonte.indexOf('async runForAllProjects'),
    fonte.indexOf('async runForAllProjects') + 4200,
  )

  it('cruza o catálogo com os projetos ATIVOS da V1', () => {
    expect(ciclo).toMatch(/this\.bridge\.listProjects\(\)/)
    expect(ciclo).toMatch(/ativos\s*\?\s*doCatalogo\.filter/)
  })

  /**
   * ── O ramo que os testes existentes descobriram ───────────────────────────
   *
   * `disco_com_folga`, `redis_exige_senha`, `modelos_llm_respondem` e `embeddings_respondem` não
   * são sobre projeto: medem a máquina e as dependências de fora. Eles só rodam porque a varredura
   * é por projeto — acoplamento, não desenho.
   *
   * Sem este ramo, pausar **todos** os projetos desligaria o monitoramento de disco, Redis e LLM
   * de uma vez, sem erro e sem aviso. Seria o apagão de 16/09 outra vez, agora causado por uma
   * decisão de produto que não tinha isso em vista.
   */
  it('filtrar até zerar cai de volta no catálogo — sensor global não pode morrer por pausa', () => {
    expect(ciclo).toMatch(/soAtivos\.length > 0 \? soAtivos : doCatalogo/)
    expect(ciclo).toMatch(/sensores globais/)
  })

  it('e continua lendo o catálogo, não substituindo a fonte', () => {
    expect(ciclo).toMatch(/projectCatalog[\s\S]{0,120}archivedAt: null/)
  })

  /**
   * A asserção que importa: o ramo de erro varre TUDO. Invertido, uma falha de leitura da V1
   * silenciaria os 19 invariantes de todos os projetos — sem erro, sem relatório, sem alerta.
   */
  it('falha ao listar ativos varre tudo, em vez de silenciar o sensor', () => {
    expect(ciclo).toMatch(/\.catch\([\s\S]{0,200}return null/)
    expect(ciclo).toMatch(/const soAtivos = ativos \? doCatalogo\.filter\(\(p\) => ativos\.has\(p\.v1ProjectId\)\) : doCatalogo/)
  })

  /**
   * Nada de escrita no catálogo: arquivar sozinho desfaria curadoria humana. O teste olha o
   * trecho do ciclo, não o arquivo inteiro — o `catalog.service` legitimamente escreve.
   */
  it('não arquiva a entrada do catálogo para conseguir o efeito', () => {
    expect(ciclo).not.toMatch(/projectCatalog\.update/)
    expect(ciclo).not.toMatch(/archivedAt:\s*new Date/)
  })
})

/**
 * ── A sonda de embeddings nunca foi por projeto ────────────────────────────
 *
 * Medido em 19/09: **60 chamadas à Jina no dia**, e a pergunta natural foi se pausar projetos
 * reduziria isso. Não reduz — e o motivo é o cache ser **estático**, portanto global ao processo,
 * não por projeto. Com ciclo de 30 min e cache de 10, já era uma chamada real por ciclo.
 *
 * Este teste existe para que a resposta fique medida e não precise ser redescoberta: quem quiser
 * menos chamadas mexe na cadência da sonda, não na contagem de projetos.
 */
describe('a sonda de embeddings é global, não por projeto', () => {
  const fonte = readFileSync(join(__dirname, '..', 'invariants.service.ts'), 'utf8')

  it('o cache é estático — um por processo, não um por projeto', () => {
    expect(fonte).toMatch(/static\s+cacheEmbeddings/)
    expect(fonte).toMatch(/InvariantsService\.cacheEmbeddings/)
  })
})

/**
 * ── Sensor global rodava uma vez POR PROJETO ────────────────────────────────
 *
 * A assinatura já dizia quais eram: de 19 checagens, **duas** recebem `projectId`
 * (`missaoNaoTravada`, `memoriaRelevanteServeUtil`). As outras 17 medem a máquina (disco), as
 * dependências de fora (LLM, embeddings, Redis, Telegram) ou o banco inteiro (migrações, registro
 * órfão, benchmark).
 *
 * Com 10 projetos no catálogo isso eram **190 avaliações por ciclo, 153 delas redundantes** — a
 * mesma pergunta sobre o mesmo disco, dez vezes, 48 vezes por dia.
 *
 * Três já tinham cache próprio (LLM e embeddings, 10 min), cada uma resolvendo o problema sozinha
 * com uma constante diferente, sem nomear a causa. `global: true` é a causa nomeada.
 *
 * O teste CONTA chamadas em vez de afirmar que a redundância sumiu — enunciado sem medida é o que
 * esta casa evita.
 */
describe('o sensor global roda uma vez por CICLO, não por projeto', () => {
  // Rede indisponível no teste: os checks que sondam fora devolvem "inconclusivo" em vez de
  // esperar o timeout real — mesmo arranjo de `invariants.service.spec.ts`.
  beforeEach(() => {
    global.fetch = jest.fn().mockRejectedValue(new Error('sem rede')) as unknown as typeof fetch
  })

  const montar = (projetos: string[]) => {
    const prisma = {
      $queryRaw:       jest.fn().mockResolvedValue([{ ok: 1 }]),
      invariantReport: {
        create:    jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany:  jest.fn().mockResolvedValue([]),
      },
      projectCatalog:  { findMany: jest.fn().mockResolvedValue(projetos.map((id) => ({ v1ProjectId: id }))) },
      strategy:        { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      benchmarkResult: { count: jest.fn().mockResolvedValue(0) },
      approvalGate:    { findMany: jest.fn().mockResolvedValue([]) },
      hypothesis:      { findMany: jest.fn().mockResolvedValue([]) },
      benchmarkCase:   { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      mission:         { findMany: jest.fn().mockResolvedValue([]) },
    }
    const bridge = {
      listProjects:        jest.fn().mockResolvedValue(projetos.map((id) => ({ id, name: id }))),
      getProject:          jest.fn().mockResolvedValue({ id: 'p1', name: 'P', repoSlug: 'p' }),
      registrosSemProjeto: jest.fn().mockResolvedValue({ eventos: 0, eventosRecentes: 0, documentos: 0, documentosRecentes: 0 }),
    }
    const service = new InvariantsService(
      prisma as never, bridge as never,
      { beat: jest.fn().mockResolvedValue(undefined) } as never,
      { diagnosticarMemoria: jest.fn().mockResolvedValue([]) } as never,
    )
    return { service, prisma, bridge }
  }

  /**
   * `registrosSemProjeto` é GLOBAL e é a sonda mais fácil de contar: uma chamada à ponte por
   * avaliação. Se o ciclo varre 4 projetos e ela for chamada 4 vezes, a redundância voltou.
   */
  it('a checagem global é avaliada UMA vez, com 4 projetos no catálogo', async () => {
    const { service, bridge } = montar(['p1', 'p2', 'p3', 'p4'])

    await service.runForAllProjects()

    expect(bridge.registrosSemProjeto).toHaveBeenCalledTimes(1)
  })

  /**
   * O teto de 10 vale DEPOIS de tirar os pausados. Cortado antes, no `findMany`, um catálogo com
   * muitos pausados deixava o projeto ativo de fora: o `rayzen-marcenaria` ficou sem medição de
   * 12/11 a 19/11. O mock respeita `take` como o Prisma, senão o teste passaria com o defeito.
   */
  it('projeto ativo depois de 12 pausados no catálogo ainda é varrido', async () => {
    const catalogo = [...Array.from({ length: 12 }, (_, i) => `pausado-${i}`), 'ativo']
    const { service, prisma, bridge } = montar(catalogo)
    prisma.projectCatalog.findMany.mockImplementation((args?: { take?: number }) =>
      Promise.resolve(catalogo.slice(0, args?.take ?? catalogo.length).map((id) => ({ v1ProjectId: id }))))
    bridge.listProjects.mockResolvedValue([{ id: 'ativo', name: 'ativo' }])

    await service.runForAllProjects()

    const projetosGravados = prisma.invariantReport.create.mock.calls.map(([{ data }]) => data.projectId)
    expect(projetosGravados).toEqual(['ativo'])
  })

  /** E o relatório de cada projeto continua completo — a economia não pode comer resultado. */
  it('cada projeto ainda recebe os 19 resultados', async () => {
    const { service, prisma } = montar(['p1', 'p2'])

    await service.runForAllProjects()

    const gravados = prisma.invariantReport.create.mock.calls
    expect(gravados.length).toBeGreaterThan(0)
    for (const [{ data }] of gravados) {
      expect((data.resultados as unknown[]).length).toBe(19)
    }
  })

  /**
   * O pedido HUMANO reavalia tudo: quem clicou quer o estado de agora, não o de até 30 minutos
   * atrás. Sem esta separação, `run()` devolveria o cache do ciclo e o botão viraria enfeite.
   */
  it('`run()` sob demanda NÃO reaproveita — reavalia o global', async () => {
    const { service, bridge } = montar(['p1'])

    await service.run('p1')
    await service.run('p1')

    expect(bridge.registrosSemProjeto).toHaveBeenCalledTimes(2)
  })
})
