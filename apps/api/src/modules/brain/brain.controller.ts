import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsOptional, IsIn } from 'class-validator'
import { BrainService } from './brain.service'

class IndexDto {
  @IsIn(['url', 'text'])
  type!: 'url' | 'text'

  @IsString()
  source!: string

  @IsOptional()
  @IsString()
  sourcePath?: string
}

class SearchDto {
  @IsString()
  query!: string

  @IsOptional()
  limit?: number
}

@ApiTags('brain')
@Controller('brain')
export class BrainController {
  constructor(private readonly svc: BrainService) {}

  @Post('index')
  index(@Body() dto: IndexDto) {
    if (dto.type === 'url') return this.svc.indexUrl(dto.source)
    return this.svc.indexText(dto.source, dto.sourcePath)
  }

  @Post('search')
  search(@Body() dto: SearchDto) {
    return this.svc.search(dto.query, dto.limit)
  }
}
