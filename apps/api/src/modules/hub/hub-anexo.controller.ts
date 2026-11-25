import { BadRequestException, Controller, ForbiddenException, Get, Param, PayloadTooLargeException, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { MultipartFile } from '@fastify/multipart'
import type { RequestWithPrincipal } from '../auth/principal'
import { HubAnexoService } from './hub-anexo.service'
import { TETO_BYTES } from './hub-anexo.const'

type RequisicaoComArquivo = RequestWithPrincipal & { file: () => Promise<MultipartFile | undefined> }

/**
 * HC1 — anexos do chat do Hub. Só principal humano envia e lê: o `AGENT_TOKEN` e os serviços ficam
 * de fora, como nos turnos. O anexo pertence a quem enviou; o turno (HC2) confere o dono de novo.
 */
@ApiTags('hub')
@Controller('hub/anexos')
export class HubAnexoController {
  constructor(private readonly anexos: HubAnexoService) {}

  @Post()
  @ApiOperation({ summary: 'Anexar arquivo ao chat do Hub (PDF, imagem ou texto) — devolve o texto que o modelo verá' })
  async enviar(@Req() req: RequisicaoComArquivo) {
    const principalId = this.humano(req)
    let arquivo: MultipartFile | undefined
    try {
      arquivo = await req.file()
    } catch {
      throw new BadRequestException({ code: 'hub_anexo_multipart' })
    }
    if (!arquivo) throw new BadRequestException({ code: 'hub_anexo_ausente' })
    let buffer: Buffer
    try {
      buffer = await arquivo.toBuffer()
    } catch {
      // O teto do multipart (25 MB) estourou antes do nosso (10 MB).
      throw new PayloadTooLargeException({ code: 'hub_anexo_grande', tetoBytes: TETO_BYTES })
    }
    return this.anexos.receber({ principalId, nome: arquivo.filename, buffer })
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um anexo do próprio principal, com o texto extraído' })
  buscar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    return this.anexos.buscar(this.humano(req), id)
  }

  private humano(req: RequestWithPrincipal): string {
    const principal = req.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return principal.id
  }
}
