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
  projectName?: string | null
}

interface CreateScreenshotEvidenceInput {
  projectId: string
  localPath?: string | null
  remotePath: string
  takenAt?: string | null
  prompt?: string | null
  projectName?: string | null
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
    return this.prisma.event.create({
      data: {
        projectId: input.projectId,
        source: 'execution',
        type: 'note',
        intent: 'reference',
        content: input.localPath ? `Screenshot capturado: ${input.localPath}` : 'Screenshot capturado',
        metadata: {
          kind: 'evidence',
          evidenceType: 'screenshot',
          path: input.localPath ?? null,
          remotePath: input.remotePath,
          takenAt: input.takenAt ?? null,
          prompt: input.prompt ?? null,
          projectName: input.projectName ?? null,
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
          projectName: metadata.projectName ?? null,
          createdAt: event.ts,
        }
      })
  }
}
