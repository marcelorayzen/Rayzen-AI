import { Body, Controller, Post } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import { QueryService } from './query.service'

class AskDto {
  @IsString()
  @IsNotEmpty()
  question!: string

  @IsString()
  @IsNotEmpty()
  userId!: string

  @IsString()
  @IsNotEmpty()
  profile!: string
}

// Este é o endpoint que golden-dataset/avaliador.py chama em consultar_agente()
// uma vez que o Catalog Guardian está no ar (Fase 3 do blueprint).
@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  ask(@Body() dto: AskDto) {
    return this.queryService.ask(dto.question, dto.userId, dto.profile)
  }
}
