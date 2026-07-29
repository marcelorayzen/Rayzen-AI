import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common'
import { IsNotEmpty, IsString } from 'class-validator'
import { FastifyReply } from 'fastify'
import { QueryAuditService } from './query-audit.service'
import { toCsv } from './csv.util'

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

  // Fase 5 — exportação pra steward/comitê. Rota fixa antes de qualquer
  // futura rota `:id` neste controller, pra "export.csv" nunca ser
  // interpretado como um id (nenhuma existe hoje, mas documentado pra quem
  // for mexer aqui depois).
  @Get('export.csv')
  async exportCsv(
    @Res() reply: FastifyReply,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const rows = await this.audit.exportRows({
      userId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    })

    const csv = toCsv(rows, [
      { key: 'id', header: 'ID' },
      { key: 'createdAt', header: 'Data' },
      { key: 'userId', header: 'Usuário' },
      { key: 'profile', header: 'Perfil' },
      { key: 'question', header: 'Pergunta' },
      { key: 'answer', header: 'Resposta' },
      { key: 'citedAssets', header: 'Ativos Citados' },
      { key: 'riskLevel', header: 'Nível de Risco' },
      { key: 'gateRequired', header: 'Exigiu Revisão' },
      {
        key: (r) => r.flags.map((f) => `${f.reason}${f.resolvedAt ? ' (resolvido)' : ' (pendente)'}`).join(' | '),
        header: 'Sinalizações',
      },
    ])

    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', 'attachment; filename="query-audits.csv"')
    reply.send(csv)
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
