import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { ApiHeader } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'
import { QueryService } from './query.service'
import { IdentityGuard, IdentityRequest } from '../auth/identity.guard'

class AskDto {
  @IsString()
  @IsNotEmpty()
  question!: string

  // userId NÃO vem mais daqui — o chamador podia alegar ser qualquer um
  // (backlog "identidade do usuário de negócio"). O userId real vem do claim
  // `sub` do JWT verificado em X-Identity-Token, ver IdentityGuard.
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
  @UseGuards(IdentityGuard)
  @ApiHeader({ name: 'X-Identity-Token', description: 'JWT assinado pelo backend do cliente, claim "sub" = userId', required: true })
  ask(@Body() dto: AskDto, @Req() req: IdentityRequest) {
    return this.queryService.ask(dto.question, req.identityUserId!, dto.profile)
  }
}
