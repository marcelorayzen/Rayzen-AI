import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ContentEngineService, ContentType, ContentTone } from './content-engine.service'
import { IsString, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator'
import { randomUUID } from 'crypto'

class GenerateContentDto {
  @IsIn(['post', 'thread', 'article'])
  type!: ContentType

  @IsString()
  topic!: string

  @IsOptional()
  @IsIn(['professional', 'casual', 'educational', 'persuasive', 'creative'])
  tone?: ContentTone

  @IsOptional()
  @IsString()
  context?: string

  @IsOptional()
  @IsString()
  sessionId?: string
}

class GenerateDiagramDto {
  @IsString()
  description!: string

  @IsOptional()
  @IsString()
  sessionId?: string
}

class GenerateCalendarDto {
  @IsString()
  topic!: string

  @IsOptional()
  @IsNumber()
  @Min(7)
  @Max(30)
  days?: number

  @IsOptional()
  @IsString()
  sessionId?: string
}

@ApiTags('content-engine')
@Controller('content-engine')
export class ContentEngineController {
  constructor(private readonly svc: ContentEngineService) {}

  @Post('generate')
  generate(@Body() dto: GenerateContentDto) {
    return this.svc.generate(
      dto.type,
      dto.topic,
      dto.tone ?? 'professional',
      dto.sessionId ?? randomUUID(),
      dto.context,
    )
  }

  @Post('calendar')
  calendar(@Body() dto: GenerateCalendarDto) {
    return this.svc.generateCalendar(
      dto.topic,
      dto.days ?? 7,
      dto.sessionId ?? randomUUID(),
    )
  }

  @Post('diagram')
  @ApiOperation({ summary: 'Gerar diagrama Mermaid a partir de descrição textual' })
  diagram(@Body() dto: GenerateDiagramDto) {
    return this.svc.generateDiagram(dto.description, dto.sessionId ?? randomUUID())
  }
}
