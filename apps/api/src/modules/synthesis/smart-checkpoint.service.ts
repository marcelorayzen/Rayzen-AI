import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { SynthesisService } from './synthesis.service'
import { baterNaV2 } from '../../common/system-heartbeat'

const INTERVAL_MS   = 10 * 60 * 1000  // checar a cada 10min
const MIN_EVENTS    = 5                // mínimo de eventos para qualquer trigger
const BURST_EVENTS  = 8               // trigger por burst de atividade
const MAX_HOURS     = 2               // trigger por tempo decorrido

@Injectable()
export class SmartCheckpointService implements OnModuleInit {
  private readonly logger = new Logger(SmartCheckpointService.name)

  // Sem `DocumentationService` aqui: a dependência existia só para a segunda geração
  // removida acima, e vinha por `forwardRef` — uma referência circular mantida viva por
  // uma chamada redundante. Injeção que não é usada é a próxima a ser usada por engano.
  constructor(
    private readonly prisma: PrismaService,
    private readonly synthesis: SynthesisService,
  ) {}

  /**
   * ── O warmup não é enfeite: sem ele, todo restart arrisca um alerta falso ──
   *
   * Isto era `setInterval` puro, **sem execução imediata**: depois de um restart o primeiro
   * batimento só saía 10 minutos depois. O `panorama` considera este ciclo atrasado com
   * `beatEveryMs + graceMs` = 20 min contados do ÚLTIMO batimento — então um restart no fim da
   * janela de 10 min empurra o próximo para além do limite, o ciclo aparece `sem-noticia`, e sai
   * um alerta no Telegram sobre um ciclo que está perfeitamente vivo.
   *
   * Apareceu no teste controlado de queda da V1 em 18/09: junto com o alerta legítimo da api veio
   * um de `auto-checkpoint`. Como **todo deploy recria este container**, isso viraria duas
   * mensagens espúrias por deploy — e alerta que grita à toa é como o alerta deixa de ser lido.
   *
   * Rodar cedo não antecipa trabalho nenhum: `checkAll()` só dispara síntese quando os gatilhos
   * (≥5 eventos e decisão|burst|2h) já estariam satisfeitos daqui a 10 minutos de qualquer forma.
   * O que muda é o ciclo passar a **reportar que está vivo** logo depois de subir.
   */
  onModuleInit() {
    if (process.env.SMART_CHECKPOINT_ENABLED === 'false') return

    // Curto, só o suficiente para o Prisma estar de pé — mesmo padrão do ciclo de invariantes.
    const WARMUP_MS = 90_000
    setTimeout(() => void this.checkAll().catch(() => null), WARMUP_MS)
    setInterval(() => this.checkAll().catch(() => null), INTERVAL_MS)
    this.logger.log(`Smart checkpoint ativo — intervalo ${INTERVAL_MS / 60_000}min, triggers: decision|burst(${BURST_EVENTS})|timer(${MAX_HOURS}h)`)
  }

  private async checkAll(): Promise<void> {
    // `beat` em `finally`, e as contagens no detalhe: um ciclo que varre 8 projetos e
    // não dispara nenhum é saudável, mas é **indistinguível** de um ciclo que parou se
    // o batimento só disser "executei". Mesma lição do QA Scientist, que reportou
    // `{ ciclos: 10 }` com `ok: true` por 13 dias sem fazer nada.
    let ok = false
    let erro: string | undefined
    let varridos   = 0
    let disparados = 0

    try {
      const projects = await this.prisma.project.findMany({
        where: { status: 'active' },
        select: { id: true },
      })
      for (const project of projects) {
        const r = await this.checkProject(project.id).catch(() => null)
        varridos++
        if (r?.triggered) disparados++
      }
      ok = true
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`auto-checkpoint: varredura falhou: ${erro}`)
    } finally {
      await baterNaV2('auto-checkpoint', { ok, erro, detalhe: { varridos, disparados } })
    }
  }

  async checkProject(projectId: string): Promise<{ triggered: boolean; reason?: string }> {
    const lastCheckpoint = await this.prisma.sessionArtifact.findFirst({
      where: { projectId, type: 'checkpoint' },
      orderBy: { createdAt: 'desc' },
    })

    const since = lastCheckpoint?.createdAt ?? new Date(Date.now() - MAX_HOURS * 3_600_000)

    const events = await this.prisma.event.findMany({
      where: { projectId, ts: { gte: since }, memoryClass: { not: 'archive' } },
      orderBy: { ts: 'desc' },
      select: { id: true, intent: true },
    })

    if (events.length < MIN_EVENTS) return { triggered: false }

    const hoursSinceLast = lastCheckpoint
      ? (Date.now() - lastCheckpoint.createdAt.getTime()) / 3_600_000
      : MAX_HOURS + 1

    const hasDecision = events.some(e => e.intent === 'decision')
    const isBurst     = events.length >= BURST_EVENTS
    const isOverdue   = hoursSinceLast >= MAX_HOURS

    if (!hasDecision && !isBurst && !isOverdue) return { triggered: false }

    const reason = hasDecision ? 'decision_detected'
      : isBurst ? 'activity_burst'
      : 'time_elapsed'

    this.logger.log(`auto-checkpoint: projeto ${projectId} — ${reason} (${events.length} eventos desde último)`)

    // `checkpoint()` JÁ dispara `generateAll(force: true)` no fim do próprio pipeline
    // (synthesis.service.ts). Chamar aqui de novo regenerava **todos os documentos duas
    // vezes por gatilho** — duas execuções concorrentes, com `force`, escrevendo as
    // mesmas linhas de `project_documents`.
    //
    // Medido em 2026-09-06 no Langfuse: `rayzen:v1:documentation` é o **maior consumidor
    // de LLM da plataforma** — 3.374 chamadas em 30 dias, mais que todos os outros
    // módulos somados —, e naquele dia 285 das 519 falharam. Nada acusava, porque as
    // duas chamadas são fire-and-forget com `.catch()` mudo.
    //
    // Não é otimização prematura: o gargalo desta casa é **cota**, não dinheiro, e
    // gerar em dobro num free tier põe o próprio grupo em cooldown de ~8min
    // (`No deployments available … Try again in 497 seconds`), derrubando quem chegar
    // depois. Ver docs/baseline-roteamento-llm.md.
    await this.synthesis.checkpoint(projectId, undefined, undefined, { autoTriggered: true, reason })

    return { triggered: true, reason }
  }
}
