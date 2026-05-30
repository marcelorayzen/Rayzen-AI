import { Injectable, Logger } from '@nestjs/common'
import { V1ApiService } from '../core/v1-api.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { KnowledgeExtractorService } from './knowledge-extractor.service'
import { KnowledgeStorageService, EntityType } from './knowledge-storage.service'

interface BuildSource {
  type:    string
  label:   string
  content: string
}

export interface BuildResult {
  projectId:     string
  sourcesRead:   number
  tripletsFound: number
  nodesCreated:  number
  edgesCreated:  number
  sources:       string[]
  durationMs:    number
}

@Injectable()
export class KnowledgeGraphBuilderService {
  private readonly logger = new Logger(KnowledgeGraphBuilderService.name)

  constructor(
    private readonly v1Api:     V1ApiService,
    private readonly v1Bridge:  V1BridgeService,
    private readonly extractor: KnowledgeExtractorService,
    private readonly storage:   KnowledgeStorageService,
  ) {}

  async build(projectId: string): Promise<BuildResult> {
    const t0 = Date.now()
    const sources: BuildSource[] = []
    const sourceLabels: string[] = []

    // 1. Project state (objective, milestones, blockers)
    try {
      const state = await this.v1Bridge.getProjectState(projectId)
      if (state) {
        const text = [
          state.objective  ? `Objetivo: ${state.objective}`            : '',
          state.stage      ? `Stage atual: ${state.stage}`             : '',
          ...(state.milestones as Array<{ title?: string }> ?? []).map((m) => `Milestone: ${m.title ?? m}`),
          ...(state.blockers   as Array<{ title?: string }> ?? []).map((b) => `Blocker: ${b.title ?? b}`),
          ...(state.nextSteps  as Array<{ title?: string }> ?? []).map((n) => `Próximo passo: ${n.title ?? n}`),
        ].filter(Boolean).join('\n')
        if (text.length > 30) {
          sources.push({ type: 'project_state', label: 'Project State', content: text })
          sourceLabels.push('project_state')
        }
      }
    } catch (e) { this.logger.warn(`project_state: ${e}`) }

    // 2. Active goal
    try {
      const goal = await this.v1Bridge.getProjectGoal(projectId)
      if (goal) {
        const criteria = (goal.successCriteria as Array<{ description: string }> ?? [])
          .map((c) => `Critério de sucesso: ${c.description}`)
        const text = [`Meta: ${goal.title}`, ...criteria].join('\n')
        sources.push({ type: 'active_goal', label: 'Active Goal', content: text })
        sourceLabels.push('active_goal')
      }
    } catch (e) { this.logger.warn(`goal: ${e}`) }

    // 3. Decision events
    try {
      const events = await this.v1Api.getDecisionEvents(projectId, 20)
      if (events.length > 0) {
        const text = events.map((e) => `Decisão: ${String(e.content).slice(0, 200)}`).join('\n')
        sources.push({ type: 'decision_events', label: 'Decision Events', content: text })
        sourceLabels.push(`${events.length} decision events`)
      }
    } catch (e) { this.logger.warn(`decision_events: ${e}`) }

    // 4. Project documents (decisions_log, project_state doc)
    try {
      const docs = await this.v1Api.getProjectDocs(projectId)
      const relevant = docs.filter((d) =>
        ['decisions_log', 'project_state', 'data_map'].includes(d.type) && d.content?.length > 50
      )
      for (const doc of relevant) {
        sources.push({ type: `doc_${doc.type}`, label: `Document: ${doc.type}`, content: doc.content })
        sourceLabels.push(`doc:${doc.type}`)
      }
    } catch (e) { this.logger.warn(`docs: ${e}`) }

    // 5. Wiki pages linked to this project
    try {
      const pages = await this.v1Api.listWikiPages()
      const projectPages = pages.slice(0, 10) // limit to 10 pages
      for (const page of projectPages) {
        const detail = await this.v1Api.getWikiPage(page.slug)
        if (detail?.content && detail.content.length > 50) {
          sources.push({ type: 'wiki', label: `Wiki: ${page.title}`, content: detail.content.slice(0, 3000) })
          sourceLabels.push(`wiki:${page.slug}`)
        }
      }
    } catch (e) { this.logger.warn(`wiki: ${e}`) }

    this.logger.log(`Building graph for ${projectId} — ${sources.length} sources`)

    // Extract and persist triplets from all sources
    let totalTriplets = 0
    let totalNodes    = 0
    let totalEdges    = 0

    const projectContext = `Project ID: ${projectId}`

    for (const source of sources) {
      try {
        const triplets = await this.extractor.extract(source.content, projectContext)
        for (const t of triplets) {
          const fromNode = await this.storage.upsertNode({
            projectId,
            type:  t.fromType as EntityType,
            label: t.from,
          })
          const toNode = await this.storage.upsertNode({
            projectId,
            type:  t.toType as EntityType,
            label: t.to,
          })

          const isNew = await this.storage.upsertEdge({
            projectId,
            fromId:   fromNode.id,
            toId:     toNode.id,
            relation: t.relation,
            weight:   t.weight ?? 1.0,
            source:   'extracted',
          })

          totalTriplets++
          totalNodes += 2 // approximate (upsert may reuse)
          if (isNew) totalEdges++
        }
        this.logger.debug(`${source.label}: ${triplets.length} triplets`)
      } catch (e) {
        this.logger.warn(`extraction failed for ${source.label}: ${e}`)
      }
    }

    // Count actual nodes/edges in DB for accurate result
    const graph = await this.storage.getGraph(projectId)

    return {
      projectId,
      sourcesRead:   sources.length,
      tripletsFound: totalTriplets,
      nodesCreated:  graph.nodeCount,
      edgesCreated:  graph.edgeCount,
      sources:       sourceLabels,
      durationMs:    Date.now() - t0,
    }
  }
}
