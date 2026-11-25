import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { RayzenConfigService, type RayzenConfig } from '../configuration/configuration.service'

// Custo estimado por 1M tokens (input+output combinado, estimativa conservadora)
// Fonte: preços Groq/Anthropic 2025
const MODEL_COST_PER_M: Record<string, number> = {
  'gpt-4o-premium': 9.00,   // Claude Sonnet direto
  'gpt-4o':         0.70,   // Groq openai/gpt-oss-120b (primário)
  'gpt-4o-mini':    0.10,   // Groq openai/gpt-oss-20b (primário)
  'gpt-4o-mini-premium': 1.00, // Claude Haiku direto
}

// Mapeamento módulo → modelo usado (ver CLAUDE.md — Modelos LLM por módulo)
const MODULE_MODEL: Record<string, string> = {
  'project-state':      'gpt-4o-premium',
  'synthesis':          'gpt-4o',
  'orchestrator':       'gpt-4o',
  'documentation':      'gpt-4o',
  'blueprint':          'gpt-4o',
  'content-engine':     'gpt-4o',
  'graph':              'gpt-4o-mini',
  'brain':              'gpt-4o-mini',
  'validation':         'gpt-4o-mini',
  'proactive':          'gpt-4o-mini',
}

// Módulos cujo modelo NÃO é fixo: quem decide é a configuração, em runtime.
// Manter a decisão aqui duplicada de `project-state.service.ts` foi exatamente o defeito —
// o painel cobrava premium ($9,00/1M) enquanto `premiumStateRefresh` era `false` e o módulo
// rodava em `gpt-4o` ($0,70/1M). Erro de 12,86× num módulo que sozinho respondia por 84% do
// total exibido: $10,5208 no mês contra ~$2,37 reais.
const MODULE_MODEL_RUNTIME: Record<string, (cfg: RayzenConfig) => string> = {
  // espelha project-state.service.ts: `premiumStateRefresh ? 'gpt-4o-premium' : 'gpt-4o'`
  'project-state': (cfg) => (cfg.premiumStateRefresh ?? false) ? 'gpt-4o-premium' : 'gpt-4o',
}

function tokensToUSD(tokens: number, model: string): number {
  const rate = MODEL_COST_PER_M[model] ?? MODEL_COST_PER_M['gpt-4o']
  return parseFloat(((tokens / 1_000_000) * rate).toFixed(6))
}

export interface CostPeriod {
  tokens: number
  messages: number
  costUSD: number
}

export interface ModuleBreakdown {
  module: string
  model: string
  tokens: number
  messages: number
  costUSD: number
}

export interface ProjectBreakdown {
  projectId: string | null
  projectName: string | null
  tokens: number
  costUSD: number
}

export interface CostSummary {
  period: string
  totals: CostPeriod
  byModule: ModuleBreakdown[]
  byProject: ProjectBreakdown[]
  pricing: typeof MODEL_COST_PER_M
}

@Injectable()
export class CostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rayzenConfig: RayzenConfigService,
  ) {}

  // Resolve o modelo real do módulo. Estático quando é estático; pela configuração
  // quando quem decide é o runtime.
  private inferModel(module: string): string {
    const emRuntime = MODULE_MODEL_RUNTIME[module]
    if (emRuntime) {
      // Config indisponível: cai no estático, que é o comportamento anterior.
      try { return emRuntime(this.rayzenConfig.getConfig()) } catch { /* abaixo */ }
    }
    return MODULE_MODEL[module] ?? 'gpt-4o'
  }

  private periodStart(period: string): Date {
    const now = new Date()
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate())
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1)
      default:
        return new Date(0)  // all time
    }
  }

  async summary(period = 'month', projectId?: string): Promise<CostSummary> {
    const since = this.periodStart(period)
    const where = {
      createdAt: { gte: since },
      ...(projectId ? { projectId } : {}),
    }

    const [byModule, byProject] = await Promise.all([
      this.prisma.conversationMessage.groupBy({
        by: ['module'],
        where,
        _sum: { tokensUsed: true },
        _count: { id: true },
        orderBy: { _sum: { tokensUsed: 'desc' } },
      }),
      this.prisma.conversationMessage.groupBy({
        by: ['projectId'],
        where,
        _sum: { tokensUsed: true },
        _count: { id: true },
        orderBy: { _sum: { tokensUsed: 'desc' } },
      }),
    ])

    const moduleRows: ModuleBreakdown[] = byModule.map((r) => {
      const model = this.inferModel(r.module)
      const tokens = r._sum.tokensUsed ?? 0
      return {
        module: r.module,
        model,
        tokens,
        messages: r._count.id,
        costUSD: tokensToUSD(tokens, model),
      }
    })

    const projectIds = byProject.map((r) => r.projectId).filter(Boolean) as string[]
    const projects = projectIds.length
      ? await this.prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
      : []
    const nameMap = new Map(projects.map((p) => [p.id, p.name]))

    const projectRows: ProjectBreakdown[] = byProject.map((r) => {
      const tokens = r._sum.tokensUsed ?? 0
      const avgModel = 'gpt-4o'  // estimativa média para custo por projeto
      return {
        projectId: r.projectId,
        projectName: r.projectId ? (nameMap.get(r.projectId) ?? null) : null,
        tokens,
        costUSD: tokensToUSD(tokens, avgModel),
      }
    })

    const totalTokens = moduleRows.reduce((acc, r) => acc + r.tokens, 0)
    const totalCost = moduleRows.reduce((acc, r) => acc + r.costUSD, 0)
    const totalMessages = moduleRows.reduce((acc, r) => acc + r.messages, 0)

    return {
      period,
      totals: { tokens: totalTokens, messages: totalMessages, costUSD: parseFloat(totalCost.toFixed(4)) },
      byModule: moduleRows,
      byProject: projectRows,
      pricing: MODEL_COST_PER_M,
    }
  }
}
