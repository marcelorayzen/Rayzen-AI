import {
  BadRequestException, BadGatewayException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ExecutionService } from '../execution/execution.service'

/**
 * Arquivos de um projeto, lidos do checkout pelo agent desktop — item 3 (12/11).
 *
 * Quem lê é o agent (`jarvis:project_list_files` / `jarvis:project_read_file`): é ele que tem o
 * disco, resolve o checkout pelo projeto e recusa segredo pelo nome. Esta camada só valida o
 * projeto e traduz o desfecho em HTTP que diga O QUE aconteceu — o pior resultado aqui seria um
 * 500 genérico que o modelo lesse como "não existe" e voltasse a completar de memória.
 *
 * A tradução lê a mensagem das NOSSAS ações do agent (contrato interno, testado nas duas pontas),
 * nunca texto de terceiros.
 */
@Injectable()
export class ProjectFilesService {
  constructor(private readonly prisma: PrismaService, private readonly execution: ExecutionService) {}

  async listar(projectId: string, path?: string) {
    await this.exigirProjeto(projectId)
    return this.despachar('project_list_files', { projectId, path: path ?? '' })
  }

  async ler(projectId: string, path: string | undefined) {
    if (!path?.trim()) throw new BadRequestException({ code: 'arquivo_path_obrigatorio' })
    await this.exigirProjeto(projectId)
    return this.despachar('project_read_file', { projectId, path })
  }

  private async exigirProjeto(projectId: string) {
    const projeto = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!projeto) throw new NotFoundException({ code: 'projeto_nao_encontrado' })
  }

  private async despachar(acao: string, carga: Record<string, unknown>) {
    try {
      return await this.execution.dispatch(acao, carga)
    } catch (e) {
      throw traduzirErro(e instanceof Error ? e.message : String(e))
    }
  }
}

export function traduzirErro(mensagem: string) {
  if (/offline|Timeout aguardando/i.test(mensagem)) {
    return new ServiceUnavailableException({
      code: 'agente_indisponivel',
      message: 'O agent da máquina onde o projeto está não respondeu (offline ou ocupado). Nada foi lido.',
    })
  }
  if (/fora do checkout/i.test(mensagem)) {
    return new BadRequestException({ code: 'caminho_fora_do_projeto', message: mensagem })
  }
  if (/não tem checkout|não é um repositório git|projectId é obrigatório/i.test(mensagem)) {
    return new ConflictException({ code: 'checkout_indisponivel', message: mensagem })
  }
  return new BadGatewayException({ code: 'leitura_falhou', message: mensagem.slice(0, 300) })
}
