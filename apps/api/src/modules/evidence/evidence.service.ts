import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import * as fs from 'node:fs'
import * as path from 'node:path'

interface EvidenceMetadata {
  kind?: string
  evidenceType?: string
  path?: string | null
  remotePath?: string | null
  takenAt?: string | null
  prompt?: string
  description?: string | null
  category?: string | null
  projectName?: string | null
  testRunId?: string | null
  testRunLinkReason?: string | null
}

interface CreateScreenshotEvidenceInput {
  projectId: string
  localPath?: string | null
  remotePath: string
  takenAt?: string | null
  prompt?: string | null
  description?: string | null
  category?: string | null
  projectName?: string | null
  testRunId?: string | null
}

@Injectable()
export class EvidenceService {
  private readonly rootDir = path.resolve(process.env.EVIDENCE_DIR ?? path.join(process.cwd(), 'storage', 'evidence'))

  constructor(private readonly prisma: PrismaService) {
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  getRootDir(): string {
    return this.rootDir
  }

  projectDir(projectId: string): string {
    const dir = path.join(this.rootDir, projectId)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  async createScreenshot(input: CreateScreenshotEvidenceInput) {
    const linkedRun = input.testRunId
      ? await this.findTestRun(input.projectId, input.testRunId)
      : await this.findRecentTestRun(input.projectId)
    const testRunId = linkedRun?.id ?? null

    return this.prisma.event.create({
      data: {
        projectId: input.projectId,
        source: 'execution',
        type: 'note',
        intent: 'reference',
        content: input.description
          ? `Screenshot: ${input.description}`
          : input.localPath
            ? `Screenshot capturado: ${input.localPath}`
            : 'Screenshot capturado',
        metadata: {
          kind: 'evidence',
          evidenceType: 'screenshot',
          path: input.localPath ?? null,
          remotePath: input.remotePath,
          takenAt: input.takenAt ?? null,
          prompt: input.prompt ?? null,
          description: input.description ?? null,
          category: input.category ?? 'general',
          projectName: input.projectName ?? null,
          testRunId,
          testRunLinkReason: input.testRunId
            ? 'explicit'
            : testRunId
              ? 'auto_latest_recent_run'
              : null,
        } as object,
      },
    })
  }

  async linkToTestRun(evidenceId: string, testRunId: string | null) {
    const event = await this.prisma.event.findUnique({ where: { id: evidenceId } })
    if (!event) throw new Error('Evidence not found')

    const metadata = (event.metadata ?? {}) as EvidenceMetadata
    if (metadata.kind !== 'evidence') throw new Error('Event is not an evidence item')

    if (testRunId) {
      const run = await this.findTestRun(event.projectId ?? undefined, testRunId)
      if (!run) throw new Error('Test run not found for this project')
    }

    return this.prisma.event.update({
      where: { id: evidenceId },
      data: {
        metadata: {
          ...metadata,
          testRunId,
          testRunLinkReason: testRunId ? 'manual' : null,
        } as object,
      },
    })
  }

  async list(projectId: string) {
    const events = await this.prisma.event.findMany({
      where: { projectId, source: 'execution', type: 'note' },
      orderBy: { ts: 'desc' },
      take: 100,
    })

    return events
      .filter((event) => {
        const metadata = (event.metadata ?? {}) as EvidenceMetadata
        return metadata.kind === 'evidence'
      })
      .map((event) => {
        const metadata = (event.metadata ?? {}) as EvidenceMetadata
        return {
          id: event.id,
          projectId: event.projectId,
          type: metadata.evidenceType ?? 'unknown',
          content: event.content,
          localPath: metadata.path ?? null,
          remotePath: metadata.remotePath ?? null,
          takenAt: metadata.takenAt ?? null,
          prompt: metadata.prompt ?? null,
          description: metadata.description ?? null,
          category: metadata.category ?? 'general',
          projectName: metadata.projectName ?? null,
          testRunId: metadata.testRunId ?? null,
          testRunLinkReason: metadata.testRunLinkReason ?? null,
          createdAt: event.ts,
        }
      })
  }

  private async findTestRun(projectId: string | null | undefined, testRunId: string) {
    return this.prisma.testRun.findFirst({
      where: {
        id: testRunId,
        ...(projectId ? { projectId } : {}),
      },
      select: { id: true },
    })
  }

  private async findRecentTestRun(projectId: string) {
    const since = new Date(Date.now() - 4 * 60 * 60 * 1000)
    return this.prisma.testRun.findFirst({
      where: {
        projectId,
        executedAt: { gte: since },
      },
      orderBy: { executedAt: 'desc' },
      select: { id: true },
    })
  }
}
