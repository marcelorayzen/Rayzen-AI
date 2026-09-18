import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Socket } from 'node:net'
import { transicoesAltas, textoDaTransicao, enviarAoTelegram, mudouAlgumEstado } from './notificar-transicao'
import { existsSync, readdirSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { SystemStatusService } from '../system-status/system-status.service'
import { ContextEngineService } from '../context-engine/context-engine.service'
import { TASK_TYPES } from '../benchmark/task-types.const'
import { ehCaminhoDeSegredo } from '../core/segredo-path.const'
import {
  INVARIANTES,
  GRAVIDADE_ORDEM,
  type InvariantResult,
  type Gravidade,
} from './invariant-checks.const'

export interface InvariantRunResult {
  projectId:    string
  totalOk:      number
  totalFalha:   number
  gravidadeMax: Gravidade | 'ok'
  resumo:       string
  resultados:   InvariantResult[]
  createdAt:    Date
}

// Lista canônica importada do domínio dono — estava duplicada aqui e no
// QaScientistService, o que permitiria o invariante validar contra uma lista
// enquanto o experimento roda contra outra.
const TASK_TYPES_VALIDOS: readonly string[] = TASK_TYPES

/** Acima disto o relógio já compromete a datação de eventos e o ciclo de 24h. */
const DERIVA_MAX_SEGUNDOS = 120

/** Missão ativa parada mais que isto vira ruído no contexto injetado. */
const MISSAO_TRAVADA_DIAS = 7

/**
 * Janela do check de órfãos. O passivo histórico (236 eventos em 2026-08-16) fica
 * fora dela de propósito: falhar por causa dele deixaria o check vermelho para
 * sempre, e vermelho permanente é o que se aprende a ignorar.
 */
const ORFAO_JANELA_DIAS = 7

/**
 * Acima disto o disco vira risco. Em 85% ainda sobram ~16 GB no H81 — folga para agir
 * sem pressa. Alertar antes de doer é o ponto: quando o build comeca a falhar, ja e tarde.
 */
const DISCO_LIMIAR_PCT = 85
/**
 * Faixa em que o aviso deixa de ser "cuide disso" e vira "isto vai parar o banco".
 *
 * Não é uma gravidade nova — `alta` já é o teto, e acrescentar um quarto nível para codificar uma
 * faixa rippliaria por `GRAVIDADE_ORDEM`, pela UI e pelo hook. O que muda é o TEXTO: em 16/09 o
 * sensor avisou em 85, 86, 88, 90, 92 e 95% e cada aviso foi lido como o anterior, porque todos
 * diziam a mesma coisa — um número. Nenhum dizia o que acontece quando chega a 100.
 *
 * 93% e não 95%: em 95% sobravam 6 GB, e um único build frio consome mais que isso. O aviso
 * precisa chegar enquanto ainda dá para agir sem pressa.
 */
const DISCO_LIMIAR_CRITICO_PCT = 93

/**
 * Título que o `SessionService` da V1 usa quando a sessão não tem primeira mensagem de
 * usuário. Era o que aparecia nas 20 linhas do histórico em 2026-08-19.
 */
const TITULO_FALLBACK = 'Conversa'

/**
 * Grupos do LiteLLM que a sonda testa.
 *
 * São os do caminho gratuito, e só eles de propósito. `gpt-4o-premium` e
 * `gpt-4o-mini-premium` apontam para a Anthropic, cuja conta está sem crédito por
 * decisão — incluí-los deixaria o invariante vermelho para sempre, e vermelho
 * permanente é o que se aprende a ignorar. Mesmo princípio do `registro_sem_projeto`,
 * que olha só os últimos 7 dias em vez do passivo histórico.
 *
 * `gpt-4o` cai no fallback do router: se a Groq morrer e o próximo da cadeia responder,
 * a chamada passa e a sonda fica verde. Isso é correto — a pergunta é "a plataforma
 * consegue chamar um LLM?", não "o modelo A está de pé".
 *
 * Os dois grupos Gemini entram desde 2026-08-22, e é por causa dessa mesma passagem: como
 * o fallback mascara a queda do primário, a sonda de `gpt-4o` não diz se a REDE ainda
 * existe. Até 22/08 ela não existia — os dois fallbacks apontavam para a Anthropic sem
 * crédito — e ninguém sabia, o que transformou a descontinuação da Groq em 17/08 num 500
 * geral. Sondar o fallback direto é a única forma de descobrir que ele morreu **antes** de
 * precisar dele. Os `*-premium` continuam fora pelo motivo oposto: já se sabe que não
 * respondem, e vermelho permanente é o que se aprende a ignorar.
 */
export const GRUPOS_LLM_SONDADOS = ['gpt-4o', 'gpt-4o-mini', 'gpt-local', 'gpt-4o-gemini', 'gpt-4o-mini-gemini'] as const

/**
 * Consulta-sonda de `memoria_relevante_serve_util`. Fixa de propósito — o check só é
 * comparável entre execuções se a pergunta não mudar. É a mesma consulta do baseline de
 * precisão de 2026-08-17, aquela que trouxe dois `pnpm-lock.yaml` em cinco trechos no
 * banco-imob e originou este invariante.
 */
const CONSULTA_SONDA_MEMORIA = 'implementar cache de sessao no modulo de autenticacao'

/**
 * Arquivo que não é conhecimento: nasce de um build ou de um resolvedor de dependência.
 * Ocupa slot de trecho útil e nunca responde a pergunta nenhuma.
 */
const CAMINHOS_GERADOS = [
  /(^|[\\/])(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|poetry\.lock|Cargo\.lock|composer\.lock)$/i,
  /[\\/](node_modules|dist|build|out|coverage|\.next|\.turbo|graphify-out)[\\/]/i,
  /\.(min\.js|min\.css|map|lock)$/i,
]

export function ehArquivoGerado(caminho?: string | null): boolean {
  if (!caminho) return false
  return CAMINHOS_GERADOS.some((re) => re.test(caminho))
}

/**
 * Compara a pasta do arquivo com o repositório do projeto, tolerando as grafias que a
 * casa realmente usa. Comparação exata não serve, e cada caso abaixo é real:
 *
 * | projeto | repoSlug | pasta no disco |
 * |---|---|---|
 * | Rayzen AI | `rayzen-ai-private` | `rayzen-ai` |
 * | VB Ferragens | `vb_ferragens` | `VB-ferragens` |
 * | Commerce | `rayzen-commerce-platform` | `Rayzen Commerce Platform` |
 *
 * Daí normalizar espaço e `_` para `-` e aceitar prefixo nos dois sentidos. É a mesma
 * família de problema de `repo-slug.mjs`, que devolve duas grafias em ordem porque a
 * pasta nasce com o nome cru e o projeto é registrado em kebab.
 *
 * **Conservador por construção:** caminho de onde não dá para extrair uma pasta de
 * repositório — nota de aprendizado, URL do Notion, README do GitHub — devolve `false`.
 * Desconhecido não é alheio, e falso positivo num invariante custa mais que falso negativo.
 */
export function ehDeOutroRepo(caminho: string | null | undefined, repoSlug: string): boolean {
  if (!caminho || !repoSlug) return false

  // Guarda: só julga caminho de onde dá para localizar um repositório. Nota de
  // aprendizado, URL do Notion, README do GitHub e caminho relativo (`apps/api/package.json`)
  // saem aqui. Desconhecido não é alheio.
  if (!/[\\/][Pp]rojects[\\/]/.test(caminho)) return false

  const normaliza = (s: string) => s.toLowerCase().trim().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
  const slug = normaliza(repoSlug)
  if (!slug) return false

  // A pergunta é "o repositório deste projeto aparece no caminho?", e NÃO "qual é a pasta
  // logo depois de Projects?". A segunda versão era posicional e reprovou contra dado real
  // em 2026-08-22, duas vezes:
  //
  //   Desktop\Projects\Projetos\Ray Coach\personal-english-coach\...  → leu "Projetos"
  //   .claude\projects\c--Users-...-Projects-Rayzen-Commerce-Platform\memory\...
  //
  // O primeiro é repo aninhado dois níveis abaixo; o segundo é o caminho achatado que o
  // Claude Code usa para guardar memória, com o diretório inteiro num segmento só. Varrer
  // todos os segmentos resolve os dois sem tratar nenhum como caso especial.
  const casa = (s: string) =>
    s.length >= 4                             // `web`, `src`, `api` casariam com qualquer coisa
    && (s.startsWith(slug)                    // pasta `rayzen-ai-private-2`
      || slug.startsWith(s)                   // pasta `rayzen-ai`, slug `rayzen-ai-private`
      || s.endsWith(slug))                    // segmento achatado terminando no slug inteiro

  const pertence = caminho.split(/[\\/]+/).map(normaliza).some((seg) => {
    if (casa(seg)) return true
    // No caminho achatado, o nome real vem depois do último `-projects-`. Precisa passar
    // pelo mesmo `casa` e não por um `endsWith` direto: o segmento do Rayzen AI termina em
    // `rayzen-ai` enquanto o slug é `rayzen-ai-private`, e só o teste de prefixo nos dois
    // sentidos reconhece isso. Foram 64 falsos positivos até esta linha existir.
    const i = seg.lastIndexOf('-projects-')
    return i >= 0 && casa(seg.slice(i + '-projects-'.length))
  })

  return !pertence
}

/**
 * Os dois pares schema ↔ diretório de migração do monorepo. Const de propósito, pelo mesmo
 * motivo do catálogo de ciclos: com descoberta automática, o schema que ninguém consegue
 * localizar simplesmente não é checado, e some do relatório o caso que mais importa.
 */
const MIGRACOES_POR_SCHEMA = [
  { schema: 'v2',     dir: ['apps', 'api-v2', 'prisma', 'migrations'] },
  { schema: 'public', dir: ['apps', 'api',    'prisma', 'migrations'] },
] as const

/**
 * Sobe a partir do arquivo compilado até achar a raiz do monorepo. `process.cwd()` não
 * serve: muda entre o container (`/app`), o `pnpm --filter` e o jest.
 */
export function raizDoRepo(partida: string, existe: (p: string) => boolean): string | null {
  let dir = partida
  for (let i = 0; i < 8; i++) {
    if (existe(join(dir, 'apps', 'api-v2', 'prisma', 'migrations'))) return dir
    const acima = dirname(dir)
    if (acima === dir) break
    dir = acima
  }
  return null
}

export function nomeDoArquivo(caminho?: string | null): string {
  if (!caminho) return '(sem caminho)'
  return caminho.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? caminho
}

/**
 * O ciclo do servidor varre até 10 projetos por rodada, e esta pergunta não é por
 * projeto — os modelos são os mesmos para todos. Sem cache seriam 30 chamadas de LLM
 * a cada 30min para responder três vezes a mesma coisa. Mesmo motivo do cache do
 * `relogio_sincronizado`, com janela maior porque aqui cada sonda custa token.
 */
const SONDA_LLM_CACHE_MS = 10 * 60_000

/**
 * Nome com que a sonda se apresenta no Langfuse.
 *
 * Exportado para que o teste possa exigir o mesmo rótulo do corpo da requisição:
 * um chamador que se identifica com nome errado é indistinguível de um anônimo na
 * hora de perguntar "quem gastou esta cota?".
 */
export const SONDA_LLM_TRACE = 'rayzen:invariants:sonda-llm'

/**
 * De quantas em quantas horas o ciclo grava mesmo estando tudo ok.
 *
 * Exportado porque o `panorama` precisa do MESMO número para decidir se a leitura mais nova
 * ainda descreve o agora: com um limiar próprio, um relatório de 8h seria "velho" para um lado
 * e "fresco" para o outro, e o painel afirmaria saúde atual a partir de um registro que o
 * ciclo já considerou obsoleto. Duplicar o número aqui seria a família de drift do
 * `memory-ranking`, sem nem a barreira de compilação que justifica a cópia lá.
 */
export const HEARTBEAT_HORAS = 6

@Injectable()
export class InvariantsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvariantsService.name)

  private warmupTimer: ReturnType<typeof setTimeout>  | null = null
  private cycleTimer:  ReturnType<typeof setInterval> | null = null
  private relogioCache: { em: number; resultado: InvariantResult } | null = null
  private sondaLlmCache: { em: number; resultado: InvariantResult } | null = null

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly bridge: V1BridgeService,
    private readonly system: SystemStatusService,
    private readonly contexto: ContextEngineService,
  ) {}

  /**
   * Gatilho próprio, no servidor.
   *
   * Os invariantes eram disparados só pelo workspace-watcher do agent desktop.
   * Isso os torna cegos exatamente quando mais importam: com a máquina de
   * trabalho desligada. Em 2026-08-14 o relógio do servidor derrapou **8h43m** e
   * ninguém soube — o check pegaria com folga (limiar 120s), mas a última
   * execução era do dia anterior às 16:13, porque o watcher estava parado.
   *
   * Um sensor que só liga quando alguém está olhando não é sensor.
   */
  onModuleInit() {
    if (process.env.INVARIANTS_CYCLE_ENABLED === 'false') {
      this.logger.log('InvariantsService: ciclo do servidor desligado por env')
      return
    }

    // Warmup curto: só o suficiente para o Postgres e o V1 estarem de pé.
    const WARMUP_MS   = 2 * 60 * 1000
    const INTERVAL_MS = 30 * 60 * 1000

    this.warmupTimer = setTimeout(() => {
      void this.runForAllProjects()
      this.cycleTimer = setInterval(() => void this.runForAllProjects(), INTERVAL_MS)
    }, WARMUP_MS)

    this.logger.log('InvariantsService: ciclo de 30min agendado (primeira rodada em 2 min)')
  }

  onModuleDestroy() {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.cycleTimer)  clearInterval(this.cycleTimer)
  }

  /**
   * Varre os projetos do catálogo. Grava relatório só quando **há falha** ou
   * quando o último registro já passou de `HEARTBEAT_HORAS` — sem isso, 30 em 30
   * minutos, 9 projetos, seriam ~432 linhas/dia dizendo "tudo ok", e o histórico
   * deixaria de ser legível justo para quem quer achar quando algo quebrou.
   *
   * O heartbeat existe para o caso oposto: silêncio total é indistinguível de
   * "o ciclo morreu". Algumas linhas por dia provam que o sensor está vivo.
   */
  async runForAllProjects(): Promise<void> {
    // `beat` em `finally` — ver system-status.service.ts.
    let ok = false
    let erro: string | undefined
    let varridos = 0
    let gravados = 0
    let comFalha = 0
    let notificados = 0

    try {
    const projetos = await this.prisma.projectCatalog
      .findMany({ where: { archivedAt: null }, take: 10 })
      .catch((e) => { this.logger.warn(`Ciclo de invariantes: catálogo indisponível: ${e}`); return [] })

    for (const p of projetos) {
      try {
        // Contado ANTES do `continue`: "varridos" tem que significar avaliados, não
        // gravados. Na primeira rodada real o detalhe saiu `varridos: 0` com 8
        // projetos no catálogo — número honesto pelo nome errado, num recurso cuja
        // razão de existir é justamente não mentir sobre o que aconteceu.
        varridos++
        const { resultados, falhas, gravidadeMax, resumo } = await this.avaliar(p.v1ProjectId)

        const ultimo = await this.latest(p.v1ProjectId)
        const idadeH = ultimo ? (Date.now() - ultimo.createdAt.getTime()) / 3_600_000 : Infinity

        // ── Avisar so na TRANSICAO, e so gravidade alta ──────────────────────
        //
        // Ver `notificar-transicao.ts` para o porque das duas restricoes. Aqui e o unico lugar
        // que notifica: o `run()` manual NAO avisa, de proposito — quem roda a mao ja esta
        // olhando, e notificar ali encheria o Telegram durante qualquer depuracao.
        const anteriores = (ultimo?.resultados as unknown as InvariantResult[] | undefined) ?? null
        const transicao  = transicoesAltas(resultados, anteriores)
        const texto      = textoDaTransicao(transicao, p.v1ProjectId)
        if (texto) {
          notificados += transicao.quebraram.length + transicao.voltaram.length
          await enviarAoTelegram(texto)
        }

        // A mudanca de estado FORCA a gravacao. Sem isto, uma recuperacao (falhas = 0) cairia
        // no `continue` sem persistir, o relatorio anterior seguiria mostrando o problema, e o
        // ciclo seguinte anunciaria a mesma recuperacao de novo — para sempre.
        //
        // E a condicao aqui e `mudouAlgumEstado`, NAO `transicao` (que e so gravidade alta).
        // Usar a restricao do alerta para decidir a gravacao foi um erro meu, visivel na primeira
        // leitura real do /v2/system/panorama em 17/09: o conserto entrou as 21:44, o invariante
        // ficou verde, e o painel seguiu mostrando o problema porque a ultima linha gravada era de
        // 21:28 e nada forcou outra. A razao para restringir o ALERTA (nao treinar a ignorar) nao
        // e razao para restringir o REGISTRO, que precisa ser verdadeiro.
        const houveMudanca = mudouAlgumEstado(resultados, anteriores)
        if (falhas.length === 0 && idadeH < HEARTBEAT_HORAS && !houveMudanca) continue

        await this.prisma.invariantReport.create({
          data: {
            projectId:    p.v1ProjectId,
            totalOk:      resultados.length - falhas.length,
            totalFalha:   falhas.length,
            gravidadeMax,
            resumo,
            resultados:   resultados as unknown as object,
          },
        })

        if (falhas.length > 0) { this.logger.warn(`[ciclo] ${p.v1ProjectId}: ${resumo}`); comFalha++ }
        gravados++
      } catch (e) {
        this.logger.warn(`Ciclo de invariantes falhou para ${p.v1ProjectId}: ${e}`)
      }
    }
      ok = true
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`Ciclo de invariantes falhou: ${erro}`)
    } finally {
      await this.system.beat('invariants', { ok, erro, detalhe: { varridos, gravados, comFalha, notificados } })
    }
  }

  /**
   * Roda todos os checks. Um check que explode não derruba os outros — vira falha
   * própria, com o erro no detalhe. O objetivo é dar o retrato mais completo
   * possível, e um relatório parcial vale mais que exceção.
   */
  async run(projectId: string): Promise<InvariantRunResult> {
    const { resultados, falhas, gravidadeMax, resumo } = await this.avaliar(projectId)

    const report = await this.prisma.invariantReport.create({
      data: {
        projectId,
        totalOk:      resultados.length - falhas.length,
        totalFalha:   falhas.length,
        gravidadeMax,
        resumo,
        resultados:   resultados as unknown as object,
      },
    })

    if (falhas.length > 0) this.logger.warn(resumo)
    return { projectId, totalOk: report.totalOk, totalFalha: report.totalFalha, gravidadeMax, resumo, resultados, createdAt: report.createdAt }
  }

  /**
   * Roda os checks sem gravar nada.
   *
   * Separado de `run()` por causa do ciclo do servidor: ele roda a cada 30min e,
   * se persistisse sempre, encheria a tabela de relatórios idênticos dizendo
   * "tudo ok" — o mesmo ruído que a injeção de contexto evita ao ficar calada
   * quando está tudo bem. O ciclo decide gravar depois de ver o resultado.
   */
  private async avaliar(projectId: string) {
    const checks: Array<() => Promise<InvariantResult>> = [
      () => this.relogioSincronizado(),
      () => this.projetoAtivoNoCatalogo(),
      () => this.strategyComResultadoTemFitness(),
      () => this.gateAprovadoFoiAplicado(),
      () => this.hipoteseComTaskTypeValido(),
      () => this.benchmarkSetCoerente(),
      () => this.benchmarkCaseTemDono(),
      () => this.registroSemProjeto(),
      () => this.missaoNaoTravada(projectId),
      () => this.modelosLlmRespondem(),
      () => this.historicoServeConversa(),
      () => this.memoriaRelevanteServeUtil(projectId),
      () => this.migracoesAplicadas(),
      () => this.discoComFolga(),
      () => this.segredoNaoIndexado(),
      () => this.telegramResponde(),
      () => this.redisExigeSenha(),
      () => this.embeddingsRespondem(),
      () => this.hubRegistraConversa(),
    ]

    const resultados: InvariantResult[] = []
    for (const check of checks) {
      resultados.push(await check().catch((e) => this.falhaDeExecucao(e)))
    }

    const falhas       = resultados.filter((r) => !r.ok)
    const gravidadeMax = falhas.reduce<Gravidade | 'ok'>(
      (max, r) => (GRAVIDADE_ORDEM[r.gravidade] > GRAVIDADE_ORDEM[max] ? r.gravidade : max),
      'ok',
    )

    const resumo = falhas.length === 0
      ? `Todos os ${resultados.length} invariantes ok`
      : `${falhas.length} de ${resultados.length} invariantes quebrados (pior: ${gravidadeMax}) — ${falhas.map((f) => f.id).join(', ')}`

    return { resultados, falhas, gravidadeMax, resumo }
  }

  /**
   * ── A ligação HUB → Rayzen tem um modo de falha silencioso de cada lado ───
   *
   * Deste lado: `HUB_INGEST_TOKEN` divergindo entre o container da api e o do Hermes faz toda
   * ingestão virar 401, e o hook **desiste calado** — ele sai 0 de propósito, porque derrubar o
   * turno seria trocar "a conversa não é registrada" por "a conversa não acontece". É a mesma
   * história do `MCP_TOKEN_HERMES`, que existia no YAML e não no `.env`.
   *
   * Sonda com um corpo **sem `sessionId`** — no-op que não grava nada — e a distinção é
   * estrutural: 204 é rota viva com credencial certa, 401 é credencial divergente.
   *
   * **Limite declarado:** isto não verifica que o hook está registrado do lado do Hermes. Sem TTY
   * e sem consentimento ele é pulado em silêncio, e a `api-v2` não lê o `state.db` nem o allowlist
   * — essa metade se confere com `hermes hooks list`. Medir o que não se alcança seria pior.
   */
  private async hubRegistraConversa(): Promise<InvariantResult> {
    const base  = this.meta('hub_registra_conversa')
    const token = process.env.HUB_INGEST_TOKEN ?? ''
    if (!token) {
      return { ...base, ok: true, detalhe: 'Inconclusivo — HUB_INGEST_TOKEN não está no ambiente da api-v2' }
    }

    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    try {
      const res = await fetch(`${baseUrl}/sessions/ingest`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({}),
        signal:  AbortSignal.timeout(10_000),
      })

      if (res.status === 401) {
        return {
          ...base,
          ok:       false,
          detalhe:  'A ingestão do HUB recusou a credencial (401) — o hook do Hermes está descartando todo turno em silêncio',
          correcao: 'Conferir se HUB_INGEST_TOKEN é o MESMO no .env, no serviço `api` e no `docker-compose.hermes.yml`.',
        }
      }
      if (res.status >= 500) {
        return { ...base, ok: false, detalhe: `A rota de ingestão respondeu ${res.status}`, correcao: 'Ver o log da api V1.' }
      }
      return { ...base, ok: true, detalhe: `Ingestão do HUB de pé — sonda respondeu ${res.status}` }
    } catch (e) {
      // Sem status HTTP quem não respondeu foi a V1, e isso já tem sensor próprio.
      return { ...base, ok: true, detalhe: `Inconclusivo — /sessions/ingest não respondeu (${String(e).slice(0, 60)})` }
    }
  }

  async latest(projectId: string) {
    return this.prisma.invariantReport.findFirst({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async history(projectId: string, limit = 20) {
    return this.prisma.invariantReport.findMany({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })
  }

  /** Catálogo estático — permite a UI listar os invariantes antes da 1a execução. */
  catalogo() {
    return INVARIANTES
  }

  // ── Checks ───────────────────────────────────────────────────────────────────

  /**
   * Sonda de ponta a ponta: manda uma completion mínima em cada grupo do caminho
   * gratuito e vê se volta 200.
   *
   * Deliberadamente NÃO compara a lista de modelos declarados contra o catálogo do
   * provedor, que seria mais barato: essa versão só pegaria descontinuação. Uma
   * chamada real pega descontinuação, chave expirada, cota estourada, provedor fora
   * do ar e erro de rota do LiteLLM — todos com o mesmo sintoma em produção, que é
   * 500 no módulo que precisava do LLM.
   *
   * `max_tokens: 1` porque a resposta não importa; o que se mede é se a chamada
   * completa.
   */
  private async modelosLlmRespondem(): Promise<InvariantResult> {
    const base = this.meta('modelos_llm_respondem')

    if (this.sondaLlmCache && Date.now() - this.sondaLlmCache.em < SONDA_LLM_CACHE_MS) {
      return this.sondaLlmCache.resultado
    }

    const baseUrl   = (process.env.LITELLM_BASE_URL ?? 'http://litellm:4000/v1').replace(/\/$/, '')
    const masterKey = process.env.LITELLM_MASTER_KEY ?? ''

    /** `status` ausente = a requisição nem chegou a ter resposta HTTP. */
    const umaTentativa = async (grupo: string): Promise<{ grupo: string; ok: boolean; status?: number; erro?: string }> => {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterKey}` },
          body:    JSON.stringify({
            model:      grupo,
            messages:   [{ role: 'user', content: 'ok' }],
            max_tokens: 1,
            // Sem isto a sonda cai em `litellm-acompletion` como todo chamador anônimo —
            // e ela não é um chamador qualquer: rodando a cada 30min em 5 grupos, 24h por
            // dia, respondia por ~60% de TODAS as chamadas de LLM da plataforma. Medido em
            // 06/09: de madrugada, com ninguém trabalhando, o tráfego era exatamente os 5
            // grupos sondados, ~10 chamadas/hora, todas sem dono.
            //
            // O efeito não era só rastro sujo: as taxas de erro por grupo mediam
            // majoritariamente o SENSOR batendo em cota, não o trabalho real. Um baseline
            // de roteamento construído sobre isso decide a ordem da cadeia de fallback pelo
            // comportamento de quem só pergunta "você está vivo?".
            metadata: { trace_name: SONDA_LLM_TRACE, tags: ['invariants:sonda-llm'] },
          }),
          signal:  AbortSignal.timeout(20_000),
        })
        if (res.ok) return { grupo, ok: true, status: res.status }
        const corpo = await res.text().catch(() => '')
        return { grupo, ok: false, status: res.status, erro: `HTTP ${res.status} ${this.primeiraMensagem(corpo)}` }
      } catch (e) {
        return { grupo, ok: false, erro: e instanceof Error ? e.message : String(e) }
      }
    }

    /**
     * Sem status, tenta **uma** segunda vez. Não é retry por superstição: em 2026-08-22 o
     * `gpt-4o-mini` derrubou este invariante com "operation was aborted due to timeout"
     * enquanto um `curl` direto devolvia **429 em 400ms**.
     *
     * A causa é o próprio LiteLLM: ao levar 429 da Groq ele retenta com backoff, e isso
     * estoura os 20s daqui. Depois o grupo entra em cooldown e passa a responder 429 na
     * hora — que é o estado que a segunda tentativa encontra. Sem ela, **todo o tratamento
     * de 429 logo abaixo nunca roda**: a requisição morre antes de ter status, e um modelo
     * apenas ocupado é reportado como quebrado.
     *
     * Modelo de fato pendurado estoura as duas e continua sendo detectado. O custo é uma
     * chamada extra só no caminho que já falhou.
     */
    const sondar = async (grupo: string) => {
      const primeira = await umaTentativa(grupo)
      if (primeira.ok || primeira.status !== undefined) return primeira
      return umaTentativa(grupo)
    }

    const sondas = await Promise.all(GRUPOS_LLM_SONDADOS.map(sondar))

    // 429 é modelo OCUPADO, não modelo quebrado: vem com retry-after e se cura sozinho.
    // Medido na primeira semana do check — o free tier da Groq limita cota e o próprio
    // ciclo de invariantes contribui para estourá-la. Contar como falha transformaria
    // este invariante em vermelho recorrente, que é o que se aprende a ignorar (mesmo
    // princípio de `registro_sem_projeto` olhar só os últimos 7 dias).
    const limitados = sondas.filter((s) => s.status === 429)
    const quebrados = sondas.filter((s) => !s.ok && s.status !== 429)
    const nota = limitados.length
      ? ` (${limitados.map((l) => l.grupo).join(', ')} limitado(s) por cota agora — transitório, não contado como falha)`
      : ''

    // Se NENHUMA sonda chegou a ter resposta HTTP, quem não respondeu foi o LiteLLM —
    // acusar "modelo não responde" nesse caso seria culpar o provedor pelo que é falha
    // de rede local. A distinção é estrutural (houve status?), não por texto de erro:
    // mensagem de exceção varia por runtime e por versão do fetch.
    const semResposta = quebrados.length === sondas.length
      && quebrados.every((q) => q.status === undefined)
    if (semResposta) {
      return { ...base, ok: true, detalhe: `LiteLLM inacessível em ${baseUrl} — check inconclusivo, não contado como falha` }
    }

    const resultado: InvariantResult = quebrados.length === 0
      ? { ...base, ok: true, detalhe: `${sondas.length} grupo(s) responderam: ${sondas.map((s) => s.grupo).join(', ')}${nota}` }
      : {
          ...base,
          ok:       false,
          detalhe:  `${quebrados.length} de ${sondas.length} grupo(s) de LLM não respondem — ${quebrados.map((q) => `${q.grupo}: ${q.erro}`).join(' · ')}${nota}`,
          correcao: 'Conferir se o modelo ainda existe no provedor (GET https://api.groq.com/openai/v1/models) e corrigir infra/litellm/config.yaml. O litellm NÃO entra no webhook de build e config.yaml é bind mount de arquivo único: depois do git pull, docker compose up -d --force-recreate litellm',
        }

    // Falha cujo único indício é ausência de resposta NÃO entra no cache.
    //
    // Medido em 2026-08-22: o invariante ficou vermelho com "gpt-4o-mini: operation was
    // aborted due to timeout" enquanto uma sonda igual, rodada DENTRO do mesmo container,
    // devolvia **200 em 297ms** nos três grupos. Era um resultado guardado da sonda de
    // arranque, servido por 10 minutos depois de a causa ter passado.
    //
    // A distinção é a mesma do `semResposta` logo acima e a mesma do cache de contexto:
    // status HTTP é evidência, silêncio não é. Um 404 do provedor merece cache — não vai
    // mudar em dez minutos. Um timeout muda sozinho, e congelá-lo faz o erro durar ordens
    // de magnitude mais que a causa. Modelo de fato pendurado continua vermelho: a próxima
    // execução simplesmente sonda de novo e falha de novo.
    const soSilencio = quebrados.length > 0 && quebrados.every((q) => q.status === undefined)
    if (!soSilencio) this.sondaLlmCache = { em: Date.now(), resultado }
    return resultado
  }

  /** Primeira mensagem de erro de um corpo JSON, truncada — o resto é ruído. */
  private primeiraMensagem(corpo: string): string {
    const m = corpo.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    return (m ? m[1] : corpo).slice(0, 140)
  }

  /**
   * Não há relógio de referência dentro do container, mas toda resposta HTTP traz
   * um header `Date` gerado pelo servidor remoto. Comparar contra ele detecta deriva
   * grande sem depender de NTP nem de acesso ao systemd do host.
   */
  private async relogioSincronizado(): Promise<InvariantResult> {
    const base = this.meta('relogio_sincronizado')

    // Cache curto: o ciclo do servidor varre até 10 projetos por rodada e este é
    // o único check que sai para a rede. Sem isso seriam 10 requisições ao mesmo
    // serviço externo a cada 30min para responder uma pergunta que não é por
    // projeto — o relógio é um só. 60s é curto o bastante para não mascarar nada.
    if (this.relogioCache && Date.now() - this.relogioCache.em < 60_000) {
      return this.relogioCache.resultado
    }

    const res = await fetch('https://cloudflare.com/cdn-cgi/trace', {
      method: 'HEAD',
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)

    const header = res?.headers.get('date')
    if (!header) {
      // Não entra no cache: sem rede agora não quer dizer sem rede daqui a pouco,
      // e guardar um "inconclusivo" adiaria a detecção real por mais um minuto.
      return { ...base, ok: true, detalhe: 'Sem rede para comparar — check inconclusivo, não contado como falha' }
    }

    const remoto  = new Date(header).getTime()
    const local   = Date.now()
    const derivaS = Math.round(Math.abs(local - remoto) / 1000)

    const resultado: InvariantResult = derivaS <= DERIVA_MAX_SEGUNDOS
      ? { ...base, ok: true, detalhe: `Deriva de ${derivaS}s em relação ao horário da rede` }
      : {
          ...base,
          ok:       false,
          detalhe:  `Relógio do servidor está ${this.humanizarSegundos(derivaS)} fora do horário real (local ${new Date(local).toISOString()}, rede ${new Date(remoto).toISOString()})`,
          correcao: 'sudo timedatectl set-ntp true — e conferir a bateria CR2032 se a data se perder a cada boot',
        }

    this.relogioCache = { em: Date.now(), resultado }
    return resultado
  }

  private async projetoAtivoNoCatalogo(): Promise<InvariantResult> {
    const base = this.meta('projeto_ativo_no_catalogo')

    const [v1Projects, catalogo] = await Promise.all([
      this.bridge.listProjects(),
      this.prisma.projectCatalog.findMany({ where: { archivedAt: null }, select: { v1ProjectId: true } }),
    ])

    const registrados = new Set(catalogo.map((c) => c.v1ProjectId))
    const ausentes    = v1Projects.filter((p) => !registrados.has(p.id))

    if (ausentes.length === 0) {
      return { ...base, ok: true, detalhe: `${v1Projects.length} projeto(s) ativo(s), todos no catálogo` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  `${ausentes.length} de ${v1Projects.length} projeto(s) ativo(s) fora do project_catalog: ${ausentes.map((p) => p.name).join(', ')}`,
      correcao: `PUT /v2/catalog/<v1ProjectId> para cada um — sem isso o QA Scientist nunca os varre`,
    }
  }

  private async strategyComResultadoTemFitness(): Promise<InvariantResult> {
    const base = this.meta('strategy_com_resultado_tem_fitness')

    const semFitness = await this.prisma.strategy.findMany({
      where:  { fitnessScore: null },
      select: { id: true, taskType: true },
    })
    if (semFitness.length === 0) {
      return { ...base, ok: true, detalhe: 'Nenhuma estratégia com fitnessScore pendente' }
    }

    // Só é problema quando JÁ existe medição — estratégia recém-criada e nunca
    // avaliada tem null legitimamente.
    const comResultado: string[] = []
    for (const s of semFitness) {
      const n = await this.prisma.benchmarkResult.count({ where: { strategyId: s.id } })
      if (n > 0) comResultado.push(`${s.id.slice(0, 8)} (${s.taskType}, ${n} resultado(s))`)
    }

    if (comResultado.length === 0) {
      return { ...base, ok: true, detalhe: `${semFitness.length} estratégia(s) sem fitness, mas nenhuma foi avaliada ainda` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  `${comResultado.length} estratégia(s) têm BenchmarkResult mas fitnessScore null: ${comResultado.join(', ')}`,
      correcao: 'runForStrategy grava o fitness na origem desde 2026-08-13 — rodar POST /v2/benchmark/run para a estratégia recalcula e persiste',
    }
  }

  private async gateAprovadoFoiAplicado(): Promise<InvariantResult> {
    const base = this.meta('gate_aprovado_foi_aplicado')

    const aprovados = await this.prisma.approvalGate.findMany({
      where:  { type: 'strategy_promotion', status: 'approved' },
      select: { id: true, context: true },
    })
    if (aprovados.length === 0) {
      return { ...base, ok: true, detalhe: 'Nenhum gate de promoção aprovado' }
    }

    const naoAplicados: string[] = []
    for (const gate of aprovados) {
      const strategyId = (gate.context as { strategyId?: string } | null)?.strategyId
      if (!strategyId) continue
      const s = await this.prisma.strategy.findUnique({ where: { id: strategyId }, select: { promotedAt: true } })
      if (s && !s.promotedAt) naoAplicados.push(`gate ${gate.id.slice(0, 8)} → estratégia ${strategyId.slice(0, 8)}`)
    }

    if (naoAplicados.length === 0) {
      return { ...base, ok: true, detalhe: `${aprovados.length} gate(s) aprovado(s), todos aplicados` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  `${naoAplicados.length} gate(s) aprovado(s) sem efeito aplicado: ${naoAplicados.join(', ')}`,
      correcao: 'Aprovar agora dispara promote(); estes são anteriores à correção — reaplicar via POST /v2/evolutionary/promote/<strategyId>',
    }
  }

  private async hipoteseComTaskTypeValido(): Promise<InvariantResult> {
    const base = this.meta('hipotese_com_tasktype_valido')

    // Só hipóteses vivas. Uma rejeitada com taskType inválido é história — o dado
    // ruim já foi neutralizado, e mantê-la acusando falha faria o relatório nunca
    // ficar limpo por causa de algo que ninguém mais vai usar.
    const todas = await this.prisma.hypothesis.findMany({
      where:  { status: { notIn: ['rejected', 'resolved'] } },
      select: { id: true, taskType: true },
    })
    const invalidas = todas.filter(
      (h) => h.taskType !== null && h.taskType !== '' && !TASK_TYPES_VALIDOS.includes(h.taskType),
    )

    if (invalidas.length === 0) {
      return { ...base, ok: true, detalhe: `${todas.length} hipótese(s) ativa(s), todas com taskType válido ou nulo` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  `${invalidas.length} hipótese(s) com taskType inválido: ${[...new Set(invalidas.map((h) => `"${h.taskType}"`))].join(', ')}`,
      correcao: 'normalizeAnalysis já rejeita valores fora da lista; estas são anteriores — rejeitar via PATCH /v2/qa-scientist/hypotheses/<id>/reject',
    }
  }

  /**
   * Um conjunto que mistura formatos de saída não é benchmark: nenhum prompt pontua
   * bem nos dois ao mesmo tempo, e o fitness resultante mede a incoerência do
   * conjunto em vez da qualidade do prompt.
   */
  private async benchmarkSetCoerente(): Promise<InvariantResult> {
    const base = this.meta('benchmark_set_coerente')

    const casos = await this.prisma.benchmarkCase.findMany({ select: { taskType: true, expected: true } })
    if (casos.length === 0) {
      return { ...base, ok: true, detalhe: 'Nenhum caso de benchmark cadastrado' }
    }

    const ehJson = (s: string) => {
      const t = s.trim()
      return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
    }

    const misturados: string[] = []
    const porTipo = new Map<string, { json: number; texto: number }>()
    for (const c of casos) {
      const acc = porTipo.get(c.taskType) ?? { json: 0, texto: 0 }
      ehJson(c.expected) ? acc.json++ : acc.texto++
      porTipo.set(c.taskType, acc)
    }
    for (const [tipo, { json, texto }] of porTipo) {
      if (json > 0 && texto > 0) misturados.push(`${tipo} (${json} JSON, ${texto} texto)`)
    }

    if (misturados.length === 0) {
      return { ...base, ok: true, detalhe: `${porTipo.size} taskType(s), cada um com formato de saída único` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  `taskType(s) misturando formatos de saída: ${misturados.join(', ')}`,
      correcao: 'Separar por formato ou padronizar o conjunto — enquanto misturar, o fitness não mede qualidade de prompt',
    }
  }

  /**
   * Desde que o escopo do QA Scientist virou estrito (só casos do próprio projeto),
   * um caso órfão não é coletado por ninguém — some do sistema sem avisar. Este
   * check existe para que o silêncio seja reportado em vez de aceito.
   */
  private async benchmarkCaseTemDono(): Promise<InvariantResult> {
    const base = this.meta('benchmark_case_tem_dono')

    const orfaos = await this.prisma.benchmarkCase.groupBy({
      by:    ['taskType'],
      where: { projectId: null },
      _count: { _all: true },
    })

    if (orfaos.length === 0) {
      return { ...base, ok: true, detalhe: 'Todos os casos de benchmark têm projeto dono' }
    }
    const total = orfaos.reduce((s, o) => s + o._count._all, 0)
    return {
      ...base,
      ok:       false,
      detalhe:  `${total} caso(s) sem projeto dono: ${orfaos.map((o) => `${o.taskType} (${o._count._all})`).join(', ')} — nenhum projeto os coleta`,
      correcao: 'UPDATE v2.benchmark_cases SET project_id = <dono> WHERE project_id IS NULL',
    }
  }

  private async missaoNaoTravada(projectId: string): Promise<InvariantResult> {
    const base   = this.meta('missao_nao_travada')
    const limite = new Date(Date.now() - MISSAO_TRAVADA_DIAS * 24 * 60 * 60 * 1000)

    const travadas = await this.prisma.mission.findMany({
      where:  { projectId, status: 'active', updatedAt: { lt: limite } },
      select: { id: true, title: true, updatedAt: true },
    })

    if (travadas.length === 0) {
      return { ...base, ok: true, detalhe: `Nenhuma missão ativa parada há mais de ${MISSAO_TRAVADA_DIAS} dias` }
    }
    return {
      ...base,
      ok:       false,
      detalhe:  travadas.map((m) => `"${m.title}" sem avanço desde ${m.updatedAt.toISOString().slice(0, 10)}`).join('; '),
      correcao: 'Concluir ou cancelar — missão ativa entra no contexto injetado de toda sessão e compete com o trabalho real',
    }
  }

  /**
   * Registro novo sem projeto dono.
   *
   * Olha só a **janela recente** de propósito. Havia 236 eventos órfãos acumulados
   * desde maio: falhar por causa deles deixaria o check vermelho para sempre, e
   * check permanentemente vermelho é check que se aprende a ignorar — o mesmo motivo
   * pelo qual o contexto injetado fica calado quando está tudo certo.
   *
   * O passivo histórico não some do relatório: entra no `detalhe` como número, sem
   * derrubar o check.
   */
  private async registroSemProjeto(): Promise<InvariantResult> {
    const base  = this.meta('registro_sem_projeto')
    const desde = new Date(Date.now() - ORFAO_JANELA_DIAS * 86_400_000)

    const { eventos, eventosRecentes, documentos, documentosRecentes } =
      await this.bridge.registrosSemProjeto(desde)

    const passivo = eventos + documentos
    const recente = eventosRecentes + documentosRecentes
    const historico = passivo > 0 ? ` (passivo histórico: ${eventos} evento(s) e ${documentos} documento(s))` : ''

    if (recente === 0) {
      return {
        ...base,
        ok:      true,
        detalhe: `Nenhum registro órfão nos últimos ${ORFAO_JANELA_DIAS} dias${historico}`,
      }
    }

    const partes = [
      eventosRecentes    > 0 ? `${eventosRecentes} evento(s)`    : '',
      documentosRecentes > 0 ? `${documentosRecentes} documento(s)` : '',
    ].filter(Boolean).join(' e ')

    return {
      ...base,
      ok:       false,
      detalhe:  `${partes} gravados sem projeto nos últimos ${ORFAO_JANELA_DIAS} dias${historico} — invisíveis para qualquer consulta com escopo de projeto`,
      correcao: 'A resolução é pelo cwd do processo, então trabalho fora de um repositório registrado nasce órfão — em 2026-08-16 a maioria vinha de editar arquivos em ~/.claude, que não é repo git. Se for repo de projeto: conferir GET /events/hook/health e se o repoSlug existe no Rayzen. Nunca fixar projectId no hook.config.mjs — ele é compartilhado por todos os projetos',
    }
  }

  /**
   * Sonda o endpoint REAL, não o banco — segundo check a olhar para fora, junto com
   * `modelos_llm_respondem`.
   *
   * A tentação era medir a composição de `conversation_messages` direto. Não serve:
   * a telemetria continua dominando a tabela **por desenho** (4.459 sessões contra 210),
   * e o histórico funciona porque o `SessionService` filtra na leitura. Um check sobre a
   * tabela crua ficaria vermelho para sempre com o sistema são — e vermelho permanente é
   * o que se aprende a ignorar.
   *
   * Replicar a query do `SessionService` aqui seria pior ainda: viraria o
   * "Invariante 1 — Documentos sempre têm projectId" do contrato da V1, que testa uma
   * cópia local e passou verde com 236 órfãos no banco. Enunciado sem sensor.
   *
   * Então a pergunta é feita a quem responde ao usuário: **o que `GET /sessions`
   * devolve?** Se o filtro for removido, invertido ou contornado por outro caminho, o
   * título volta a ser o fallback genérico e o número aqui muda.
   */
  private async historicoServeConversa(): Promise<InvariantResult> {
    const base    = this.meta('historico_serve_conversa')
    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const token   = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''

    let servidas: Array<{ title?: string }>
    try {
      const res = await fetch(`${baseUrl}/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        return {
          ...base,
          ok:       false,
          detalhe:  `GET /sessions respondeu ${res.status} — o histórico não está sendo servido`,
          correcao: 'Conferir se a API V1 está de pé e se V1_API_TOKEN/AGENT_TOKEN continua válido.',
        }
      }
      servidas = await res.json() as Array<{ title?: string }>
    } catch (e) {
      // Sem resposta HTTP quem não respondeu foi a rede local, não o histórico.
      // Mesma distinção estrutural de `modelos_llm_respondem`: houve status?
      return { ...base, ok: true, detalhe: `Inconclusivo — /sessions não respondeu (${String(e).slice(0, 80)})` }
    }

    // Instalação nova não tem conversa. Ausência de dado não é defeito.
    if (!Array.isArray(servidas) || servidas.length === 0) {
      return { ...base, ok: true, detalhe: 'Nenhuma conversa registrada ainda' }
    }

    // ── O critério é a VARIEDADE, não uma string conhecida (corrigido 18/09) ──
    //
    // Isto contava títulos iguais a `TITULO_FALLBACK` ("Conversa"), que era o sintoma exato de
    // 19/08. Em 18/09 o histórico voltou a ser 100% telemetria — **20 de 20 linhas "sonda de
    // embeddings"**, criadas pelo invariante `embeddings_respondem` deste mesmo arquivo — e este
    // check respondeu *"20 das 20 são conversa real"*: verde, e errado.
    //
    // Um sensor que procura a string de ontem só pega o defeito de ontem. O que define telemetria
    // não é o texto, é **a repetição**: vinte linhas idênticas não são vinte conversas, qualquer
    // que seja o título. Contar distintos generaliza os dois casos e os próximos.
    const titulos   = servidas.map((s) => (s.title ?? '').trim())
    const distintos = new Set(titulos).size
    const genericas = titulos.filter((t) => t === TITULO_FALLBACK).length

    // Um título para tudo, com mais de duas entradas — abaixo disso é histórico curto, não defeito.
    if (distintos === 1 && servidas.length > 2) {
      const unico = titulos[0] || TITULO_FALLBACK
      return {
        ...base,
        ok:       false,
        detalhe:  `As ${servidas.length} entradas do histórico têm o MESMO título ("${unico.slice(0, 40)}") — é telemetria ocupando a janela, não conversa`,
        correcao: 'Duas causas conhecidas, e as duas já aconteceram: (1) getRecentSessions() sem filtro de role=user ANTES do corte — 19/08, 4.459 sessões de telemetria contra 210 reais; (2) um sensor que conversa para medir e não se declara — 18/09, a sonda de embeddings criando uma sessão a cada 10min. Sensor que busca no Brain precisa mandar sessionId com o prefixo `sonda:` (ver apps/api/src/modules/session/sonda-de-sensor.const.ts).',
      }
    }

    if (genericas === servidas.length) {
      return {
        ...base,
        ok:       false,
        detalhe:  `As ${servidas.length} entradas do histórico têm o título genérico "${TITULO_FALLBACK}" — nenhuma é conversa de verdade`,
        correcao: 'getRecentSessions() (apps/api) precisa filtrar por sessões com role=user ANTES do corte. Sem isso a telemetria (documentation, synthesis, project-state, graph) domina a janela: em 2026-08-19 eram 4.459 sessões de telemetria contra 210 reais, e a primeira conversa caía na posição 661 de um corte em 20.',
      }
    }

    return {
      ...base,
      ok:      true,
      detalhe: `${servidas.length - genericas} das ${servidas.length} entradas do histórico são conversa real (${distintos} títulos distintos)`,
    }
  }

  /**
   * Olha o que a maior seção do contexto **serviu**, não o acervo inteiro.
   *
   * A escolha é a mesma do `historico_serve_conversa` e pelo mesmo motivo. Medir o
   * corpus daria vermelho permanente enquanto sobrasse qualquer lixo histórico, e
   * vermelho permanente é o que se aprende a ignorar. A pergunta que importa é mais
   * estreita: **isto chegou ao prompt?**
   *
   * Chama `diagnosticarMemoria()`, que é a mesma seleção que monta a seção — não uma
   * réplica dos parâmetros. Mudar o piso, o limite ou o boost por modo muda o que este
   * check enxerga automaticamente.
   *
   * Duas famílias de lixo, ambas com falha real atrás:
   *
   * - **arquivo de outro repositório** — 194 documentos do Commerce, banco-imob e VB
   *   Ferragens estavam indexados dentro do Rayzen AI (2026-08-22). A busca é escopada
   *   por projectId e não acusava nada: os documentos estavam no projeto, só não eram
   *   dele. O `sourcePath` é o único sinal observável.
   * - **arquivo gerado** — lockfile, `node_modules`, build. Em 2026-08-17 dois dos cinco
   *   trechos servidos ao banco-imob eram `pnpm-lock.yaml`.
   *
   * Consulta fixa de propósito: o check precisa ser comparável entre execuções. Não
   * afirma que o resultado é *bom* — afirma que não é lixo, que é o que dá para checar
   * mecanicamente.
   */
  /**
   * Credencial indexada no Brain.
   *
   * Em 2026-09-10 o `hook.config.mjs` estava no acervo e a busca semântica o serviu
   * **com o `AGENT_TOKEN` completo em texto claro** dentro do `memory_relevant` de uma
   * sessão real — um dia depois de o arquivo ter sido fechado por ACL. Proteger o objeto
   * não protege a cópia que já saiu dele.
   *
   * **Por que olha o acervo inteiro, e não o que foi servido.** O vizinho
   * `memoria_relevante_serve_util` sonda com uma consulta fixa de propósito: lixo degrada
   * a qualidade na proporção em que aparece, então só incomoda quando chega a ser servido.
   * Credencial não funciona assim — ela é perigo igual na consulta em que não apareceu,
   * bastando a próxima casar. A pergunta aqui é "existe?", não "foi servido?".
   *
   * **Nunca lê `content`.** Só o `sourcePath` é carregado. O sensor não precisa ver o que
   * denuncia, e puxar o conteúdo o espalharia por mais um processo, mais um log e mais uma
   * mensagem de erro — que é como o segredo se multiplica.
   *
   * Sem escopo de projeto: segredo indexado sob o dono errado continua sendo segredo
   * indexado, e em 2026-08-22 mediu-se que 194 documentos estavam sob o projeto errado.
   */

  /**
   * ── O canal do Telegram consegue responder texto livre? ──────────────────────
   *
   * Até 14/09 a resposta era **não, e nunca tinha sido sim**. `orchestrate()` lia
   * `TELEGRAM_API_TOKEN` com `?? ''`, e essa variável não existia em lugar nenhum — nem no
   * `.env`, nem no compose, nem no container. Todo texto livre saía com `Bearer ` vazio, tomava
   * 401 e virava "erro ao processar mensagem".
   *
   * Passou meses assim porque os **comandos** funcionavam (não passam pelo orquestrador), o
   * processo subia saudável, o long-polling logava "started" e o painel ficava verde. Canal
   * quebrado com tudo reportando sucesso — o critério de entrada deste catálogo.
   *
   * **Sonda o diagnóstico, não o caminho completo**, e a escolha é deliberada: `GET
   * /infra/telegram` responde sem enviar mensagem, sem criar conversa e sem gastar LLM. Sondar
   * `POST /orchestrate` de verdade pagaria uma conversa a cada 30 minutos — e sensor caro é
   * sensor que alguém desliga, como o `modelos_llm_respondem` já resolveu com `max_tokens: 1`.
   *
   * Falha SEM status HTTP é **inconclusiva**, não falha: quem não respondeu foi a rede local
   * entre os containers. Mesma distinção estrutural de `modelos_llm_respondem` e
   * `historico_serve_conversa` — houve status?
   */
  private async telegramResponde(): Promise<InvariantResult> {
    const base    = this.meta('telegram_responde')
    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const token   = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''

    let d: {
      ok: boolean
      botConfigurado: boolean
      pollingAtivo: boolean
      credencialOrquestrador: 'ok' | 'ausente'
      chatsAutorizados: number
      chatsSemProjeto: number
      detalhe: string
    }

    try {
      const res = await fetch(`${baseUrl}/infra/telegram`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        return {
          ...base,
          ok:       false,
          detalhe:  `GET /infra/telegram respondeu ${res.status} — não dá para afirmar que o canal responde`,
          correcao: 'Conferir se a API V1 está de pé e se V1_API_TOKEN/AGENT_TOKEN continua válido.',
        }
      }
      d = await res.json() as typeof d
    } catch (e) {
      return { ...base, ok: true, detalhe: `Inconclusivo — /infra/telegram não respondeu (${String(e).slice(0, 80)})` }
    }

    // Bot não configurado não é defeito: é instalação que não usa o canal. Derrubar aqui deixaria
    // o invariante vermelho para sempre em qualquer ambiente sem Telegram.
    if (!d.botConfigurado) {
      return { ...base, ok: true, detalhe: 'Telegram não configurado neste ambiente' }
    }

    if (!d.ok) {
      return {
        ...base,
        ok:       false,
        detalhe:  d.detalhe,
        correcao: d.credencialOrquestrador === 'ausente'
          ? 'Definir TELEGRAM_API_TOKEN ou AGENT_TOKEN no ambiente da api — sem um dos dois, todo texto livre responde 401.'
          : 'Conferir TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID e se o long-polling subiu (log da api: "Telegram long-polling started").',
      }
    }

    const notas = [`${d.chatsAutorizados} chat(s) autorizado(s)`]
    if (d.chatsSemProjeto > 0) notas.push(`${d.chatsSemProjeto} sem projeto vinculado`)
    return { ...base, ok: true, detalhe: `Canal pronto — ${notas.join(', ')}` }
  }

  private async segredoNaoIndexado(): Promise<InvariantResult> {
    const base = this.meta('segredo_nao_indexado')

    let caminhos: Array<{ id: string; projectId: string | null; sourcePath: string | null }>
    try {
      caminhos = await this.bridge.listarCaminhosIndexados()
    } catch (e) {
      // Não conseguir LER o acervo não é o mesmo que o acervo estar limpo. Mesma
      // distinção estrutural de `modelos_llm_respondem` e `historico_serve_conversa`.
      return { ...base, ok: true, detalhe: `Inconclusivo — não foi possível ler os caminhos indexados (${String(e).slice(0, 80)})` }
    }

    if (caminhos.length === 0) {
      return { ...base, ok: true, detalhe: 'Nenhum documento com sourcePath no acervo' }
    }

    const suspeitos = caminhos.filter((d) => ehCaminhoDeSegredo(d.sourcePath))

    if (suspeitos.length === 0) {
      return { ...base, ok: true, detalhe: `Nenhum dos ${caminhos.length} caminhos indexados aparenta carregar credencial` }
    }

    const exemplos = suspeitos.slice(0, 3).map((d) => nomeDoArquivo(d.sourcePath)).join(', ')

    return {
      ...base,
      ok:       false,
      detalhe:  `${suspeitos.length} de ${caminhos.length} caminho(s) indexado(s) aparentam carregar credencial (${exemplos})`,
      correcao: 'Apagar os documentos por id (DELETE /memory/documents/:id) e ROTACIONAR a credencial: se ela foi servida em algum contexto injetado, já circulou. Preservar os `.example`, que são template sem segredo. A prevenção fica em `indexable-path.const.ts` (V1) — se o arquivo entrou depois dela existir, o padrão não cobriu o caso e é ele que precisa mudar.',
    }
  }

  private async memoriaRelevanteServeUtil(projectId: string): Promise<InvariantResult> {
    const base = this.meta('memoria_relevante_serve_util')

    const projeto = await this.bridge.getProject(projectId).catch(() => null)
    const slug    = projeto?.repoSlug ?? null

    let servidos: Array<{ sourcePath?: string | null }>
    try {
      servidos = await this.contexto.diagnosticarMemoria({
        projectId,
        query: CONSULTA_SONDA_MEMORIA,
        mode:  'implementation',
      })
    } catch (e) {
      // Falhar aqui é falha da BUSCA, não da qualidade do que ela serve. Mesma
      // distinção estrutural de `modelos_llm_respondem`: houve resposta?
      return { ...base, ok: true, detalhe: `Inconclusivo — a busca de memória não respondeu (${String(e).slice(0, 80)})` }
    }

    // Projeto sem acervo, ou nada acima do piso. Ausência não é defeito — é o próprio
    // desenho da seção, que fica calada em vez de servir o menos ruim.
    if (servidos.length === 0) {
      return { ...base, ok: true, detalhe: 'Nada acima do piso de relevância para a consulta-sonda — a seção fica calada, como deve' }
    }

    const gerados = servidos.filter((r) => ehArquivoGerado(r.sourcePath))
    const alheios = slug ? servidos.filter((r) => !ehArquivoGerado(r.sourcePath) && ehDeOutroRepo(r.sourcePath, slug)) : []

    if (gerados.length === 0 && alheios.length === 0) {
      return {
        ...base,
        ok:      true,
        detalhe: `Os ${servidos.length} trechos servidos são do projeto e nenhum é arquivo gerado`,
      }
    }

    const partes = [
      gerados.length ? `${gerados.length} arquivo(s) gerado(s)` : '',
      alheios.length ? `${alheios.length} de outro repositório` : '',
    ].filter(Boolean).join(' e ')

    const exemplos = [...gerados, ...alheios]
      .slice(0, 3)
      .map((r) => nomeDoArquivo(r.sourcePath))
      .join(', ')

    return {
      ...base,
      ok:       false,
      detalhe:  `${partes} entre os ${servidos.length} trechos injetados (${exemplos})`,
      correcao: alheios.length
        ? 'Documento de outro repositório dentro deste projeto é erro de INDEXAÇÃO, não de busca — a consulta é escopada por projectId e não tem como filtrar. Conferir de onde veio (o hook resolve o projeto pelo cwd; conector sem projectId cai no default) e reatribuir por source_path, não apagar: em 2026-08-22, 167 dos 194 só existiam sob o dono errado.'
        : 'Arquivo gerado não deveria ser indexado. Conferir o filtro de ingestão do Brain — lockfile, node_modules e build não são conhecimento, e ocupam slot de trecho útil.',
    }
  }


  /**
   * ── A porta está trancada, ou só o arquivo diz que deveria estar? ────────────
   *
   * Medido em 16/09, de dentro do container do Hermes e **sem credencial nenhuma**:
   *
   *     PING          -> +PONG
   *     SCAN bull:*   -> bull:agent-tasks:<uuid> ... (31 chaves)
   *
   * `bull:agent-tasks` é a fila que o agent **desktop** reivindica e executa na máquina do
   * Marcelo. Quem alcança o Redis sem senha pode enfileirar um job — e isso contorna inteiramente
   * o escopo somente-leitura do `MCP_TOKEN_HERMES`.
   *
   * O furo existia desde que o Hermes entrou na rede compartilhada, e **nenhum sensor perguntava
   * isso**: `infra_health` conferia se o Redis RESPONDE, que era exatamente o sintoma de estar
   * aberto.
   *
   * ── Socket cru, não leitura de configuração ─────────────────────────────────
   *
   * A pergunta é *"a porta está trancada?"*, não *"o compose diz que deveria estar?"*. Ler
   * `REDIS_PASSWORD` provaria que alguém escreveu a senha; mandar `PING` prova que o Redis a
   * exige. Mesma escolha do `historico_serve_conversa`, que sonda o endpoint e não o banco.
   *
   * Socket TCP direto em vez de um cliente Redis: a api-v2 não tem — e não precisa ter — nenhuma
   * dependência de Redis. Um `PING` em texto puro basta para a resposta que importa.
   */
  /** Resultado da sonda de embeddings, compartilhado entre projetos do mesmo ciclo. */
  private static cacheEmbeddings: { quando: number; resultado: { ok: boolean; detalhe: string; correcao?: string } } | null = null

  private async redisExigeSenha(): Promise<InvariantResult> {
    const base = this.meta('redis_exige_senha')

    const url = process.env.REDIS_URL ?? 'redis://redis:6379'
    let host = 'redis'
    let porta = 6379
    try {
      const u = new URL(url)
      host = u.hostname || host
      porta = u.port ? Number(u.port) : 6379
    } catch {
      // URL malformada: cai no padrão da rede interna em vez de derrubar o check.
    }

    let resposta: string
    try {
      resposta = await pingRedisCru(host, porta)
    } catch (e) {
      // Não conseguir conectar não prova nada sobre a senha — pode ser a rede, o container
      // reiniciando, o DNS interno. Sensor que não consegue medir nunca condena nem absolve.
      return {
        ...base,
        ok: true,
        detalhe: `Inconclusivo — não foi possível abrir socket para ${host}:${porta} (${String(e).slice(0, 60)})`,
      }
    }

    if (resposta.startsWith('-NOAUTH')) {
      return { ...base, ok: true, detalhe: `${host}:${porta} exige autenticação` }
    }

    if (resposta.startsWith('+PONG')) {
      return {
        ...base,
        ok: false,
        detalhe:
          `${host}:${porta} respondeu +PONG SEM autenticação — qualquer container da rede pode ler e ` +
          'ESCREVER na fila bull:agent-tasks, que o agent desktop executa na máquina do Marcelo',
        correcao:
          'Definir REDIS_PASSWORD no .env (o compose já tem a expansão condicional) e recriar `redis` e ' +
          '`api` juntos. Conferir depois: `docker exec rayzen-ai-redis-1 redis-cli ping` deve responder NOAUTH.',
      }
    }

    // Resposta que não se sabe ler: não afirmar nem inocentar.
    return { ...base, ok: true, detalhe: `Inconclusivo — resposta inesperada ao PING: ${resposta.slice(0, 40)}` }
  }

  /**
   * ── Dependência de terceiro some sem avisar, e embeddings não são LLM ───────
   *
   * Em 17/09 a conta da Jina ficou sem saldo — `HTTP 403 AUTHZ_INSUFFICIENT_BALANCE`. Embeddings
   * alimentam indexação **e** busca, então a memória semântica inteira saiu do ar: `/memory/search`
   * passou a devolver 500, o `memory_relevant` sumiu do contexto e o context-engine da V2 começou
   * a falhar.
   *
   * **Nada acusou.** Foi descoberto por acaso, investigando um deploy que falhara por outro motivo
   * no dia anterior. É a mesma história que criou o `modelos_llm_respondem` quando a Groq
   * descontinuou dois modelos e toda chamada virou 500 com o painel verde.
   *
   * E aquele check **não cobre isto**: LLM e embeddings são provedor diferente, conta diferente,
   * saldo diferente. Um pode estar de pé com o outro no chão — foi exatamente o que aconteceu.
   *
   * ── Sonda o caminho do usuário, não o fornecedor ────────────────────────────
   *
   * `POST /memory/search` na V1 em vez de chamar a Jina direto: testa embed + pgvector, que é o
   * caminho real, e não exige a chave da Jina dentro da api-v2. Cache de 10min porque o ciclo
   * varre até 10 projetos por rodada e a pergunta não é por projeto — mesma razão do check de LLM.
   */
  private async embeddingsRespondem(): Promise<InvariantResult> {
    const base = this.meta('embeddings_respondem')

    const cacheado = InvariantsService.cacheEmbeddings
    if (cacheado && Date.now() - cacheado.quando < 600_000) return { ...base, ...cacheado.resultado }

    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const token = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''

    let parcial: { ok: boolean; detalhe: string; correcao?: string }
    try {
      const res = await fetch(`${baseUrl}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // `sessionId` fixo e declarado: `POST /memory/search` PERSISTE toda busca como par
        // user/assistant em `conversation_messages`, e sem id esta sonda criava uma sessão nova a
        // cada ~10 min — 55 em um dia, ocupando **20 de 20** linhas do histórico (medido 18/09).
        // O prefixo `sonda:` é o que a V1 usa para não confundir sensor com conversa; ver
        // `apps/api/src/modules/session/sonda-de-sensor.const.ts`.
        body: JSON.stringify({ query: 'sonda de embeddings', limit: 1, sessionId: 'sonda:embeddings' }),
        signal: AbortSignal.timeout(20_000),
      })

      parcial = res.ok
        ? { ok: true, detalhe: 'Busca semântica respondeu — embeddings de pé' }
        : {
            ok: false,
            detalhe: `POST /memory/search respondeu ${res.status} — a memória semântica não consegue buscar nem indexar`,
            correcao:
              'Conferir saldo e validade da JINA_API_KEY em jina.ai/api-dashboard/key-manager — em 17/09 era ' +
              '403 AUTHZ_INSUFFICIENT_BALANCE. Embeddings e LLM são contas diferentes: o modelos_llm_respondem ' +
              'pode estar verde com este vermelho.',
          }
    } catch (e) {
      // Sem status HTTP não houve resposta: quem não respondeu foi a rede local até a api V1.
      // Mesma distinção estrutural de `modelos_llm_respondem` — houve status?
      parcial = { ok: true, detalhe: `Inconclusivo — /memory/search não respondeu (${String(e).slice(0, 60)})` }
    }

    InvariantsService.cacheEmbeddings = { quando: Date.now(), resultado: parcial }
    return { ...base, ...parcial }
  }

  /**
   * Disco da partição raiz, medido de dentro do container.
   *
   * O container compartilha a raiz do host — verificado em 2026-09-05: `df /` devolve
   * `110G / 40G / 39%` dentro do `api-v2` e no host, os mesmos números. Então não é
   * preciso privilégio nem socket do Docker para responder a pergunta que importa.
   *
   * O que ele NÃO faz: dizer o que está ocupando. De dentro do container não dá para
   * rodar `docker system df`. O `correcao` carrega o comando; o check carrega o número.
   *
   * Limiar em 85%: acima disso ainda sobram ~16 GB, que é folga para agir sem pressa.
   * Alertar antes de doer é o ponto — quando o build começa a falhar, já é tarde.
   */
  private async discoComFolga(): Promise<InvariantResult> {
    const base = this.meta('disco_com_folga')

    let st: { blocks: number; bsize: number; bavail: number }
    try {
      st = await statfs('/')
    } catch (e) {
      // Sem leitura do filesystem não se sabe — e não saber não é estar errado.
      return { ...base, ok: true, detalhe: `Inconclusivo — não foi possível ler o filesystem (${String(e).slice(0, 60)})` }
    }

    const total = st.blocks * st.bsize
    const livre = st.bavail * st.bsize
    if (!total) return { ...base, ok: true, detalhe: 'Inconclusivo — filesystem reportou tamanho zero' }

    const usadoPct = Math.round(((total - livre) / total) * 100)
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`
    const medida = `${usadoPct}% usado — ${gb(livre)} livres de ${gb(total)}`

    if (usadoPct < DISCO_LIMIAR_PCT) {
      return { ...base, ok: true, detalhe: medida }
    }

    // O comando que de fato recupera, medido em 16/09: `prune -af` liberou **66,95 GB** num disco
    // que estava em 100%. O conselho anterior aqui era `--keep-storage 10GB`, e é parte da
    // história do incidente: `--keep-storage`/`--reserved-space` é o mínimo que a poda SEMPRE
    // PRESERVA, não o teto do cache. Seguir essa correção liberava pouco e confirmava a leitura
    // errada de que não havia mais o que liberar.
    const comoRecuperar =
      'O maior consumidor costuma ser o build cache do Docker, não dado do Rayzen — os dois bancos ' +
      'somam 417 MB. Medir com `docker system df` e recuperar com `docker builder prune -af`. ' +
      'ATENÇÃO: `--keep-storage`/`--reserved-space` é o MÍNIMO que a poda preserva, não o teto do ' +
      'cache; usá-los libera pouco e faz parecer que não há mais o que liberar — foi o que causou ' +
      'o apagão de 16/09, e um `prune -af` recuperou 66,95 GB logo depois. Se o cache não for o ' +
      'culpado: `docker image prune -f`, o tamanho de `v2.invariant_reports` (~268 linhas/dia) e ' +
      'os logs dos containers.'

    if (usadoPct >= DISCO_LIMIAR_CRITICO_PCT) {
      return {
        ...base,
        ok:       false,
        detalhe:  `CRÍTICO — ${medida}. Em 100% o Postgres não consegue escrever o checkpoint e entra em laço de PANIC ` +
                  '("No space left on device"), sem conseguir nem terminar a própria recuperação — foi o que derrubou ' +
                  'a plataforma em 16/09. Um build frio consome mais que a folga restante.',
        correcao: `AGORA: ${comoRecuperar}`,
      }
    }

    return {
      ...base,
      ok:       false,
      detalhe:  `${medida} (limiar ${DISCO_LIMIAR_PCT}%)`,
      correcao: comoRecuperar,
    }
  }

  /**
   * Compara o diretório de migrações com o que o banco registra como aplicado.
   *
   * Parece contabilidade e não é. Em 2026-08-22 o `policy_exceptions` estava 53 dias sem
   * aplicar, e a consequência era `POST /v2/policy/evaluate` devolvendo 500 — o motor de
   * política inteiro morto, com todo painel verde.
   *
   * O detalhe que torna o check necessário: na V2, `migrate deploy` **nunca roda** (o
   * schema vem de `db push`), então a migração que nunca aplicou não deixa rastro algum
   * em `_prisma_migrations`. Não há linha de erro para consultar. A única evidência é o
   * diretório ter um nome que o banco não conhece.
   *
   * Só olha numa direção. Migração aplicada que sumiu do diretório é normal — squash,
   * histórico reescrito — e falhar por isso deixaria o check vermelho para sempre por
   * causa de coisa antiga: a V1 tem 37 linhas aplicadas para 25 diretórios.
   */
  private async migracoesAplicadas(): Promise<InvariantResult> {
    const base = this.meta('migracoes_aplicadas')

    const raiz = raizDoRepo(__dirname, (p) => existsSync(p))
    if (!raiz) {
      // Não achar o diretório é não saber, não é saber que está errado — mesma distinção
      // estrutural de `modelos_llm_respondem` e `historico_serve_conversa`.
      return { ...base, ok: true, detalhe: 'Inconclusivo — diretório de migrações não encontrado a partir do build' }
    }

    const faltando: string[] = []
    const travadas: string[] = []
    let total = 0

    for (const { schema, dir } of MIGRACOES_POR_SCHEMA) {
      const caminho = join(raiz, ...dir)
      if (!existsSync(caminho)) continue

      const noDisco = readdirSync(caminho, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      total += noDisco.length

      // `schema` vem da const acima, nunca de entrada externa.
      const linhas = await this.prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
        `SELECT migration_name, finished_at, rolled_back_at FROM "${schema}"."_prisma_migrations"`,
      )

      const aplicadas = new Set(
        linhas.filter((l) => l.finished_at !== null && l.rolled_back_at === null).map((l) => l.migration_name),
      )
      for (const nome of noDisco) if (!aplicadas.has(nome)) faltando.push(`${schema}/${nome}`)

      // Começou e nunca terminou, sem rollback: o `migrate deploy` morreu no meio e o
      // banco ficou num estado que ninguém declarou.
      for (const l of linhas) {
        if (l.finished_at === null && l.rolled_back_at === null && !aplicadas.has(l.migration_name)) {
          travadas.push(`${schema}/${l.migration_name}`)
        }
      }
    }

    if (!faltando.length && !travadas.length) {
      return { ...base, ok: true, detalhe: `${total} migração(ões) do repositório aplicadas nos ${MIGRACOES_POR_SCHEMA.length} schemas` }
    }

    const partes = [
      faltando.length ? `${faltando.length} nunca aplicada(s): ${faltando.slice(0, 4).join(', ')}` : '',
      travadas.length ? `${travadas.length} travada(s) no meio: ${travadas.slice(0, 3).join(', ')}` : '',
    ].filter(Boolean).join(' · ')

    return {
      ...base,
      ok:       false,
      detalhe:  partes,
      correcao: 'Rodar `npx prisma migrate status` com DATABASE_URL do schema em questão. Na V2 o schema real vem de `db push`, então o SQL escrito à mão costuma divergir do banco — gere os tipos com `prisma migrate diff` em vez de assumir UUID: id do Prisma com `String @id` vira TEXT. Depois de aplicar, EXERCITE a rota que usa a tabela: em 2026-08-22 a tabela ausente derrubava toda avaliação de política com 500, e nenhum painel acusou.',
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private meta(id: string) {
    const def = INVARIANTES.find((i) => i.id === id)
    if (!def) throw new Error(`Invariante desconhecido: ${id}`)
    return { id: def.id, titulo: def.titulo, categoria: def.categoria, gravidade: def.gravidade }
  }

  private falhaDeExecucao(e: unknown): InvariantResult {
    return {
      id: 'erro_de_execucao', titulo: 'Falha ao rodar um invariante',
      categoria: 'infra', gravidade: 'baixa', ok: false,
      detalhe: `O check não pôde ser avaliado: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  private humanizarSegundos(s: number): string {
    if (s < 120) return `${s}s`
    if (s < 7200) return `${Math.round(s / 60)}min`
    if (s < 172800) return `${Math.round(s / 3600)}h`
    return `${Math.round(s / 86400)} dias`
  }
}

/**
 * `PING` cru num socket TCP, sem cliente Redis.
 *
 * A api-v2 nao tem dependencia de Redis e nao precisa ganhar uma so para responder "a porta esta
 * trancada?". O protocolo do Redis aceita comando em texto simples terminado em CRLF, e a
 * primeira linha da resposta ja diz tudo: `+PONG` (aberto) ou `-NOAUTH ...` (exige senha).
 *
 * Timeout curto de proposito: o check roda a cada 30min e nao pode ficar pendurado num socket que
 * nunca responde — inconclusivo rapido vale mais que certeza tardia.
 */
function pingRedisCru(host: string, porta: number, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    let respondido = false

    const encerrar = (fn: () => void) => {
      if (respondido) return
      respondido = true
      socket.destroy()
      fn()
    }

    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => encerrar(() => reject(new Error('timeout'))))
    socket.once('error', (e) => encerrar(() => reject(e)))
    socket.once('data', (buf) => encerrar(() => resolve(buf.toString('utf8').trim())))
    socket.connect(porta, host, () => socket.write('PING\r\n'))
  })
}
