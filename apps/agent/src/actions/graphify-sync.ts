import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface GraphifyNode {
  id: string
  label: string
  file_type?: string
  source_file?: string
}

interface GraphifyEdge {
  source: string
  target: string
  label?: string
}

interface GraphifyGraph {
  nodes: GraphifyNode[]
  edges: GraphifyEdge[]
}

function buildModuleSummary(graph: GraphifyGraph, repoRoot: string): string {
  const moduleMap: Record<string, { files: Set<string>; nodeCount: number }> = {}

  for (const node of graph.nodes) {
    const src = node.source_file
    if (!src) continue
    const normalized = src.replace(/\\/g, '/').replace(repoRoot.replace(/\\/g, '/'), '')

    let module = 'outros'
    const apiMod = normalized.match(/apps\/api\/src\/modules\/([^/]+)/)
    if (apiMod) module = `api:${apiMod[1]}`
    else if (/apps\/web\/app\/components/.test(normalized)) module = 'web:components'
    else if (/apps\/web\/app\/hooks/.test(normalized)) module = 'web:hooks'
    else if (/apps\/web\/app/.test(normalized)) module = 'web:pages'
    else if (/apps\/agent\/src\/actions/.test(normalized)) module = 'agent:actions'
    else if (/apps\/agent\/src\/hooks/.test(normalized)) module = 'agent:hooks'
    else if (/prisma\/schema\.prisma/.test(normalized)) module = 'api:schema'
    else if (/infra\//.test(normalized)) module = 'infra'
    else if (/packages\//.test(normalized)) module = 'packages'

    if (!moduleMap[module]) moduleMap[module] = { files: new Set(), nodeCount: 0 }
    if (src) moduleMap[module].files.add(src)
    moduleMap[module].nodeCount++
  }

  const lines = Object.entries(moduleMap)
    .filter(([, v]) => v.files.size > 0)
    .sort((a, b) => b[1].nodeCount - a[1].nodeCount)
    .map(([mod, v]) => `- ${mod}: ${v.files.size} arquivos, ${v.nodeCount} nós`)

  return lines.join('\n')
}

export async function graphifySync(payload: Record<string, unknown>): Promise<string> {
  const cwd = payload['cwd'] as string | undefined

  // Encontrar raiz do repositório
  let repoRoot: string
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8', cwd: cwd ?? process.cwd(), timeout: 5000,
    }).trim()
  } catch {
    return 'Erro: não está em um repositório git'
  }

  // Rodar graphify update se disponível
  let graphifyRan = false
  try {
    execSync('graphify update .', {
      cwd: repoRoot, encoding: 'utf8', timeout: 60000, stdio: 'pipe',
    })
    graphifyRan = true
  } catch {
    // graphify pode não estar instalado ou sem crédito para semantic pass
  }

  const graphPath = join(repoRoot, 'graphify-out', 'graph.json')
  if (!existsSync(graphPath)) {
    return graphifyRan
      ? 'graphify rodou mas graph.json não encontrado'
      : 'graphify-out/graph.json não encontrado — rode graphify update . primeiro'
  }

  const graph: GraphifyGraph = JSON.parse(readFileSync(graphPath, 'utf8'))
  const moduleSummary = buildModuleSummary(graph, repoRoot)

  const totalNodes = graph.nodes.length
  const totalEdges = graph.edges.length
  const totalFiles = new Set(graph.nodes.map(n => n.source_file).filter(Boolean)).size

  const report = [
    `# Graphify — Snapshot de Arquitetura`,
    `Atualizado: ${new Date().toISOString()}`,
    `Grafo: ${totalNodes} nós, ${totalEdges} arestas, ${totalFiles} arquivos`,
    ``,
    `## Módulos e arquivos`,
    moduleSummary,
  ].join('\n')

  return report
}
