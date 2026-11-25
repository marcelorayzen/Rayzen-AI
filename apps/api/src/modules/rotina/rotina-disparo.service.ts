import { Inject, Injectable, Logger } from '@nestjs/common'
import { CANAL_DE_AVISO, escaparMarkdown, linkDoFio, type CanalDeAviso } from '../agent-session/canal-de-aviso'
import { PrismaService } from '../../prisma/prisma.service'
import { HandoffService } from '../handoff/handoff.service'
import { ESTADOS_FINAIS, type ConteudoDoHandoff, type EstadoDoHandoff } from '../handoff/handoff.const'
import { RotinaService } from './rotina.service'
import { INTERVALO_MINIMO_MIN, TETO_POR_HORA, validarModelo, type ResultadoDeExecucao } from './rotina.const'
import { montarPromptDaSessao, preencherMarcadores } from './prompt-da-sessao.const'

const MIN = 60_000

/** Do que o disparo precisa saber sobre a origem. Só campos estruturados (ver o desenho do G6). */
export interface OrigemDoDisparo {
  tipo: 'agenda' | 'github' | 'manual'
  /** Valores que podem preencher marcadores `{{...}}` no modelo. */
  valores?: Record<string, string | number | undefined>
  /** Ramo de onde a sessão parte (fatia 4). Ausente: topo do branch padrão. */
  baseRef?: string
  /** Identidade do evento, para não disparar duas vezes o mesmo (o GitHub reentrega webhook). */
  chave?: string
}

export type ResultadoDoDisparo = { resultado: ResultadoDeExecucao; envelopeId?: string; erro?: string }

/**
 * G6, fatia 5 — o disparo de UMA rotina: confere os limites, monta o envelope pela regra do Hub e o
 * SUBMETE para aprovação. Nunca aprova nem executa: a sessão continua precisando do toque do
 * Marcelo (alçada `propoe`) e continua parando no diff final.
 *
 * A ordem das recusas é deliberada — da mais barata para a mais cara, e todas antes de criar
 * qualquer coisa: duplicado, intervalo mínimo, teto por hora, proposta ainda aberta.
 */
@Injectable()
export class RotinaDisparoService {
  private readonly logger = new Logger(RotinaDisparoService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly handoffs: HandoffService,
    private readonly rotinas: RotinaService,
    @Inject(CANAL_DE_AVISO) private readonly canal: CanalDeAviso,
  ) {}

  async disparar(rotinaId: string, origem: OrigemDoDisparo, agora = new Date()): Promise<ResultadoDoDisparo> {
    const rotina = await this.prisma.rotina.findUnique({ where: { id: rotinaId } })
    if (!rotina) return { resultado: 'falhou', erro: `rotina ${rotinaId} não existe` }
    const registroDaOrigem = { tipo: origem.tipo, ...(origem.valores ?? {}), ...(origem.baseRef ? { baseRef: origem.baseRef } : {}) }

    const registrar = async (r: ResultadoDoDisparo, titulo?: string): Promise<ResultadoDoDisparo> => {
      await this.rotinas.registrarExecucao(rotinaId, {
        origem: registroDaOrigem, resultado: r.resultado,
        ...(origem.chave ? { chave: origem.chave } : {}),
        ...(r.envelopeId ? { envelopeId: r.envelopeId } : {}),
        ...(r.erro ? { erro: r.erro } : {}),
      })
      await this.avisar(rotina, origem, r, titulo)
      return r
    }

    // Só rotina ativa dispara — inclusive no "testar agora", que só pula a espera da agenda.
    if (rotina.status !== 'ativa') return { resultado: 'falhou', erro: `rotina está ${rotina.status}` }

    if (origem.chave) {
      const repetida = await this.prisma.rotinaExecucao.findFirst({ where: { rotinaId, chave: origem.chave } })
      if (repetida) return registrar({ resultado: 'ignorado_duplicado' })
    }
    if (rotina.ultimoDisparoEm && agora.getTime() - rotina.ultimoDisparoEm.getTime() < INTERVALO_MINIMO_MIN * MIN) {
      return registrar({ resultado: 'limite', erro: `menos de ${INTERVALO_MINIMO_MIN} min desde o último disparo` })
    }
    const naUltimaHora = await this.prisma.rotinaExecucao.count({
      where: { rotinaId, resultado: 'proposto', disparadaEm: { gte: new Date(agora.getTime() - 60 * MIN) } },
    })
    if (naUltimaHora >= TETO_POR_HORA) {
      return registrar({ resultado: 'limite', erro: `teto de ${TETO_POR_HORA} disparos por hora` })
    }
    const ultimaProposta = await this.prisma.rotinaExecucao.findFirst({
      where: { rotinaId, resultado: 'proposto', envelopeId: { not: null } },
      orderBy: { disparadaEm: 'desc' },
    })
    if (ultimaProposta?.envelopeId) {
      const envelope = await this.handoffs.buscar(ultimaProposta.envelopeId).catch(() => null)
      if (envelope && !ESTADOS_FINAIS.includes(envelope.status as EstadoDoHandoff)) {
        return registrar({ resultado: 'proposta_aberta', envelopeId: envelope.id })
      }
    }

    try {
      const modelo = validarModelo(rotina.modelo)
      const valores = origem.valores ?? {}
      const recusados = new Set<string>()
      const preencher = (t: string) => {
        const r = preencherMarcadores(t, valores)
        r.recusados.forEach((n) => recusados.add(n))
        return r.texto
      }
      const { prompt, problemas } = montarPromptDaSessao({
        objetivo: preencher(modelo.objetivo),
        restricoes: preencher(modelo.restricoes),
        criterioDePronto: preencher(modelo.criterioDePronto),
        prompt: modelo.detalhes ? preencher(modelo.detalhes) : undefined,
      })
      if (problemas.length) return registrar({ resultado: 'falhou', erro: `modelo inválido: ${problemas.join('; ')}` })
      const titulo = preencher(modelo.titulo).slice(0, 120)

      const envelope = await this.handoffs.criar({
        sourceProjectId: rotina.projectId,
        name: titulo,
        brief: prompt,
        template: 'sessao',
        root: process.env.AGENT_PROPOSTA_ROOT ?? 'C:/Users/dev/Projects',
        efeitos: [{
          actionKey: 'jarvis:supervised_session',
          payload: {
            projectId: rotina.projectId, prompt, publicar: true, aprovacao: modelo.aprovacao,
            ...(origem.baseRef ? { baseRef: origem.baseRef } : {}),
          },
        }],
      } satisfies ConteudoDoHandoff, `rotina:${rotina.id}`)
      await this.handoffs.submeter(envelope.id)
      await this.prisma.rotina.update({ where: { id: rotina.id }, data: { ultimoDisparoEm: agora } })

      // Marcador recusado não impede a proposta: o envelope sai com "[valor recusado]" à vista de
      // quem aprova, e o histórico diz qual foi.
      const nota = recusados.size ? `marcadores recusados: ${[...recusados].join(', ')}` : undefined
      return registrar({ resultado: 'proposto', envelopeId: envelope.id, ...(nota ? { erro: nota } : {}) }, titulo)
    } catch (err) {
      const msg = (err as Error).message.slice(0, 300)
      this.logger.warn(`rotina ${rotina.id}: disparo falhou: ${msg}`)
      return registrar({ resultado: 'falhou', erro: msg })
    }
  }

