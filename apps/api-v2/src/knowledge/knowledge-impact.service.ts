import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'
import { KnowledgeQueryService, GraphSubset } from './knowledge-query.service'

export interface ImpactRequest {
  projectId: string
  change:    string
  entities?: string[]
}

export interface ImpactResult {
  affectedModules: string[]
  affectedRules:   string[]
  affectedFiles:   string[]
  impactDepth:     number
  summary:         string
  graph:           GraphSubset
}

const IMPACT_SYSTEM = `You are a software architect analyzing the impact of a proposed change.
Given a knowledge graph subset and a proposed change, identify:
1. Which modules are affected
2. Which business rules are affected
3. Estimate affected files
4. Provide a clear, concise summary

Return JSON:
{
  "affectedModules": ["module1", "module2"],
  "affectedRules": ["rule1"],
  "affectedFiles": ["estimated/path.ts"],
  "summary": "Clear explanation of impact"
}`

@Injectable()
export class KnowledgeImpactService {
  private readonly logger = new Logger(KnowledgeImpactService.name)

  constructor(
    private readonly query: KnowledgeQueryService,
    private readonly llm:   LlmService,
  ) {}

  async analyze(req: ImpactRequest): Promise<ImpactResult> {
    // Start from mentioned entities or top-level nodes
    const startLabel = req.entities?.[0] ?? undefined

    const subgraph = await this.query.query({
      projectId:  req.projectId,
      startLabel,
      depth:      3,
      relations:  ['impacta', 'depende_de', 'usa'],
    })

    const graphText = [
      `Nodes: ${subgraph.nodes.map((n) => `${n.label}(${n.type})`).join(', ')}`,
      `Relations: ${subgraph.edges.map((e) => {
        const from = subgraph.nodes.find((n) => n.id === e.fromId)?.label ?? e.fromId
        const to   = subgraph.nodes.find((n) => n.id === e.toId)?.label   ?? e.toId
        return `${from} --${e.relation}--> ${to}`
      }).join('; ')}`,
    ].join('\n')

    const result = await this.llm.chat([
      { role: 'system', content: IMPACT_SYSTEM },
      { role: 'user',   content: `Proposed change: "${req.change}"\n\nKnowledge graph:\n${graphText}` },
    ], { model: 'gpt-4o', temperature: 0.2 })

    let parsed: Partial<ImpactResult> = {}
    try {
      parsed = this.llm.extractJson(result.content) as Partial<ImpactResult>
    } catch (e) {
      this.logger.warn(`impact parse error: ${e}`)
    }

    return {
      affectedModules: parsed.affectedModules ?? [],
      affectedRules:   parsed.affectedRules   ?? [],
      affectedFiles:   parsed.affectedFiles   ?? [],
      impactDepth:     subgraph.edges.length > 0 ? 3 : 0,
      summary:         parsed.summary         ?? 'Impact analysis unavailable.',
      graph:           subgraph,
    }
  }
}
