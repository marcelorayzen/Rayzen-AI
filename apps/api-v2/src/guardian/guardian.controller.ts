import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString } from 'class-validator'
import { JwtAuthGuard } from '../core/auth.guard'
import { GuardianService } from './guardian.service'

class AnalyzeDto {
  @IsString()
  projectId!: string

  @IsString()
  repoPath!: string

  @IsArray() @IsString({ each: true })
  changedFiles!: string[]

  @IsOptional() @IsArray() @IsString({ each: true })
  allFiles?: string[]
}

class OverrideDto {
  @IsString()
  reason!: string
}

// Alimenta o sinal jwtProximoDeExpirar com o exp do token da própria requisição.
// Decodificar sem verificar é seguro aqui: o JwtAuthGuard já validou a assinatura.
function jwtDaysLeft(authHeader?: string): number | undefined {
  if (!authHeader?.startsWith('Bearer ')) return undefined
  try {
    const payload = JSON.parse(
      Buffer.from(authHeader.slice(7).split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number }
    if (typeof payload.exp !== 'number') return undefined
    return Math.floor((payload.exp * 1000 - Date.now()) / 86_400_000)
  } catch {
    return undefined
  }
}

@ApiTags('guardian')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('guardian')
export class GuardianController {
  constructor(private readonly guardian: GuardianService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Analisa mudanças de código e gera GuardianReport' })
  analyze(@Body() dto: AnalyzeDto, @Headers('authorization') auth?: string) {
    return this.guardian.analyze(dto, jwtDaysLeft(auth))
  }

  @Get('latest/:projectId')
  @ApiOperation({ summary: 'Retorna o último GuardianReport do projeto (cache 10min)' })
  getLatest(@Param('projectId') projectId: string) {
    return this.guardian.getLatest(projectId)
  }

  @Get('history/:projectId')
  @ApiOperation({ summary: 'Lista os últimos 20 GuardianReports do projeto' })
  getHistory(@Param('projectId') projectId: string) {
    return this.guardian.getHistory(projectId)
  }

  @Patch(':id/override')
  @ApiOperation({ summary: 'Marca um report como overridden (deploy liberado manualmente)' })
  override(@Param('id') id: string, @Body() dto: OverrideDto) {
    return this.guardian.override(id, dto.reason)
  }
}
