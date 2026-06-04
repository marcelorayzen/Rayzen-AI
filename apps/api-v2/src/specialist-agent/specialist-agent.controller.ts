import { Controller, Get, Post, Patch, Delete, Query, Body, Param } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator'
import { SpecialistAgentService } from './specialist-agent.service'

class CreateSpecialistDto {
  @IsOptional() @IsString() projectId?: string
  @IsString() @IsNotEmpty() domain!: string
  @IsString() @IsNotEmpty() name!: string
  @IsString() @IsNotEmpty() description!: string
  @IsString() @IsNotEmpty() systemPrompt!: string
  @IsOptional() @IsString() model?: string
  @IsOptional() @IsArray() capabilities?: string[]
}

class UpdateSpecialistDto {
  @IsOptional() enabled?: boolean
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() systemPrompt?: string
  @IsOptional() @IsArray() capabilities?: string[]
  @IsOptional() @IsString() model?: string
}

@ApiTags('specialist-agents')
@Controller('specialist-agents')
export class SpecialistAgentController {
  constructor(private readonly service: SpecialistAgentService) {}

  @Get()
  @ApiOperation({ summary: 'Lista specialist agents globais + overrides do projeto' })
  findAll(@Query('projectId') projectId?: string) {
    return this.service.findAll(projectId)
  }

  @Post()
  @ApiOperation({ summary: 'Cria um specialist agent (override de projeto)' })
  create(@Body() dto: CreateSpecialistDto) {
    return this.service.create(dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza um specialist agent' })
  update(@Param('id') id: string, @Body() dto: UpdateSpecialistDto) {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um specialist agent (não remove built-ins)' })
  remove(@Param('id') id: string) {
    return this.service.delete(id)
  }
}
