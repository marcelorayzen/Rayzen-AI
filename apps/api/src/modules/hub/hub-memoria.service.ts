import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'
import { HubAnexoService } from './hub-anexo.service'

export type AcaoDeMemoria = 'guardar' | 'remover'

/** Caminho de um anexo guardado na memória: estável por anexo, para "mudar" substituir em vez de somar. */
export const caminhoNaMemoria = (anexoId: string, nome: string) => `hub/anexo/${anexoId}/${nome}`

/**
 * HC4b (22/11/2026) — gaveta 1 da memória, a BIBLIOTECA: documentos para buscar e citar como dado.
 *
 * O Hub só PROPÕE (`propor`, qualquer principal autenticado — o MCP do Hermes inclusive); guardar e
 * remover acontecem em `aprovar`, que o controller só deixa uma pessoa chamar. Fato e decisão (a
 * gaveta 2) não passam por aqui: vão pela governança de conhecimento da V2, que os trata como
 * canônicos — um PDF inteiro como "verdade" seria a gaveta errada.
 *
 * Guardar é lento (um embedding por trecho de 800 caracteres; um material de curso tem centenas),
 * então `aprovar` responde na hora com `indexando` e o trabalho segue em segundo plano até
 * `aprovada` ou `falhou`, gravado na própria proposta.
 */
@Injectable()
export class HubMemoriaService {
  private readonly logger = new Logger(HubMemoriaService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoria: MemoryService,
    private readonly anexos: HubAnexoService,
  ) {}

  async propor(dados: { acao?: string; projectId?: string; anexoId?: string; sourcePath?: string; titulo?: string }, criadaPor: string) {
    const acao = dados.acao
    if (acao !== 'guardar' && acao !== 'remover') throw new BadRequestException("acao é 'guardar' ou 'remover'")
    const projectId = dados.projectId?.trim()
    if (!projectId) throw new BadRequestException('projectId é obrigatório')
    const projeto = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!projeto) throw new NotFoundException(`projeto ${projectId} não existe`)

    let alvo: { anexoId?: string; sourcePath?: string; titulo: string }
    if (acao === 'guardar') {
      const anexo = dados.anexoId ? await this.prisma.hubAnexo.findUnique({ where: { id: dados.anexoId } }) : null
      if (!anexo) throw new NotFoundException('anexo não encontrado — use o id que aparece no bloco do anexo')
      alvo = { anexoId: anexo.id, titulo: (dados.titulo?.trim() || anexo.nome).slice(0, 120) }
    } else {
      const sourcePath = dados.sourcePath?.trim()
      if (!sourcePath) throw new BadRequestException('remover exige sourcePath (o caminho do documento na memória)')
      const trechos = await this.prisma.document.count({ where: { sourcePath, projectId } })
      if (!trechos) throw new NotFoundException(`nada na memória deste projeto com o caminho ${sourcePath}`)
      alvo = { sourcePath, titulo: (dados.titulo?.trim() || sourcePath).slice(0, 120) }
    }

    // A mesma proposta duas vezes (o modelo repete, a pessoa pede de novo) não vira dois cartões.
    const aberta = await this.prisma.propostaDeMemoria.findFirst({
      where: { acao, projectId, status: 'proposta', ...(alvo.anexoId ? { anexoId: alvo.anexoId } : { sourcePath: alvo.sourcePath }) },
    })
    if (aberta) return aberta
    return this.prisma.propostaDeMemoria.create({ data: { acao, projectId, ...alvo, criadaPor } })
  }

  /** O que espera decisão, com o necessário para decidir: o que entra, ou quanto sai. */
  async pendentes(projectId?: string) {
    const propostas = await this.prisma.propostaDeMemoria.findMany({
      where: { status: { in: ['proposta', 'indexando'] }, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
    return Promise.all(propostas.map(async (p) => {
      if (p.acao === 'remover') {
        return { ...p, trechos: await this.prisma.document.count({ where: { sourcePath: p.sourcePath, projectId: p.projectId } }) }
      }
      const anexo = p.anexoId ? await this.prisma.hubAnexo.findUnique({ where: { id: p.anexoId } }) : null
      return {
        ...p,
        anexo: anexo ? {
          nome: anexo.nome, mime: anexo.mime, caracteres: anexo.texto.length, truncado: anexo.truncado,
          originalDisponivel: Boolean(anexo.caminho), previa: anexo.texto.slice(0, 400),
        } : null,
      }
    }))
  }

  /** Só pessoa chega aqui (o controller confere). Guardar segue em segundo plano. */
  async aprovar(id: string, humano: string) {
    const proposta = await this.decidir(id, humano, 'indexando')
    if (proposta.acao === 'remover') {
      const { count } = await this.prisma.document.deleteMany({ where: { sourcePath: proposta.sourcePath, projectId: proposta.projectId } })
      return this.prisma.propostaDeMemoria.update({ where: { id }, data: { status: 'aprovada', resultado: { removidos: count } } })
    }
    void this.guardar(proposta.id, proposta.anexoId!, proposta.projectId, humano)
    return proposta
  }

  async rejeitar(id: string, humano: string) {
    return this.decidir(id, humano, 'rejeitada')
  }

  /** Transição atômica de `proposta`: duas aprovações ao mesmo tempo não indexam duas vezes. */
  private async decidir(id: string, humano: string, para: 'indexando' | 'rejeitada') {
    const { count } = await this.prisma.propostaDeMemoria.updateMany({
      where: { id, status: 'proposta' },
      data: { status: para, decididaPor: humano, decididaEm: new Date() },
    })
    if (!count) {
      const existe = await this.prisma.propostaDeMemoria.findUnique({ where: { id } })
      if (!existe) throw new NotFoundException('proposta não encontrada')
      throw new ConflictException(`proposta já está ${existe.status}`)
    }
    return (await this.prisma.propostaDeMemoria.findUnique({ where: { id } }))!
  }

  /**
   * Guarda o anexo, substituindo o que houver no mesmo caminho ("mudar" = guardar de novo). O texto
   * completo exige que quem APROVA seja o dono do anexo — o Hub propor com o id de um anexo não dá
   * a ninguém o conteúdo de outra pessoa.
   */
  private async guardar(propostaId: string, anexoId: string, projectId: string, humano: string) {
    try {
      const { nome, texto, completo } = await this.anexos.textoCompleto(humano, anexoId)
      if (!texto.trim()) throw new Error('anexo sem texto extraível')
      const sourcePath = caminhoNaMemoria(anexoId, nome)
      await this.prisma.document.deleteMany({ where: { sourcePath, projectId } })
      const trechos = this.memoria.chunkText(texto)
      for (const trecho of trechos) {
        await this.memoria.indexDocument(trecho, sourcePath, {
          type: 'file', source: 'hub-anexo', filename: nome, anexoId, groupKey: sourcePath, groupLabel: nome,
        }, projectId)
      }
      await this.prisma.propostaDeMemoria.update({
        where: { id: propostaId },
        data: { status: 'aprovada', resultado: { trechos: trechos.length, caracteres: texto.length, completo, sourcePath } },
      })
    } catch (e) {
      const erro = (e as Error).message.slice(0, 300)
      this.logger.warn(`proposta de memória ${propostaId}: falhou ao guardar: ${erro}`)
      await this.prisma.propostaDeMemoria.update({
        where: { id: propostaId }, data: { status: 'falhou', resultado: { erro } as Prisma.InputJsonValue },
      }).catch(() => null)
    }
  }
}
