import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { CostControllerService } from './cost-controller.service'
import { JwtAuthGuard } from '../core/auth.guard'

class SetBudgetDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) daily?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) monthly?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) perMission?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() alertAt?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() blockAt?: number
}

class EstimateDto {
  @ApiProperty() @IsString() @IsNotEmpty() model!: string
  @ApiProperty() @IsNumber() @Min(0) estimatedTokens!: number
}

@ApiTags('costs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('costs')
export class CostControllerController {
  constructor(private readonly costs: CostControllerService) {}

  @Get(':projectId')
  getStatus(@Param('projectId') projectId: string) {
    return this.costs.getStatus(projectId)
  }

  @Get(':projectId/breakdown')
  @ApiQuery({ name: 'days', required: false })
  breakdown(@Param('projectId') projectId: string, @Query('days') days?: string) {
    return this.costs.getBreakdown(projectId, days ? parseInt(days) : 30)
  }

  @Post(':projectId/budget')
  @HttpCode(200)
  setBudget(@Param('projectId') projectId: string, @Body() dto: SetBudgetDto) {
    return this.costs.setBudget(projectId, dto)
  }

  @Post('estimate')
  @HttpCode(200)
  estimate(@Body() dto: EstimateDto) {
    return this.costs.estimate(dto.model, dto.estimatedTokens).then((cost) => ({ model: dto.model, estimatedTokens: dto.estimatedTokens, estimatedCostUsd: cost }))
  }
}
