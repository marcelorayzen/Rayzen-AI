import { Controller, Post, Get, Param, Body, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { DocumentProcessingService } from './document-processing.service'
import { IsString, IsOptional } from 'class-validator'
import type { FastifyReply } from 'fastify'
import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'

class GeneratePDFDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  sessionId?: string
}

class GenerateDOCXDto {
  @IsString()
  prompt!: string

  @IsOptional()
  data?: Record<string, unknown>

  @IsOptional()
  @IsString()
  sessionId?: string
}

@SkipThrottle()
@ApiTags('documents')
@Controller('documents')
export class DocumentProcessingController {
  constructor(private readonly svc: DocumentProcessingService) {}

  @Post('pdf')
  async generatePDF(@Body() dto: GeneratePDFDto, @Res() reply: FastifyReply) {
    const sessionId = dto.sessionId ?? randomUUID()
    const result = await this.svc.generatePDF(dto.prompt, sessionId)

    const buffer = fs.readFileSync(result.filePath)
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${result.fileName}"`)
      .header('Content-Length', result.sizeBytes)
      .send(buffer)
  }

  @Get('download/:fileName')
  async download(@Param('fileName') fileName: string, @Res() reply: FastifyReply) {
    // Block path traversal
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      reply.status(400).send({ message: 'Invalid file name' })
      return
    }
    const filePath = path.join(this.svc.getOutputDir(), fileName)
    if (!fs.existsSync(filePath)) {
      reply.status(404).send({ message: 'Arquivo não encontrado' })
      return
    }
    const buffer = fs.readFileSync(filePath)
    const contentType = fileName.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf'
    reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Content-Length', buffer.length)
      .send(buffer)
  }

  @Post('docx')
  async generateDOCX(@Body() dto: GenerateDOCXDto, @Res() reply: FastifyReply) {
    const sessionId = dto.sessionId ?? randomUUID()
    const result = await this.svc.generateDOCX(dto.prompt, dto.data ?? {}, sessionId)

    const buffer = fs.readFileSync(result.filePath)
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${result.fileName}"`)
      .header('Content-Length', result.sizeBytes)
      .send(buffer)
  }
}
