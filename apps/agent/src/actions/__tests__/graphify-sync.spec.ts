import { extractFileLineage, detectRoute, GraphifyGraph } from '../graphify-sync'

/**
 * Achado real: graph.edges.length era usado pra contar arestas, mas o graph.json
 * de verdade usa a chave "links", não "edges" — graph.edges era undefined e
 * jogava TypeError toda vez que jarvis:graphify_sync rodava (nunca funcionou).
 * extractFileLineage() é a parte nova: lê graph.links com relation 'imports_from'
 * e monta o lineage real de arquivo, porque é o único lugar com acesso ao
 * graphify-out/graph.json local (gitignored, nunca chega no servidor).
 */
describe('extractFileLineage', () => {
  function buildGraph(): GraphifyGraph {
    return {
      nodes: [
        { id: 'a', label: 'a.ts', source_file: 'apps\\api\\src\\modules\\qa\\a.ts' },
        { id: 'b', label: 'b.ts', source_file: 'apps\\api\\src\\modules\\qa\\b.ts' },
        { id: 'pkg', label: 'lodash', source_file: undefined },
      ],
      links: [
        { source: 'a', target: 'b', relation: 'imports_from' },
        { source: 'a', target: 'pkg', relation: 'imports_from' }, // externo, sem source_file no target
        { source: 'a', target: 'b', relation: 'calls' }, // relation errada, deve ser ignorada
      ],
    }
  }

  it('extrai um edge from->to só para imports_from resolvidos internamente', () => {
    const result = extractFileLineage(buildGraph(), 'C:/repo')

    expect(result.edges).toEqual([
      { from: 'apps/api/src/modules/qa/a.ts', to: 'apps/api/src/modules/qa/b.ts' },
    ])
  })

  it('lista um file entry por source_file único (independente de quantos nodes apontam pra ele)', () => {
    const result = extractFileLineage(buildGraph(), 'C:/repo')

    const paths = result.files.map(f => f.path)
    expect(paths).toContain('apps/api/src/modules/qa/a.ts')
    expect(paths).toContain('apps/api/src/modules/qa/b.ts')
    expect(paths).not.toContain(undefined)
  })

  it('ignora imports_from para target sem source_file (pacote externo)', () => {
    const graph = buildGraph()
    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.some(e => e.to === 'lodash')).toBe(false)
  })

  it('deduplica edges repetidos entre o mesmo par de arquivos', () => {
    const graph = buildGraph()
    graph.links.push({ source: 'a', target: 'b', relation: 'imports_from' })

    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.filter(e => e.from === 'apps/api/src/modules/qa/a.ts' && e.to === 'apps/api/src/modules/qa/b.ts')).toHaveLength(1)
  })

  it('descarta self-loop (arquivo que "importa de si mesmo" por ruído de extração)', () => {
    const graph = buildGraph()
    graph.links.push({ source: 'a', target: 'a', relation: 'imports_from' })

    const result = extractFileLineage(graph, 'C:/repo')

    expect(result.edges.some(e => e.from === e.to)).toBe(false)
  })
})

describe('detectRoute', () => {
  it('marca isRoute:false para arquivo que não termina em .controller.ts', () => {
    expect(detectRoute('C:/repo', 'apps/api/src/modules/qa/qa.service.ts')).toEqual({ isRoute: false })
  })

  it('marca isRoute:true (sem prefix) quando o arquivo .controller.ts não existe em disco', () => {
    const result = detectRoute('C:/repo-inexistente', 'apps/api/src/modules/qa/qa.controller.ts')
    expect(result.isRoute).toBe(true)
  })
})
