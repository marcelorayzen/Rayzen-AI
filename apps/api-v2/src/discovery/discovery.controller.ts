import { Controller, Post, Get, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
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

  @Get(':sessionId')
  @ApiOperation({ summary: 'Estado da sessão de descoberta' })
  get(@Param('sessionId') sessionId: string) {
    return this.discovery.get(sessionId)
  }
}
