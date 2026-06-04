import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { CreateMissionDto, CreateMissionStepDto, UpdateMissionStepDto } from './dto/create-mission.dto'

// DTO fields are Record<string, unknown>; Prisma Json requires object — double cast is intentional
const j = (v?: Record<string, unknown>): object => (v ?? {}) as object

type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'

const VALID_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  pending:   ['active', 'cancelled'],
  active:    ['paused', 'done', 'failed', 'cancelled'],
  paused:    ['active', 'cancelled'],
  done:      [],
  failed:    ['active'],
  cancelled: [],
}

@Injectable()
export class MissionService {
  constructor(private readonly prisma: PrismaV2Service) {}

  async create(dto: CreateMissionDto) {
    return this.prisma.mission.create({
      data: {
        projectId:    dto.projectId,
        title:        dto.title,
        objective:    dto.objective,
        context:      j(dto.context),
        specialistId: dto.specialistId ?? null,
        status:       'pending',
      },
      include: { steps: true },
    })
  }

  async findAll(projectId?: string) {
    return this.prisma.mission.findMany({
      where: projectId ? { projectId } : undefined,
      include: { steps: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id },
      include: { steps: { orderBy: { createdAt: 'asc' } } },
    })
    if (!mission) throw new NotFoundException(`Mission ${id} not found`)
    return mission
  }

  async transition(id: string, to: MissionStatus) {
    const mission = await this.findOne(id)
    const current = mission.status as MissionStatus
    if (!VALID_TRANSITIONS[current].includes(to)) {
      throw new BadRequestException(`Cannot transition from ${current} to ${to}`)
    }

    const data: Record<string, unknown> = { status: to }
    if (to === 'active' && !mission.startedAt)  data.startedAt   = new Date()
    if (to === 'done'   || to === 'failed')       data.completedAt = new Date()

    return this.prisma.mission.update({ where: { id }, data, include: { steps: true } })
  }

  async addStep(missionId: string, dto: CreateMissionStepDto) {
    await this.findOne(missionId)
    return this.prisma.missionStep.create({
      data: {
        missionId,
        title:     dto.title,
        skillId:   dto.skillId,
        prompt:    dto.prompt,
        input:     j(dto.input),
        executor:  dto.executor ?? 'ai',
        dependsOn: dto.dependsOn ?? [],
        status:    'pending',
      },
    })
  }

  async listSteps(missionId: string) {
    await this.findOne(missionId)
    return this.prisma.missionStep.findMany({
      where: { missionId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async updateStep(missionId: string, stepId: string, dto: UpdateMissionStepDto) {
    const step = await this.prisma.missionStep.findFirst({ where: { id: stepId, missionId } })
    if (!step) throw new NotFoundException(`Step ${stepId} not found in mission ${missionId}`)

    const data: Record<string, unknown> = {}
    if (dto.output !== undefined) data.output = j(dto.output)
    if (dto.status !== undefined) {
      data.status = dto.status
      if (dto.status === 'running' && !step.startedAt)        data.startedAt   = new Date()
      if (dto.status === 'done' || dto.status === 'failed')   data.completedAt = new Date()
    }

    return this.prisma.missionStep.update({ where: { id: stepId }, data })
  }

  async delete(id: string) {
    await this.findOne(id)
    await this.prisma.mission.delete({ where: { id } })
  }
}
