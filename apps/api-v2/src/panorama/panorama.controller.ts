import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { PanoramaService } from './panorama.service'

/**
 * `@Controller('system')` de propósito: a URL fica `/v2/system/panorama`, ao lado de
 * `/v2/system/status` e `/v2/system/problemas`, que respondem perguntas vizinhas. Um prefixo
 * novo espalharia a saúde do sistema por dois lugares.
 */
@ApiTags('system')
@Controller('system')
export class PanoramaController {
  constructor(private readonly svc: PanoramaService) {}

  @Get('panorama')
  @ApiOperation({
    summary: 'Está tudo de pé? — serviços, ciclos e invariantes numa resposta, com três estados',
  })
  panorama() {
    return this.svc.panorama()
  }
}
