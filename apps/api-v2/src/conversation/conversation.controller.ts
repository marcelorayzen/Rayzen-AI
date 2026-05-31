import { Controller, Post, Get, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional } from 'class-validator'
import { ConversationService } from './conversation.service'
import { JwtAuthGuard } from '../core/auth.guard'

class ChatMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ description: 'Mensagem do usuário em linguagem natural' })
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiPropertyOptional({ description: 'Sessão existente; omitido cria uma nova' })
  @IsOptional()
  @IsString()
  sessionId?: string
}

class ChatExecuteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId!: string

  @ApiPropertyOptional({ description: 'Sobrescreve o objetivo acumulado na conversa' })
  @IsOptional()
  @IsString()
  objective?: string
}

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ConversationController {
  constructor(private readonly conversation: ConversationService) {}

  @Post('message')
  @HttpCode(200)
  @ApiOperation({ summary: 'Conversa livre — acumula intenção e indica quando está pronto para executar' })
  message(@Body() dto: ChatMessageDto) {
    return this.conversation.message(dto.projectId, dto.content, dto.sessionId)
  }

  @Post('execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirma execução — comprime contexto e dispara a missão via Router' })
  execute(@Body() dto: ChatExecuteDto) {
    return this.conversation.execute(dto.sessionId, dto.objective)
  }

  @Get('session/:id')
  @ApiOperation({ summary: 'Estado atual da conversa' })
  get(@Param('id') id: string) {
    return this.conversation.get(id)
  }
}
