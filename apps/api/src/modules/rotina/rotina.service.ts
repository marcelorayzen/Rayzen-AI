import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { PROJETO_GERAL_ID } from '../../common/escopo-geral.const'
import {
  EXECUCOES_GUARDADAS, type ResultadoDeExecucao, type StatusDaRotina,
  validarGatilho, validarModelo,
} from './rotina.const'

/**
 * G6.1 — rotinas: criar, aprovar, pausar, retomar e listar. O disparo (agenda e GitHub) chega nas
 * fatias seguintes; aqui fica só a vida da rotina e o histórico das execuções.
 *
 * As duas regras que não se negociam moram aqui e no controller: **toda rotina nasce `proposta`**
 * (quem cria, seja pessoa ou o Hub, nunca a deixa ativa) e **aprovar exige principal humano** (o
 * controller confere, como o `/stop` do G2.8). Pausar é sempre permitido: reduz efeito.
 */
@Injectable()
export class RotinaService {
  constructor(private readonly prisma: PrismaService) {}

  async criar(dados: { projectId: string; nome: string; gatilho: unknown; modelo: unknown }, criadaPor: string) {
    const nome = typeof dados.nome === 'string' ? dados.nome.trim() : ''
    if (!nome || nome.length > 80) throw new BadRequestException('nome precisa ter de 1 a 80 caracteres')
    if (!dados.projectId || dados.projectId === PROJETO_GERAL_ID) {
      throw new BadRequestException('rotina é de um projeto com repositório — nunca do Geral')
    }

    let gatilho, modelo
    try {
      gatilho = validarGatilho(dados.gatilho)
      modelo = validarModelo(dados.modelo)
    } catch (err) {
      throw new BadRequestException((err as Error).message)
    }

    const projeto = await this.prisma.project.findUnique({ where: { id: dados.projectId }, select: { id: true } })
    if (!projeto) throw new NotFoundException(`projeto ${dados.projectId} não existe`)

    return this.prisma.rotina.create({
      data: {
        projectId: dados.projectId,
        nome,
        gatilho: gatilho as unknown as Prisma.InputJsonValue,
        modelo: modelo as unknown as Prisma.InputJsonValue,
        status: 'proposta',
        criadaPor,
      },
    })
  }

  /** Só de `proposta` para `ativa`. O controller garante que `aprovadaPor` é humano. */
  async aprovar(id: string, aprovadaPor: string) {
    return this.transicionar(id, 'proposta', 'ativa', { aprovadaPor })
  }

  async pausar(id: string) {
    return this.transicionar(id, 'ativa', 'pausada')
  }

  /** Retomar volta a disparar sozinho, então pede pessoa, como aprovar. */
  async retomar(id: string) {
    return this.transicionar(id, 'pausada', 'ativa')
  }

  /** Rotinas (de um projeto, ou todas) com as últimas execuções, mais recentes primeiro. */
  async listar(projectId?: string) {
    return this.prisma.rotina.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { createdAt: 'desc' },
      include: { execucoes: { orderBy: { disparadaEm: 'desc' }, take: EXECUCOES_GUARDADAS } },
    })
  }

  /**
   * Grava uma tentativa de disparo e poda o histórico para as últimas `EXECUCOES_GUARDADAS`.
   * Usado pelo agendador e pelo gatilho do GitHub (fatias seguintes).
   */
  async registrarExecucao(rotinaId: string, execucao: {
    origem: Record<string, unknown>
    resultado: ResultadoDeExecucao
    chave?: string
    envelopeId?: string
    erro?: string
  }) {
    const criada = await this.prisma.rotinaExecucao.create({
      data: {
        rotinaId,
        origem: execucao.origem as Prisma.InputJsonValue,
        resultado: execucao.resultado,
        chave: execucao.chave ?? null,
        envelopeId: execucao.envelopeId ?? null,
        erro: execucao.erro ?? null,
      },
    })
    const excedentes = await this.prisma.rotinaExecucao.findMany({
      where: { rotinaId },
      orderBy: { disparadaEm: 'desc' },
      skip: EXECUCOES_GUARDADAS,
      select: { id: true },
    })
    if (excedentes.length) {
      await this.prisma.rotinaExecucao.deleteMany({ where: { id: { in: excedentes.map((e) => e.id) } } })
    }
    return criada
  }

  /**
   * Transição atômica: só muda se o status atual for o esperado (`updateMany` com o status no
   * filtro), então dois cliques ou duas abas não aprovam duas vezes nem retomam o que foi pausado
   * no meio.
   */
  private async transicionar(id: string, de: StatusDaRotina, para: StatusDaRotina, extra: { aprovadaPor?: string } = {}) {
    const r = await this.prisma.rotina.updateMany({ where: { id, status: de }, data: { status: para, ...extra } })
    if (r.count === 0) {
      const atual = await this.prisma.rotina.findUnique({ where: { id }, select: { status: true } })
      if (!atual) throw new NotFoundException(`rotina ${id} não existe`)
      throw new ConflictException(`rotina está ${atual.status}; só sai de ${de} para ${para}`)
    }
    return this.prisma.rotina.findUnique({ where: { id } })
  }
}