  /**
   * G6.5 — aviso pelo canal do G7 quando o disparo pede algo da pessoa: um envelope para aprovar
   * (`proposto`) ou uma rotina que falhou ao disparar (`falhou`). Duplicado, limite e proposta
   * ainda aberta ficam só no histórico: avisar cada reentrega do GitHub seria ruído, e o envelope
   * que já está aberto já foi avisado quando nasceu.
   *
   * Só entra no texto o que já é estrutural (nome da rotina, título montado com marcadores
   * filtrados, repositório, número do PR, workflow) — tudo escapado, porque o Telegram descarta em
   * silêncio a mensagem com Markdown quebrado. Falha do canal nunca muda o resultado do disparo.
   */
  private async avisar(
    rotina: { id: string; nome: string; projectId: string },
    origem: OrigemDoDisparo,
    r: ResultadoDoDisparo,
    titulo?: string,
  ): Promise<void> {
    if (r.resultado !== 'proposto' && r.resultado !== 'falhou') return
    // Mesmo filtro dos marcadores: `workflow` é nome escrito por quem fez o YAML e pode ser frase.
    const estrutural = (campo: string) => {
      const p = preencherMarcadores(`{{${campo}}}`, origem.valores ?? {})
      return p.recusados.length ? undefined : p.texto
    }
    const numeroDoPr = estrutural('pr.numero')
    const workflow = estrutural('workflow')
    const de = origem.tipo === 'agenda'
      ? 'agenda'
      : origem.tipo === 'manual'
        ? 'testar agora'
        : ['GitHub', estrutural('repo'), numeroDoPr && `PR #${numeroDoPr}`, workflow && `workflow ${workflow}`]
          .filter(Boolean).join(' · ')
    const nome = escaparMarkdown(rotina.nome)
    const texto = r.resultado === 'proposto'
      ? `🔁 *Rotina disparou:* ${nome}\nOrigem: ${escaparMarkdown(de)}\n\nEnvelope aguardando sua aprovação: ${escaparMarkdown(titulo ?? '')}`
      : `⚠️ *Rotina falhou ao disparar:* ${nome}\nOrigem: ${escaparMarkdown(de)}\n\n${escaparMarkdown((r.erro ?? 'motivo desconhecido').slice(0, 300))}`
    try {
      await this.canal.enviar(texto + linkDoFio(rotina.projectId))
    } catch (err) {
      this.logger.warn(`rotina ${rotina.id}: aviso não saiu: ${(err as Error).message}`)
    }
  }
}
