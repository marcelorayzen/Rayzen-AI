import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { SystemStatusService } from '../system-status/system-status.service'
import { HEARTBEAT_HORAS } from '../invariants/invariants.service'
import { enviarAoTelegram } from '../invariants/notificar-transicao'
import {
  blocoDeCiclos, blocoDeInvariantes, blocoDeServicos, montarPanorama,
  type InvarianteBruto, type LeituraDeProjeto, type Panorama, type RespostaV1, type SaudeV1,
  type ServicoExtra,
} from './panorama.const'
import { idsAlertaveis, textoDoPanorama, transicaoDoPanorama } from './alerta-de-panorama'

/** Uma linha por projeto: o relatório mais novo, e nada mais. */
interface LinhaCrua {
  project_id: string
  created_at: Date
  resultados: unknown
}

@Injectable()
export class PanoramaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PanoramaService.name)

  private warmupTimer?: NodeJS.Timeout
  private cycleTimer?:  NodeJS.Timeout

  /**
   * Último conjunto alertável **deste processo**. A memória é a fonte preferida porque está sempre
   * correta para o processo em execução — inclusive quando o banco não responde, que é justamente
   * um dos casos que este ciclo precisa conseguir anunciar.
   *
   * Vazia depois de um restart; aí o `beat` persistido (abaixo) devolve a continuidade.
   */
  private ultimoAlertavel: Set<string> | null = null

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly system: SystemStatusService,
  ) {}

  /**
   * ── O ciclo, e por que ele é de 5 minutos ─────────────────────────────────
   *
   * A pergunta que ele responde — "a V1 continua de pé?" — não tem outro sensor: os quatro
   * invariantes que a sondam devolvem inconclusivo quando ela cala, então V1 fora com o Postgres
   * de pé deixa 18 de 18 verdes. Ver `alerta-de-panorama.ts`.
   *
   * 5 min é o mesmo ritmo do `deploy-drift`, que observa uma falha da mesma família ("está no ar o
   * que deveria?"). O custo é uma requisição HTTP e duas queries; o alerta só sai na transição.
   */
  onModuleInit() {
    if (process.env.PANORAMA_CYCLE_ENABLED === 'false') {
      this.logger.log('PanoramaService: ciclo desligado por env')
      return
    }

    const WARMUP_MS   = 90_000
    const INTERVAL_MS = 5 * 60_000

    this.warmupTimer = setTimeout(() => {
      void this.ciclo()
      this.cycleTimer = setInterval(() => void this.ciclo(), INTERVAL_MS)
    }, WARMUP_MS)
  }

  onModuleDestroy() {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.cycleTimer)  clearInterval(this.cycleTimer)
  }

  /**
   * Mede, compara com o anterior e avisa **só na transição**.
   *
   * `beat` em `finally` — ver `system-status.service.ts`. E o detalhe carrega o conjunto
   * alertável: é ele que dá continuidade depois de um restart, sem tabela nova.
   */
  private async ciclo(): Promise<void> {
    let ok = false
    let erro: string | undefined
    let alertaveis: string[] = []
    let avisou = false

    try {
      const p      = await this.panorama()
      const agora  = idsAlertaveis(p)
      alertaveis   = [...agora]

      const anterior = this.ultimoAlertavel ?? (await this.alertavelPersistido())
      const t        = transicaoDoPanorama(agora, anterior)
      const texto    = textoDoPanorama(p, t)

      if (texto) {
        // `enviarAoTelegram` DEVOLVE se o Telegram aceitou, e o retorno é o que vale: marcar
        // `avisou = true` antes do await afirmaria entrega a partir da própria intenção de
        // entregar. Ele falha em silêncio de propósito (não conseguir avisar não pode derrubar o
        // ciclo, que é o que ainda está funcionando) — então o único rastro possível é este
        // campo, e um campo que sempre diz "sim" não é rastro.
        avisou = await enviarAoTelegram(texto)
        if (!avisou) this.logger.warn('panorama: transição detectada e o Telegram não aceitou a mensagem')
      }

      this.ultimoAlertavel = agora
      ok = true
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`ciclo do panorama falhou: ${erro}`)
    } finally {
      await this.system.beat('panorama', {
        ok,
        erro,
        detalhe: { alertaveis, avisou },
        host:    'api-v2',
      })
    }
  }

  /**
   * O conjunto alertável da última execução, lido do próprio batimento.
   *
   * Sem isto, um restart do `api-v2` zeraria a memória e — pela regra de "sem anterior não inventa
   * transição" — a queda que já estava acontecendo **nunca seria anunciada**. Reaproveita o
   * `lastDetail` que o batimento já persiste, em vez de uma tabela nova para guardar um conjunto
   * de strings.
   *
   * Devolve `null` quando não há leitura confiável: não inventar transição continua valendo mais
   * que avisar cedo demais.
   */
  private async alertavelPersistido(): Promise<Set<string> | null> {
    try {
      const linhas = await this.system.status()
      const meu    = linhas.find((c) => c.id === 'panorama')
      const det    = meu?.lastDetail as { alertaveis?: unknown } | null | undefined
      if (!det || !Array.isArray(det.alertaveis)) return null
      return new Set(det.alertaveis.filter((x): x is string => typeof x === 'string'))
    } catch {
      return null
    }
  }

  /**
   * As três leituras em paralelo. Nenhuma pode derrubar as outras: um painel que responde 500
   * porque um dos sensores falhou não serve para a pergunta "algum serviço caiu?" — é justamente
   * quando algo caiu que ele precisa responder.
   */
  async panorama(): Promise<Panorama> {
    const [respostaV1, bancoOk, hub] = await Promise.all([
      this.sondarV1(),
      this.bancoResponde(),
      this.sondarHub(),
    ])

    const ciclos = bancoOk
      ? await this.system.status().catch((e) => { this.logger.warn(`ciclos: ${e}`); return [] })
      : []

    const leituras = bancoOk ? await this.leiturasDeInvariantes() : []

    return montarPanorama(
      blocoDeServicos(respostaV1, [hub]),
      blocoDeCiclos(
        ciclos.map((c) => ({ id: c.id, titulo: c.titulo, estado: c.estado, lastError: c.lastError })),
        bancoOk,
      ),
      blocoDeInvariantes(leituras, HEARTBEAT_HORAS),
    )
  }

  /**
   * Sonda da V1 — e a distinção que importa é **estrutural: houve status HTTP?**
   *
   * Mesma regra de `modelos_llm_respondem`, nunca por texto de erro. "Respondeu 503" e "não
   * respondeu nada" têm causas diferentes e exigem coisas diferentes de quem lê o painel.
   */
  private async sondarV1(): Promise<RespostaV1> {
    // `V1_API_URL` por `process.env`, com o mesmo default — cópia literal de como
    // `invariants.service.ts` fala com a V1. **A V2 não registra `ConfigModule`** e nenhum outro
    // serviço dela injeta `ConfigService`; trazer um por causa deste seria wiring novo para um
    // consumidor só. Descoberto pelo `aplicacao-sobe.spec.ts`, não por leitura.
    //
    // Nome reaproveitado de propósito: inventar um aqui criaria variável que ninguém declara — a
    // família exata do `TELEGRAM_API_TOKEN`, que não existia e deixou o chat livre em 401.
    const base = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const url  = `${base}/infra/health`
    try {
      const ctrl    = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 4000)
      const res     = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timeout)

      if (res.status >= 500) return { tipo: 'statusRuim', status: res.status }
      const corpo = (await res.json()) as SaudeV1
      if (!corpo || typeof corpo !== 'object' || !corpo.services) {
        return { tipo: 'statusRuim', status: res.status }
      }
      return { tipo: 'respondeu', corpo }
    } catch (e) {
      return { tipo: 'semResposta', erro: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * ── O HUB, sondado daqui e não pela V1 ───────────────────────────────────
   *
   * Entrou em 18/09, no mesmo dia em que o `hermes serve` virou a porta de entrada e ficou **sem
   * observador nenhum** — o buraco que este ciclo existe para fechar na V1, recriado por quem
   * estava fechando o original.
   *
   * `/api/health` do Hermes é público de propósito (não exige sessão), então a sonda não precisa
   * de credencial — e é bom que não precise: um sensor que depende de login falha junto com o
   * login. A resposta traz `auth_required`, e **`false` aqui seria um achado grave**: significaria
   * o portão de autenticação desligado numa superfície que está na internet.
   */
  private async sondarHub(): Promise<ServicoExtra> {
    const base   = (process.env.HERMES_URL ?? 'http://hermes:9119').replace(/\/$/, '')
    const titulo = 'O HUB (Hermes) responde'
    try {
      const ctrl    = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), 4000)
      const res     = await fetch(`${base}/api/health`, { signal: ctrl.signal })
      clearTimeout(timeout)

      if (!res.ok) return { id: 'hub', titulo, ok: false, erro: `respondeu HTTP ${res.status}` }

      const corpo = (await res.json()) as { ok?: boolean; auth_required?: boolean }
      if (corpo?.auth_required === false) {
        return { id: 'hub', titulo, ok: false, erro: 'ESTÁ SEM AUTENTICAÇÃO — o portão caiu numa superfície pública' }
      }
      return { id: 'hub', titulo, ok: corpo?.ok === true, erro: corpo?.ok === true ? undefined : 'respondeu, mas não se declarou saudável' }
    } catch (e) {
      return { id: 'hub', titulo, ok: false, erro: `não respondeu (${e instanceof Error ? e.message : String(e)})` }
    }
  }

  /**
   * `SELECT 1` antes de ler qualquer coisa do banco.
   *
   * Sem isto, banco fora do ar é indistinguível de "tudo parado": `SystemStatusService.status()`
   * engole o erro do Prisma, devolve `[]` e — como monta a lista a partir do CATÁLOGO — apresenta
   * **todos** os ciclos como `nunca-subiu`. Sete falhas inventadas escondendo a única real.
   */
  private async bancoResponde(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return true
    } catch (e) {
      this.logger.warn(`banco da V2 não respondeu: ${e}`)
      return false
    }
  }

  /**
   * O relatório mais novo **de cada projeto**, numa consulta.
   *
   * `DISTINCT ON` em vez de N chamadas a `latest(projectId)`: com 10 projetos seriam 10 idas ao
   * banco para montar uma tela. E em vez de "pegue os últimos N e agrupe em JS", porque um
   * projeto que falha a cada 30min domina qualquer janela fixa e apagaria os outros da lista.
   */
  private async leiturasDeInvariantes(): Promise<LeituraDeProjeto[]> {
    try {
      const linhas = await this.prisma.$queryRaw<LinhaCrua[]>`
        SELECT DISTINCT ON (project_id) project_id, created_at, resultados
          FROM v2.invariant_reports
         ORDER BY project_id, created_at DESC
      `
      return linhas.map((l) => ({
        projectId:  l.project_id,
        idadeH:     (Date.now() - new Date(l.created_at).getTime()) / 3_600_000,
        resultados: Array.isArray(l.resultados) ? (l.resultados as InvarianteBruto[]) : [],
      }))
    } catch (e) {
      this.logger.warn(`leitura de invariantes falhou: ${e}`)
      return []
    }
  }
}
