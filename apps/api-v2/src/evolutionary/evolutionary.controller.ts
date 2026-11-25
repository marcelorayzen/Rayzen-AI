import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { JwtAuthGuard } from '../core/auth.guard'
import { EvolutionaryService } from './evolutionary.service'

class SeedStrategyDto {
  @IsString() @IsNotEmpty()
  taskType!: string

  @IsString() @IsNotEmpty()
  systemPrompt!: string

  @IsOptional() @IsInt() @Min(2) @Max(4)
  @Type(() => Number)
  tier?: number

  @IsOptional() @IsNumber()
  @Type(() => Number)
  temperature?: number

  @IsOptional() @IsString()
  notes?: string
}

class EvolveDto {
  @IsString() @IsNotEmpty()
  projectId!: string
}

@ApiTags('evolutionary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('evolutionary')
export class EvolutionaryController {
  constructor(private readonly evolutionary: EvolutionaryService) {}

  @Get('strategies')
  @ApiOperation({ summary: 'Lista estratégias (filtro por taskType/status)' })
  list(
    @Query('taskType') taskType?: string,
    @Query('status')   status?:   string,
    @Query('limit')    limit?:    string,
  ) {
    return this.evolutionary.listStrategies({
      taskType,
      status,
      limit: limit ? parseInt(limit) : undefined,
    })
  }

  @Get('strategies/active/:taskType')
  @ApiOperation({ summary: 'Retorna a estratégia ativa para um taskType' })
  getActive(@Param('taskType') taskType: string) {
    return this.evolutionary.getActiveStrategy(taskType)
  }

  @Get('strategies/population/:taskType')
  @ApiOperation({ summary: 'Top-N estratégias para um taskType (não-retired)' })
  getPopulation(
    @Param('taskType') taskType: string,
    @Query('n') n?: string,
  ) {
    return this.evolutionary.getPopulation(taskType, n ? parseInt(n) : undefined)
  }

  @Post('seed')
  @ApiOperation({ summary: 'Cria uma estratégia candidata manualmente' })
  seed(@Body() dto: SeedStrategyDto) {
    return this.evolutionary.seed(dto)
  }

  @Post('strategies/:id/mutate')
  @ApiOperation({ summary: 'Gera uma variante da estratégia via LLM' })
  mutate(@Param('id') id: string) {
    return this.evolutionary.mutate(id)
  }

  @Post('strategies/:id/promote')
  @ApiOperation({ summary: 'Promove uma estratégia candidata para active (retira a atual)' })
  promote(@Param('id') id: string) {
    return this.evolutionary.promote(id)
  }

  @Post('strategies/:id/retire')
  @ApiOperation({ summary: 'Aposenta uma estratégia' })
  retire(@Param('id') id: string) {
    return this.evolutionary.retire(id)
  }

  @Post('evolve/:taskType')
  @ApiOperation({ summary: 'Roda ciclo evolutivo: benchmark candidatos → melhor → gate de promoção' })
  evolve(@Param('taskType') taskType: string, @Body() dto: EvolveDto) {
    return this.evolutionary.evolve(taskType, dto.projectId)
  }
}
