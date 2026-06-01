import { Controller, Post, Get, Body, Param, UseGuards, HttpCode, NotFoundException } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional } from 'class-validator'
import { DiscoveryService } from './discovery.service'
import { JwtAuthGuard } from '../core/auth.guard'

class DiscoveryMessageDto {
  @ApiProperty({ description: 'Fala do cliente/usuário em linguagem natural' })
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiPropertyOptional({ description: 'Sessão existente; omitido cria uma nova' })
  @IsOptional()
  @IsString()
  sessionId?: string

  @ApiPropertyOptional({ description: 'Nome do projeto novo (opcional)' })
  @IsOptional()
  @IsString()
  projectName?: string
}

class SpecFromBriefDto {
  @ApiProperty({ description: 'Nome do projeto' })
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ description: 'Brief / ideia do projeto em linguagem natural' })
  @IsString()
  @IsNotEmpty()
  brief!: string
}

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('message')
  @HttpCode(200)
  @ApiOperation({ summary: 'BDE — entrevista de descoberta conversacional (intake de projeto novo)' })
  message(@Body() dto: DiscoveryMessageDto) {
    return this.discovery.message(dto.content, dto.sessionId, dto.projectName)
  }

  @Post(':sessionId/blueprint')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consolida a entrevista num Blueprint estruturado para revisão' })
  blueprint(@Param('sessionId') sessionId: string) {
    return this.discovery.generateBlueprint(sessionId)
  }

  @Post(':sessionId/spec')
  @HttpCode(200)
  @ApiOperation({ summary: 'Converte o Blueprint revisado da sessão em ProjectSpec (sem nova chamada de LLM)' })
  spec(@Param('sessionId') sessionId: string) {
    const sess = this.discovery.get(sessionId)
    if (!sess.blueprint) {
      throw new NotFoundException(`Sessão ${sessionId} ainda não tem Blueprint; gere o Blueprint antes.`)
    }
    return this.discovery.blueprintToSpec(sess.blueprint)
  }

  @Post('spec-from-brief')
  @HttpCode(200)
  @ApiOperation({ summary: 'Gera ProjectSpec a partir de um brief (usado pelo agent — LiteLLM server-side)' })
  specFromBrief(@Body() dto: SpecFromBriefDto) {
    return this.discovery.specFromBrief(dto.name, dto.brief)
  }

  @Get(':sessionId')
  @ApiOperation({ summary: 'Estado da sessão de descoberta' })
  get(@Param('sessionId') sessionId: string) {
    return this.discovery.get(sessionId)
  }
}
