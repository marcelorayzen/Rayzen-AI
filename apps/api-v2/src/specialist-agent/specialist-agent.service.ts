import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { LlmService } from '../llm/llm.service'

const SELECT_SYSTEM = `You are a task router for an AI engineering system.
Given a task description, select the most appropriate specialist agent from the list provided.
Respond with JSON only:
{
  "specialistId": "id of the best specialist",
  "domain": "domain of the selected specialist",
  "reasoning": "one sentence"
}`

@Injectable()
export class SpecialistAgentService {
  private readonly logger = new Logger(SpecialistAgentService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly llm:   LlmService,
  ) {}

  async findAll(projectId?: string) {
    return this.prisma.specialistAgent.findMany({
      where: {
        enabled: true,
        OR: [
          { projectId: null },
          ...(projectId ? [{ projectId }] : []),
        ],
      },
      orderBy: [{ projectId: 'asc' }, { domain: 'asc' }],
    })
  }

  /**
   * LLM-backed dispatch: selects the best specialist for the given task.
   * Falls back to the 'general' built-in agent on any failure.
   */
  async findForTask(content: string, projectId: string) {
    const specialists = await this.findAll(projectId)
    if (specialists.length === 0) return null

    const list = specialists
      .map((s) => `- id="${s.id}" domain="${s.domain}" name="${s.name}" capabilities=[${s.capabilities.join(',')}]`)
      .join('\n')

    try {
      const result = await this.llm.chat([
        { role: 'system', content: SELECT_SYSTEM },
        { role: 'user', content: `Task: "${content}"\n\nAvailable specialists:\n${list}` },
      ], { model: 'gpt-4o-mini', temperature: 0 })

      const parsed = this.llm.extractJson(result.content) as {
        specialistId?: string
        domain?: string
        reasoning?: string
      }

      const specialist = specialists.find((s) => s.id === parsed.specialistId)
      if (specialist) {
        this.logger.log(`Specialist selected: ${specialist.name} (${specialist.domain}) — ${parsed.reasoning}`)
        return specialist
      }
    } catch (e) {
      this.logger.warn(`findForTask LLM error: ${e}`)
    }

    // Fallback: general specialist
    return specialists.find((s) => s.domain === 'general' && s.builtIn) ?? specialists[0] ?? null
  }

  async create(dto: {
    projectId?:   string
    domain:       string
    name:         string
    description:  string
    systemPrompt: string
    model?:       string
    capabilities?: string[]
  }) {
    return this.prisma.specialistAgent.create({
      data: {
        projectId:    dto.projectId ?? null,
        domain:       dto.domain,
        name:         dto.name,
        description:  dto.description,
        systemPrompt: dto.systemPrompt,
        model:        dto.model ?? null,
        capabilities: dto.capabilities ?? [],
        enabled:      true,
        builtIn:      false,
      },
    })
  }

  async update(id: string, patch: {
    enabled?:     boolean
    description?: string
    systemPrompt?: string
    capabilities?: string[]
    model?:       string
  }) {
    return this.prisma.specialistAgent.update({
      where: { id },
      data: {
        ...(patch.enabled      !== undefined ? { enabled: patch.enabled }         : {}),
        ...(patch.description               ? { description: patch.description }  : {}),
        ...(patch.systemPrompt              ? { systemPrompt: patch.systemPrompt }: {}),
        ...(patch.capabilities              ? { capabilities: patch.capabilities }: {}),
        ...(patch.model        !== undefined ? { model: patch.model ?? null }      : {}),
      },
    })
  }

  async delete(id: string) {
    return this.prisma.specialistAgent.delete({ where: { id } })
  }
}
