import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'

export interface ExtractedTriplet {
  from:     string      // label da entidade origem
  fromType: string      // EntityType
  relation: string      // ex: depende_de, contém, impacta
  to:       string      // label da entidade destino
  toType:   string
  weight?:  number
}

const EXTRACT_SYSTEM = `You are a knowledge graph extractor. Given a text about a software project, extract structural relationships as triplets.

Return a JSON array of triplets:
[
  {
    "from": "entity label",
    "fromType": "module|rule|entity|adr|flow|file|concept",
    "relation": "depende_de|contém|impacta|pertence_a|usa|implementa|define|valida",
    "to": "entity label",
    "toType": "module|rule|entity|adr|flow|file|concept",
    "weight": 0.8
  }
]

Focus on:
- Module dependencies and relationships
- Business entities and rules
- Data flows between components
- Architecture decisions (ADRs) and what they impact

Return only valid JSON. Maximum 20 triplets per call.`

@Injectable()
export class KnowledgeExtractorService {
  private readonly logger = new Logger(KnowledgeExtractorService.name)

  constructor(private readonly llm: LlmService) {}

  async extract(text: string, projectContext?: string): Promise<ExtractedTriplet[]> {
    const context = projectContext ? `\n\nProject context: ${projectContext}` : ''
    const result = await this.llm.chat([
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user',   content: `Extract relationships from this text:${context}\n\n${text.slice(0, 4000)}` },
    ], { model: 'gpt-4o', temperature: 0.1, maxTokens: 2000 })

    try {
      const parsed = this.llm.extractJson(result.content) as ExtractedTriplet[]
      return Array.isArray(parsed) ? parsed.filter(this.isValid) : []
    } catch (e) {
      this.logger.warn(`extraction parse error: ${e}`)
      return []
    }
  }

  private isValid(t: ExtractedTriplet): boolean {
    return Boolean(t.from && t.to && t.relation)
  }
}
