import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { baterNaV2 } from '../../common/system-heartbeat'
import { HandoffService } from './handoff.service'

/**
 * Varre os envelopes parados em `reconciling` e fecha cada um.
 *
 * ── Por que um ciclo, e não uma rota que alguém chama ───────────────────────
 * `reconciling` é um estado de passagem: se nada o resolver, o envelope fica ali para sempre
 * e o registro passa a dizer "estou verificando" sobre algo que ninguém está verificando. Foi
 * exatamente isso que deixou três tarefas presas em `processing` desde 17/06 até o A05.
 *
 * Deixar a resolução para uma chamada manual seria a família do `setCostController()` — o
 * wiring que ninguém lembrou de fazer e que manteve a V2 três meses sem registrar custo.
 *
 * ── A folga antes de verificar não é conservadorismo ────────────────────────
 * A tarefa reporta `done` e o envelope entra em `reconciling` no mesmo instante. Verificar
 * imediatamente poderia perguntar ao disco antes de o sistema de arquivos ter assentado o que
 * a ação acabou de escrever, e um efeito real apareceria como ausente — que aqui significa
 * mandar uma pessoa investigar um problema que não existe.
 */
const FOLGA_ANTES_DE_VERIFICAR_MS = 15_000
const INTERVALO_MS = 60_000
const WARMUP_MS = 30_000

@Injectable()
export class HandoffReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HandoffReconciliationService.name)
  private warmup: ReturnType<typeof setTimeout> | null = null
  private ciclo: ReturnType<typeof setInterval> | null = null

  constructor(private readonly handoffs: HandoffService) {}

  onModuleInit() {
    if (process.env.HANDOFF_RECONCILIATION_ENABLED === 'false') {
      this.logger.log('reconciliação de handoff desligada por env')
      return
    }
    this.warmup = setTimeout(() => {
      void this.varrer()
      this.ciclo = setInterval(() => void this.varrer(), INTERVALO_MS)
    }, WARMUP_MS)
    this.logger.log(`reconciliação de handoff agendada (${INTERVALO_MS / 1000}s)`)
  }

  onModuleDestroy() {
    if (this.warmup) clearTimeout(this.warmup)
    if (this.ciclo) clearInterval(this.ciclo)
  }

  /**
   * O detalhe do batimento separa "quieto porque está tudo bem" de "quieto porque parou de
   * chegar trabalho" — a lição do QA Scientist, que batia `ok` todo dia sem produzir nada.
   */
  async varrer(): Promise<{ varridos: number; concluidos: number; incertos: number; semResposta: number }> {
    let ok = false
    let erro: string | undefined
    const conta = { varridos: 0, concluidos: 0, incertos: 0, semResposta: 0 }

    try {
      const parados = await this.handoffs.emReconciliacao(FOLGA_ANTES_DE_VERIFICAR_MS)
      conta.varridos = parados.length

      for (const { id } of parados) {
        try {
          const depois = await this.handoffs.reconciliar(id)
          if (depois.status === 'completed') conta.concluidos++
          else if (depois.status === 'effect_unknown') conta.incertos++
          else conta.semResposta++
        } catch (e) {
          // Um envelope que falha não pode parar a varredura dos outros.
          conta.semResposta++
          this.logger.warn(`handoff ${id.slice(0, 8)} não reconciliou: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      ok = true
      return conta
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`varredura de reconciliação falhou: ${erro}`)
      return conta
    } finally {
      // `finally` pelo motivo do catálogo: ciclo que lança antes de reportar fica idêntico a
      // ciclo que nunca subiu.
      await baterNaV2('handoff-reconciliation', { ok, erro, detalhe: conta })
    }
  }
}
