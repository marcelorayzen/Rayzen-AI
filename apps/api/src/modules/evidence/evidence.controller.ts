import { Body, Controller, Get, Param, Patch, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EvidenceService } from './evidence.service'

@ApiTags('evidence')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get('projects/:projectId')
  list(@Param('projectId') projectId: string) {
    return this.evidence.list(projectId)
  }

  @Post('upload/:projectId')
  async upload(
    @Param('projectId') projectId: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await req.file()
    if (!file) return { uploaded: false }

    const ext = path.extname(file.filename || '.png') || '.png'
    const fileName = `${randomUUID()}${ext}`
    const relativePath = path.join(projectId, fileName)
    const outputPath = path.join(this.evidence.projectDir(projectId), fileName)

    await fs.promises.writeFile(outputPath, await file.toBuffer())
    const fields = file.fields as Record<string, { value?: unknown }>
    const event = await this.evidence.createScreenshot({
      projectId,
      localPath: typeof fields.localPath?.value === 'string' ? fields.localPath.value : null,
      remotePath: relativePath,
      takenAt: typeof fields.takenAt?.value === 'string' ? fields.takenAt.value : null,
      prompt: typeof fields.prompt?.value === 'string' ? fields.prompt.value : null,
      description: typeof fields.description?.value === 'string' ? fields.description.value : null,
      category: typeof fields.category?.value === 'string' ? fields.category.value : 'general',
      projectName: typeof fields.projectName?.value === 'string' ? fields.projectName.value : null,
      testRunId: typeof fields.testRunId?.value === 'string' ? fields.testRunId.value : null,
    })

    return {
      uploaded: true,
      evidenceId: event.id,
      remotePath: relativePath,
      url: `/evidence/file/${relativePath.replace(/\\/g, '/')}`,
    }
  }


  @Patch(':evidenceId/test-run')
  linkToTestRun(
    @Param('evidenceId') evidenceId: string,
    @Body() body: { testRunId?: string | null },
  ) {
    return this.evidence.linkToTestRun(evidenceId, body.testRunId ?? null)
  }

  @Get('file/:projectId/:fileName')
  async file(
    @Param('projectId') projectId: string,
    @Param('fileName') fileName: string,
    @Res() reply: FastifyReply,
  ) {
    if ([projectId, fileName].some((part) => part.includes('..') || part.includes('/') || part.includes('\\'))) {
      reply.status(400).send({ message: 'Invalid path' })
      return
    }

    const filePath = path.join(this.evidence.getRootDir(), projectId, fileName)
    if (!fs.existsSync(filePath)) {
      reply.status(404).send({ message: 'Evidence not found' })
      return
    }

    reply.header('Content-Type', fileName.endsWith('.png') ? 'image/png' : 'application/octet-stream')
    reply.send(fs.createReadStream(filePath))
  }
}
