import { Controller, Post, Get, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
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

class PersistTurnDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant'

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string

  @ApiPropertyOptional({ description: 'claude-code | claude-web | agent | manual' })
  @IsOptional()
  @IsString()
  source?: string
}

class TurnItemDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant'

  @IsString()
  @IsNotEmpty()
  content!: string

  @IsOptional()
  @IsString()
  ts?: string
}

class IndexSessionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId!: string

  @ApiProperty({ type: [TurnItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TurnItemDto)
  messages!: TurnItemDto[]

  @ApiPropertyOptional({ description: 'Resumo da sessão gerado pelo Claude' })
  @IsOptional()
  @IsString()
  summary?: string
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

  /**
   * Persiste um único turn no Brain (pgvector).
   * Chamado pelo hook do Claude Code após cada interação significativa.
   */
  @Post('turns')
  @HttpCode(201)
  @ApiOperation({ summary: 'Persiste um turn (user|assistant) no Brain para memória cross-sessão' })
  persistTurn(@Body() dto: PersistTurnDto) {
    return this.conversation.persistTurn(dto)
  }

  /**
   * Indexa uma sessão completa no Brain como um único documento.
   * Ideal para chamar no encerramento de uma sessão do Claude Code.
   */
  @Post('sessions/index')
  @HttpCode(201)
  @ApiOperation({ summary: 'Indexa uma sessão completa de conversa no Brain' })
  indexSession(@Body() dto: IndexSessionDto) {
    return this.conversation.indexSession(dto)
  }
}
