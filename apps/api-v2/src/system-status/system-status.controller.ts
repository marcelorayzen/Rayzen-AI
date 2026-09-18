import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { SystemStatusService } from './system-status.service'

interface HeartbeatDto {
  component: string
  ok:        boolean
  erro?:     string
  detalhe?:  Record<string, unknown>
  host?:     string
}

@ApiTags('system')
@Controller('system')
export class SystemStatusController {
  constructor(private readonly system: SystemStatusService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado dos ciclos automáticos — inclui os que nunca subiram' })
  status() {
    return this.system.status()
  }

  @Get('problemas')
  @ApiOperation({ summary: 'Só o que não está saudável — é o que o hook injeta' })
  problemas() {
    return this.system.problemas()
  }

  @Get('catalogo')
  @ApiOperation({ summary: 'Componentes declarados, antes de qualquer batimento' })
  catalogo() {
    return this.system.catalogo()
  }

  /**
   * Batimento vindo de fora do processo — hoje só o Guardian, que roda no agent
   * desktop. Os ciclos da própria api-v2 chamam `beat()` direto, sem rede.
   */
  @Post('heartbeat')
  @HttpCode(204)
  @ApiOperation({ summary: 'Registra batimento de componente externo (agent)' })
  async heartbeat(@Body() dto: HeartbeatDto) {
    // Componente desconhecido é recusado em vez de criar linha órfã: a lista de
    // expectativa é o const, e aceitar qualquer id transformaria a tabela numa
    // segunda fonte de verdade divergindo em silêncio.
    if (!dto?.component || !this.system.conhece(dto.component)) {
      throw new BadRequestException(
        `componente desconhecido: "${dto?.component}". Ver GET /v2/system/catalogo`,
      )
    }
    await this.system.beat(dto.component, {
      ok:      dto.ok !== false,
      erro:    dto.erro,
      detalhe: dto.detalhe,
      host:    dto.host ?? 'agent',
    })
  }
}
