import { Controller, Post, Body, Res } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { OrchestratorService } from './orchestrator.service'
import { IsString, MinLength, IsOptional } from 'class-validator'
import { randomUUID } from 'crypto'
import { FastifyReply } from 'fastify'

class PromptDto {
  @IsString()
  @MinLength(1)
  prompt!: string

  @IsOptional()
  @IsString()
  sessionId?: string

  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsString()
  workMode?: string
}

@ApiTags('orchestrator')
@ApiBearerAuth()
@Controller('orchestrate')
export class OrchestratorController {
  constructor(private readonly svc: OrchestratorService) {}

  @Post()
  handle(@Body() dto: PromptDto) {
    const sessionId = dto.sessionId ?? randomUUID()
    return this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
  }

  @Post('stream')
  async stream(@Body() dto: PromptDto, @Res() reply: FastifyReply) {
    const sessionId = dto.sessionId ?? randomUUID()

    reply.hijack()
    const raw = reply.raw
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('Access-Control-Allow-Origin', '*')
    raw.flushHeaders()

    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      // Verificar se é confirmação de doc pendente antes de classificar
      if (await this.svc.isPendingDocConfirmation(dto.prompt, sessionId)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('classify', { module: 'doc', action: 'generate', sessionId })
        send('token', { text: result.reply })
        send('done', { tokensUsed: result.tokensUsed, sessionId })
        raw.end()
        return
      }

      if (await this.svc.isPendingActionResponse(dto.prompt, sessionId)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('classify', { module: 'jarvis', action: result.action, sessionId })
        send('token', { text: result.reply })
        send('done', { tokensUsed: result.tokensUsed, sessionId })
        raw.end()
        return
      }

      // Classificar primeiro (rápido)
      const classify = await this.svc.classify(dto.prompt)
      send('classify', { module: classify.module, action: classify.action, sessionId })

      // Módulos não-streaming (jarvis, brain, doc, content) — usa handleMessage normal
      const nonStreaming = ['jarvis', 'brain', 'doc', 'content']
      if (nonStreaming.includes(classify.module)) {
        const result = await this.svc.handleMessage(dto.prompt, sessionId, dto.projectId, dto.workMode)
        send('token', { text: result.reply })
        send('done', { tokensUsed: result.tokensUsed, sessionId })
        reply.raw.end()
        return
      }

      // Chat geral — streaming real
      await this.svc.streamChat(dto.prompt, sessionId, classify.module, (token) => {
        send('token', { text: token })
      }, dto.projectId, dto.workMode)

      send('done', { tokensUsed: 0, sessionId })
    } catch (err) {
      send('error', { message: (err as Error).message })
    } finally {
      raw.end()
    }
  }
}
