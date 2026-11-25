import { Injectable, Logger } from '@nestjs/common'
import { LlmService } from '../llm/llm.service'
import { PrismaV2Service } from '../core/prisma-v2.service'

export type KnowledgeOrigin = 'manual' | 'extracted' | 'inferred' | 'document' | 'meeting' | 'adr'

export interface GovernanceCheckInput {
  projectId:   string
  label:       string
  type:        string
  description?: string
  origin?:     KnowledgeOrigin
}

export interface GovernanceResult {
  trustScore:     number          // 0-1
  hasConflict:    boolean
  conflictDetail?: string         // descrição da contradição encontrada
  recommendation: 'accept' | 'flag' | 'reject'
  existingNodeId?: string
}

/** Peso de confiança por origem da informação */
const ORIGIN_WEIGHT: Record<KnowledgeOrigin, number> = {
  manual:    1.0,   // entrada humana direta
  adr:       0.95,  // decisão arquitetural registrada
  document:  0.85,  // documento formal
  meeting:   0.75,  // reunião / entrevista
  extracted: 0.70,  // extração automática de texto
  inferred:  0.55,  // inferido pelo LLM sem fonte explícita
}

const ECC_SYSTEM = `Você é um motor de verificação de consistência de conhecimento (ECC).
Dado um nó existente e uma nova informação sobre o mesmo conceito, determine se há contradição.

Responda SOMENTE com JSON:
{
  "isContradiction": true|false,
  "explanation": "breve explicação em PT (1-2 frases)",
  "confidence": 0.0-1.0
}`

@Injectable()
export class KnowledgeGovernanceService {
  private readonly logger = new Logger(KnowledgeGovernanceService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly llm:   LlmService,
  ) {}

  /**
   * Verifica a consistência de uma nova informação antes de persistir.
   * Retorna trust score e flag de conflito se houver contradição com nó existente.
   */
  async check(input: GovernanceCheckInput): Promise<GovernanceResult> {
    const originWeight = ORIGIN_WEIGHT[input.origin ?? 'extracted']

    // Manual entries bypass ECC — human input is the authoritative source and
    // divergence from existing data is treated as an intentional correction, not a conflict.
    if (input.origin === 'manual') {
      const existing = await this.prisma.knowledgeNode.findFirst({
        where: { projectId: input.projectId, label: input.label, type: input.type },
        select: { id: true },
      })
      return { trustScore: 1.0, hasConflict: false, recommendation: 'accept', existingNodeId: existing?.id }
    }

    // Busca nó existente com mesmo label+type+projeto
    const existing = await this.prisma.knowledgeNode.findFirst({
      where: { projectId: input.projectId, label: input.label, type: input.type },
      select: { id: true, description: true, confidence: true, origin: true },
    })

    // Sem conflito possível — nó novo
    if (!existing || !existing.description || !input.description) {
      return { trustScore: originWeight, hasConflict: false, recommendation: 'accept' }
    }

    // Descrições idênticas ou muito similares — sem necessidade de LLM
    const existingNorm = existing.description.toLowerCase().trim()
    const incomingNorm = input.description.toLowerCase().trim()
    if (existingNorm === incomingNorm || incomingNorm.includes(existingNorm) || existingNorm.includes(incomingNorm)) {
      return {
        trustScore: Math.min(1, (existing.confidence + originWeight) / 2 + 0.05),
        hasConflict: false,
        recommendation: 'accept',
        existingNodeId: existing.id,
      }
    }

    // Descrições divergem — chama LLM para verificar contradição (ECC)
    try {
      const result = await this.llm.chat([
        { role: 'system', content: ECC_SYSTEM },
        {
          role: 'user',
          content: `Conceito: "${input.label}" (${input.type})\n\nInformação existente: "${existing.description}"\n\nNova informação: "${input.description}"`,
        },
      ], { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 300 })

      const parsed = this.llm.extractJson(result.content) as {
        isContradiction?: boolean
        explanation?: string
        confidence?: number
      }

      if (parsed.isContradiction) {
        // Contradição detectada: penaliza trust score, recomenda flag
        const penalty = 0.3 * (parsed.confidence ?? 0.8)
        const trustScore = Math.max(0.1, originWeight - penalty)
        return {
          trustScore,
          hasConflict: true,
          conflictDetail: parsed.explanation,
          recommendation: trustScore < 0.3 ? 'reject' : 'flag',
          existingNodeId: existing.id,
        }
      }

      // Informação complementar — aceita e reforça confiança levemente
      return {
        trustScore: Math.min(1, originWeight + 0.05),
        hasConflict: false,
        recommendation: 'accept',
        existingNodeId: existing.id,
      }
    } catch (e) {
      this.logger.warn(`ECC LLM error for "${input.label}": ${e}`)
      // Falha no LLM → aceita com confiança moderada para não bloquear
      return { trustScore: originWeight * 0.8, hasConflict: false, recommendation: 'accept', existingNodeId: existing.id }
    }
  }

  /** Lista todos os nós com conflitos flagados no projeto (metadata.ecc.conflict = true). */
  async listConflicts(projectId: string) {
    const nodes = await this.prisma.knowledgeNode.findMany({
      where: { projectId, confidence: { lt: 0.6 } },
      orderBy: { confidence: 'asc' },
    })
    return nodes.map((n) => ({
      id:          n.id,
      label:       n.label,
      type:        n.type,
      confidence:  n.confidence,
      origin:      n.origin,
      description: n.description,
      conflictDetail: (n.metadata as Record<string, unknown>)?.ecc as Record<string, unknown> | undefined,
    }))
  }
}
