import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import { QueryAuditService } from './query-audit.service'

class FlagDto {
  @IsString()
  @IsNotEmpty()
  reason!: string
}

@Controller('query-audits')
export class AuditController {
  constructor(private readonly audit: QueryAuditService) {}

  @Get()
  history(@Query('userId') userId?: string) {
    return this.audit.history(userId)
  }

  // Sinaliza uma resposta como incorreta — cria um QueryAuditFlag, nunca
  // altera o QueryAudit original (ver query-audit.service.ts).
  @Post(':id/flags')
  flag(@Param('id') id: string, @Body() dto: FlagDto) {
    return this.audit.flag(id, dto.reason)
  }

  @Patch('flags/:flagId/resolve')
  resolveFlag(@Param('flagId') flagId: string) {
    return this.audit.resolveFlag(flagId)
  }
}
