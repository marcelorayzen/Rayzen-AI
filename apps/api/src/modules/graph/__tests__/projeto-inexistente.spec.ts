import { NotFoundException } from '@nestjs/common'
import { GraphService } from '../graph.service'
import { KnowledgeGraphService } from '../knowledge-graph.service'

/**
 * ── Coleção vazia não pode ser a resposta para um id que não existe ──────────
 *
 * Medido em produção em 15/09, contra `00000000-0000-0000-0000-000000000000`:
 *
 * | rota | antes |
 * |---|---|
 * | `GET /projects/:id/graph/goal` | 404 ✅ (herdou o conserto do `/state`) |
 * | `GET /projects/:id/graph` | 404 ✅ |
 * | `GET /projects/:id/graph/events` | 404 ✅ |
 * | `GET /projects/:id/graph/goals` | **200 `[]`** |
 * | `GET /projects/:id/graph/knowledge` | **200 `{nodes:[],edges:[]}`** |
 *
 * As três primeiras já respondiam certo **de carona**: passam por `ProjectStateService.get()`,
 * consertado em 14/09. As duas últimas não passam por lá, e cada uma afirmava um fato —
 * *este projeto não tem meta nenhuma*, *este projeto não tem conhecimento nenhum* — sobre um
 * projeto que não existe. Para o painel é confusão; para um consumidor automático (MCP, Hermes)
 * é conhecimento inventado, que é como o Hermes respondeu sobre o projeto DEFAULT ao ser
 * perguntado por um id inexistente.
 *
 * A checagem é **condicional ao resultado vazio**: projeto real com meta nenhuma continua
 * devolvendo `200 []`, e o caminho comum (tem dado) não paga query extra.
 */
describe('rotas de grafo — id inexistente responde 404, coleção vazia continua 200', () => {


  /** `project.findUnique` devolve null = o id não existe. */
  function prismaCom(projetoExiste: boolean) {
    return {
      project:     { findUnique: jest.fn().mockResolvedValue(projetoExiste ? { id: 'p1' } : null) },
      projectGoal:     { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      event:           { findMany: jest.fn().mockResolvedValue([]) },
      projectDocument: { findMany: jest.fn().mockResolvedValue([]) },
      wikiPage:        { findMany: jest.fn().mockResolvedValue([]) },
      sessionArtifact: { findMany: jest.fn().mockResolvedValue([]) },
    }
  }

  function graph(prisma: unknown) {
    return new GraphService(
      prisma as never, {} as never, {} as never,
      { get: jest.fn() } as never, {} as never, {} as never,
    )
  }

  describe('listGoals', () => {
    it('projeto inexistente → 404, em vez de lista vazia', async () => {
      await expect(graph(prismaCom(false)).listGoals('fantasma')).rejects.toThrow(NotFoundException)
    })

    it('projeto real sem meta nenhuma → lista vazia, como antes', async () => {
      await expect(graph(prismaCom(true)).listGoals('p1')).resolves.toEqual([])
    })
  })

  describe('knowledge graph', () => {
    it('projeto inexistente → 404, em vez de grafo vazio', async () => {
      const service = new KnowledgeGraphService(prismaCom(false) as never)
      await expect(service.build('fantasma')).rejects.toThrow(NotFoundException)
    })

    it('projeto real sem nada indexado → grafo vazio, como antes', async () => {
      const service = new KnowledgeGraphService(prismaCom(true) as never)
      await expect(service.build('p1')).resolves.toEqual({ nodes: [], edges: [] })
    })
  })

  /**
   * A regra precisa ter UM lugar. Esta era a terceira cópia da mesma checagem; a quarta
   * repetiria o problema das `SAFE_ROOTS` divergentes, em que a correção vira "arrumar em N
   * lugares e esquecer o N+1".
   */
  it('a checagem só custa query quando não havia o que devolver', async () => {
    const prisma = prismaCom(true)
    prisma.projectGoal.findMany.mockResolvedValue([{ id: 'g1' }])

    await graph(prisma).listGoals('p1')

    expect(prisma.project.findUnique).not.toHaveBeenCalled()
  })
})
