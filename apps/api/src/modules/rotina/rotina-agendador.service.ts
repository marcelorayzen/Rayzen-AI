import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { baterNaV2 } from '../../common/system-heartbeat'
import { RotinaDisparoService } from './rotina-disparo.service'
import { validarGatilho } from './rotina.const'

const TICK_MS = 60_000
/** Mesmo warmup do auto-checkpoint: o Prisma de pé, e o ciclo reporta vivo logo depois de subir. */
const WARMUP_MS = 90_000

/**
 * G6, fatia 5 — o agendador das rotinas de agenda. A cada 60 s escolhe as rotinas `ativa` com
 * gatilho de agenda cujo intervalo venceu e as dispara pelo `RotinaDisparoService`, que confere os
 * limites e só cria envelope para aprovação.
 *
 * Ciclo automático da casa: declarado em `system-components.const.ts` da V2 (`rotinas`) e com
 * batimento em `finally`, com `varridas` e `disparadas` no detalhe — um ciclo que varre e não
 * dispara nada é saudável, e precisa ser distinguível de um ciclo parado.
 *
 * Desligar: `ROTINAS_CYCLE_ENABLED=false`.
 */
@Injectable()
export class RotinaAgendadorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RotinaAgendadorService.name)
  private timers: NodeJS.Timeout[] = []
  private rodando = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly disparo: RotinaDisparoService,
  ) {}

  onModuleInit() {
    if (process.env.ROTINAS_CYCLE_ENABLED === 'false') return
    this.timers.push(setTimeout(() => void this.varrer(), WARMUP_MS))
    this.timers.push(setInterval(() => void this.varrer(), TICK_MS))
    this.logger.log(`Agendador de rotinas ativo — tick ${TICK_MS / 1000}s`)
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t)
  }

  /** Uma varredura. Público para o teste com relógio falso; nunca lança. */
  async varrer(agora = new Date()): Promise<{ varridas: number; disparadas: number }> {
    // Uma varredura por vez: com o banco lento, o tick seguinte não pode disparar a mesma rotina
    // em paralelo antes de a primeira gravar `ultimoDisparoEm`.
    if (this.rodando) return { varridas: 0, disparadas: 0 }
    this.rodando = true
    let ok = false
    let erro: string | undefined
    let varridas = 0
    let disparadas = 0
    try {
      const ativas = await this.prisma.rotina.findMany({ where: { status: 'ativa' } })
      for (const rotina of ativas) {
        let gatilho
        try { gatilho = validarGatilho(rotina.gatilho) } catch { continue }
        if (gatilho.tipo !== 'agenda') continue
        varridas++
        const intervalo = gatilho.intervaloMin * 60_000
        const vencida = !rotina.ultimoDisparoEm
          || agora.getTime() - rotina.ultimoDisparoEm.getTime() >= intervalo
        if (!vencida) continue
        // 24/11: `ultimoDisparoEm` só anda quando um envelope NASCE. Com a proposta anterior ainda
        // aberta, nada nasce, e a rotina seguia "vencida" a cada tique de 1 min: no ensaio do
        // cenário 4, um "proposta_aberta" por minuto, que em 20 min empurraria o histórico real
        // para fora. A agenda conta também da última execução registrada, seja qual for o
        // resultado. Meio tique de folga porque `disparadaEm` é gravado alguns ms depois do tique.
        const ultima = await this.prisma.rotinaExecucao.findFirst({
          where: { rotinaId: rotina.id }, orderBy: { disparadaEm: 'desc' }, select: { disparadaEm: true },
        })
        if (ultima && agora.getTime() - ultima.disparadaEm.getTime() < intervalo - TICK_MS / 2) continue
        const r = await this.disparo.disparar(rotina.id, { tipo: 'agenda', valores: { em: agora.toISOString() } }, agora)
          .catch((e: unknown) => ({ resultado: 'falhou' as const, erro: String(e) }))
        if (r.resultado === 'proposto') disparadas++
      }
      ok = true
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`rotinas: varredura falhou: ${erro}`)
    } finally {
      this.rodando = false
      await baterNaV2('rotinas', { ok, erro, detalhe: { varridas, disparadas } })
    }
    return { varridas, disparadas }
  }
}
