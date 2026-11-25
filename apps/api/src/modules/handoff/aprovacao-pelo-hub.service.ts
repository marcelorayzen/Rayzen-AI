import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { HandoffService } from './handoff.service'
import { verificarTotp } from './totp'
import { alcadaDoEnvelope, type NivelDeAlcada } from './alcada.const'
import { avisosAntesDeAprovar } from './handoff-preflight'

/**
 * Aprovar envelope pelo Hub (decidido 13/11): pessoa logada **e** código do autenticador.
 *
 * Cada metade sozinha falha de um jeito: o login, porque o `AGENT_TOKEN` é da mesma família e
 * o agent se autoaprovaria; o código, porque sem login qualquer um que o visse aprovaria de fora.
 * A rota de `APPROVAL_TOKEN` (Claude Code) continua existindo — esta é a porta humana, não a
 * substituta.
 */
export const MAX_FALHAS = 5
export const JANELA_DE_FALHAS_MS = 15 * 60 * 1000

@Injectable()
export class AprovacaoPeloHubService {
  private readonly logger = new Logger(AprovacaoPeloHubService.name)
  /** Em memória: um processo de api, uma pessoa. Reiniciar zera — aceito e declarado. */
  private falhas: number[] = []
  private ultimoPassoAceito = -1

  constructor(
    private readonly prisma: PrismaService,
    private readonly handoffs: HandoffService,
    private readonly relogio: () => number = Date.now,
  ) {}

  /** Envelopes aguardando aprovação, com o conteúdo inteiro — aprova-se o que se vê. */
  async pendentes(projectId?: string) {
    const linhas = await this.prisma.projectHandoff.findMany({
      where: { status: 'awaiting_approval', ...(projectId ? { sourceProjectId: projectId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return linhas.map((h) => ({
      id: h.id, name: h.name, brief: h.brief, template: h.template, root: h.root,
      version: h.version, contentHash: h.contentHash, createdAt: h.createdAt, createdBy: h.createdBy,
      efeitos: h.effects,
      // O card decide pelo servidor se pede código: um regex no cliente seria a quinta cópia da regra.
      alcada: alcadaDoEnvelope(efeitosDe(h.effects)),
      // S1f: o que muda a decisão aparece antes do toque — "sem remoto, sem PR", gh, checkout sujo.
      avisos: avisosAntesDeAprovar(efeitosDe(h.effects)[0]?.actionKey, (h as { preflight?: unknown }).preflight),
    }))
  }

  async aprovar(id: string, humano: { id: string }, codigo: string | undefined, contentHashVisto: string) {
    // Estado e hash ANTES do código: um código válido não deve ser gasto num envelope que
    // não pode ser aprovado, nem num que mudou desde que a pessoa o leu.
    const handoff = await this.handoffs.buscar(id)
    if (handoff.status !== 'awaiting_approval') {
      throw new ConflictException(`Envelope em ${handoff.status} — não está aguardando aprovação`)
    }
    if (!contentHashVisto || contentHashVisto !== handoff.contentHash) {
      throw new ConflictException('O envelope mudou desde que você o abriu — reabra e confira antes de aprovar')
    }
    // S1 (15/11): o código só é cobrado no nível crítico. Abaixo dele a pessoa logada basta —
    // o `AGENT_TOKEN` já é recusado no controller, então o toque continua sendo de uma pessoa.
    const alcada: NivelDeAlcada = alcadaDoEnvelope(efeitosDe((handoff as { effects?: unknown }).effects))
    const quem = createHash('sha256').update(humano.id).digest('hex').slice(0, 12)
    let principal: { id: string; type: string }
    if (alcada === 'critico') {
      if (!codigo?.trim()) throw new BadRequestException('Este envelope é crítico: o código do autenticador é obrigatório')
      this.conferirCodigo(codigo)
      principal = { id: `totp:${quem}`, type: 'totp' }
    } else {
      principal = { id: `hub:${quem}`, type: 'human' }
    }
    await this.handoffs.aprovar(id, principal)
    this.logger.log(`envelope ${id} aprovado pelo Hub (${principal.id}, alçada ${alcada})`)

    // A aprovação expira em minutos e, pelo Hub, não há ninguém para dar o próximo passo — então
    // materializa já. Falhar aqui (agent desligado, prévia recusa) deixa o envelope `approved`:
    // é dito, não escondido, e a materialização pode ser repetida.
    try {
      const resultado = await this.handoffs.materializar(id)
      return { aprovado: true, alcada, materializado: true, resultado }
    } catch (e) {
      return { aprovado: true, alcada, materializado: false, motivo: (e as Error).message }
    }
  }

  rejeitar(id: string, motivo?: string) {
    return this.handoffs.rejeitar(id, motivo?.slice(0, 500) || 'rejeitado no Hub')
  }

  private conferirCodigo(codigo: string) {
    const segredo = process.env.APPROVAL_TOTP_SECRET
    if (!segredo || segredo.replace(/[\s=]/g, '').length < 16) {
      // Falha fechada, como o APPROVAL_TOKEN: aprovação nunca cai para "aberta" por falta de configuração.
      throw new ServiceUnavailableException('Aprovação pelo Hub indisponível: APPROVAL_TOTP_SECRET não configurado')
    }

    const agora = this.relogio()
    this.falhas = this.falhas.filter((t) => agora - t < JANELA_DE_FALHAS_MS)
    if (this.falhas.length >= MAX_FALHAS) {
      // Sem isto, 10^6 códigos com janela de 3 passos se acham por força bruta em horas.
      throw new HttpException('Muitas tentativas erradas — espere 15 minutos', HttpStatus.TOO_MANY_REQUESTS)
    }

    const passo = verificarTotp(segredo, String(codigo ?? '').trim(), agora)
    if (passo === null) {
      this.falhas.push(agora)
      throw new UnauthorizedException('Código do autenticador inválido')
    }
    if (passo <= this.ultimoPassoAceito) {
      this.falhas.push(agora)
      throw new UnauthorizedException('Este código já foi usado — espere o próximo')
    }
    this.ultimoPassoAceito = passo
    this.falhas = []
  }
}

function efeitosDe(bruto: unknown): { actionKey: string }[] {
  return Array.isArray(bruto)
    ? bruto.filter((e): e is { actionKey: string } => typeof (e as { actionKey?: unknown })?.actionKey === 'string')
    : []
}
