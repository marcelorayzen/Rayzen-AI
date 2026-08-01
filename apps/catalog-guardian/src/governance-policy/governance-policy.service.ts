import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'
import { EmbeddingService } from '../embedding/embedding.service'

export interface CreateGovernancePolicyInput {
  topic: string
  question?: string | null
  description: string
  documentRef?: string | null
  version?: string | null
}

// QA-CHECKLIST.md § 12 "Processo/política" — CRUD simples pro conteúdo
// autoral (processo/política) que nenhum adapter de catálogo tem. A busca
// semântica em si mora em QueryService.askProcess() (mesmo padrão de
// findRelevantGlossaryTerms — QueryService acessa governance_policies via
// $queryRaw direto, não por este service), este service só é o dono da
// escrita/leitura administrativa via HTTP.
@Injectable()
export class GovernancePolicyService {
  private readonly logger = new Logger(GovernancePolicyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async list() {
    return this.prisma.governancePolicy.findMany({
      select: { topic: true, question: true, description: true, documentRef: true, version: true },
      orderBy: { topic: 'asc' },
    })
  }

  // Upsert por topic (não create-only): re-postar o mesmo tópico atualiza o
  // conteúdo em vez de falhar com conflito — mesmo espírito idempotente dos
  // seed scripts do catálogo (PUT), conveniente pra manter a política em
  // dia sem precisar de uma rota PATCH separada.
  async create(input: CreateGovernancePolicyInput) {
    const text = `${input.topic} ${input.question ?? ''} ${input.description}`.trim()
    const vector = await this.embedding.embed(text)

    const policy = await this.prisma.governancePolicy.upsert({
      where: { topic: input.topic },
      create: {
        topic: input.topic,
        question: input.question ?? null,
        description: input.description,
        documentRef: input.documentRef ?? null,
        version: input.version ?? null,
      },
      update: {
        question: input.question ?? null,
        description: input.description,
        documentRef: input.documentRef ?? null,
        version: input.version ?? null,
      },
    })

    await this.prisma.$executeRawUnsafe(
      `UPDATE governance_policies SET embedding = $1::vector WHERE id = $2`,
      JSON.stringify(vector),
      policy.id,
    )
    this.logger.log(`Política de governança "${input.topic}" salva (embedding recalculado)`)

    return policy
  }
}
