import { Controller, Post, Body, Req, Res } from '@nestjs/common'
import { ApiTags, ApiConsumes } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { VoiceService } from './voice.service'
import { IsString } from 'class-validator'
import { FastifyReply } from 'fastify'

class SynthesizeDto {
  @IsString()
  text!: string
}

@SkipThrottle()
@ApiTags('voice')
@Controller('voice')
export class VoiceController {
  constructor(private readonly svc: VoiceService) {}

  @Post('synthesize')
  async synthesize(@Body() dto: SynthesizeDto, @Res() reply: FastifyReply) {
    const buffer = await this.svc.synthesize(dto.text)
    reply
      .header('Content-Type', 'audio/wav')
      .header('Content-Length', buffer.length)
      .send(buffer)
  }

  /** HC7a: a resposta em pedaços que a síntese aguenta (sem custo de LLM; só texto). */
  @Post('pedacos')
  pedacos(@Body() dto: SynthesizeDto) {
    return { pedacos: this.svc.pedacos(dto.text) }
  }

  @Post('transcribe')
  @ApiConsumes('multipart/form-data')
  async transcribe(@Req() req: { file: () => Promise<{ toBuffer: () => Promise<Buffer>; mimetype: string } | undefined> }) {
    const data = await req.file()
    if (!data) throw new Error('Nenhum arquivo enviado')

    const buffer = await data.toBuffer()
    const mimeType = data.mimetype

    const text = await this.svc.transcribe(buffer, mimeType)
    return { text }
  }
}
