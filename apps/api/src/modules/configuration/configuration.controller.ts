import { Controller, Get, Patch, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { RayzenConfigService, RayzenConfig, LlmProvider, LLM_COST_PER_TOKEN } from './configuration.service'
import { PrismaService } from '../../prisma/prisma.service'

@ApiTags('configuration')
@SkipThrottle()
@Controller('configuration')
export class ConfigurationController {
  constructor(
    private readonly svc: RayzenConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getConfig() {
    return this.svc.getConfig()
  }

  @Patch()
  updateConfig(@Body() patch: Partial<RayzenConfig>) {
    return this.svc.updateConfig(patch)
  }

  @Get('llm-provider')
  getLlmProvider() {
    return { provider: this.svc.getLlmProvider() }
  }

  @Post('llm-provider')
  async setLlmProvider(@Body() body: { provider: LlmProvider }) {
    await this.svc.setLlmProvider(body.provider)
    return { provider: body.provider, ok: true }
  }

  @Get('usage')
  async getUsage() {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [today, week, month, allTime] = await Promise.all([
      this.prisma.conversationMessage.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { tokensUsed: true },
        _count: { id: true },
      }),
      this.prisma.conversationMessage.aggregate({
        where: { createdAt: { gte: weekStart } },
        _sum: { tokensUsed: true },
        _count: { id: true },
      }),
      this.prisma.conversationMessage.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { tokensUsed: true },
        _count: { id: true },
      }),
      this.prisma.conversationMessage.aggregate({
        _sum: { tokensUsed: true },
        _count: { id: true },
      }),
    ])

    const provider = this.svc.getLlmProvider()
    const costPer = LLM_COST_PER_TOKEN[provider]

    const fmt = (tokens: number | null, count: number) => ({
      tokens: tokens ?? 0,
      messages: count,
      costUSD: parseFloat(((tokens ?? 0) * costPer).toFixed(4)),
    })

    return {
      provider,
      pricing: {
        groq:   { model: 'llama-3.3-70b-versatile', costPerMToken: 0.70 },
        claude: { model: 'claude-sonnet-4',          costPerMToken: 9.00 },
      },
      today:   fmt(today._sum.tokensUsed,   today._count.id),
      week:    fmt(week._sum.tokensUsed,    week._count.id),
      month:   fmt(month._sum.tokensUsed,   month._count.id),
      allTime: fmt(allTime._sum.tokensUsed, allTime._count.id),
    }
  }
}
