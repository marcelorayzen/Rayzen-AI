import { Injectable, Logger } from '@nestjs/common'
import { blocoDeTrechosDeTerceiro } from './trecho-de-terceiro.const'
import { V1BridgeService } from '../core/v1-bridge.service'
import { MemoryService } from '../memory/memory.service'
import type { MemorySearchResult } from '../core/v1-api.service'
import { KnowledgeStorageService } from '../knowledge/knowledge-storage.service'
import { PolicyEngineService } from '../policy-engine/policy-engine.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { textoLimpo } from '../core/event-derived-text.const'

export type WorkMode = 'implementation' | 'debugging' | 'review' | 'architecture' | 'study'
export type ContextSection =
  | 'project_state' | 'active_goal' | 'recent_events'
  | 'memory_relevant' | 'planning' | 'blockers'
  | 'knowledge_graph' | 'policy_constraints' | 'approval_gates'

/**
 * Quais regras de política valem o espaço que ocupam no contexto injetado.
 *
 * Medido em 2026-08-20 nos 3 projetos do baseline: a seção eram **349 chars idênticos**
 * — 10,7% do orçamento no Rayzen AI, 16,3% no Commerce, 8,3% no banco-imob — repetidos
 * em todo prompt, em todo projeto, em todo modo.
 *
 * O critério não é "é importante?", é **quem faz cumprir**:
 *
 * - `block` e `warn` são aplicados no servidor, no momento da escrita.
 *   `low_confidence_knowledge` lança `ForbiddenException` em
 *   `knowledge-storage.service.ts`, e `memory_requires_source` vira metadata. Quem lê o
 *   contexto **não consegue violá-las** — descrevê-las é gastar orçamento para informar
 *   uma regra que o código já garante sozinho.
 *
 * - `gate` é diferente: o `ApprovalGate` só cobre o caminho do workflow engine. Um deploy
 *   feito por `git push` numa sessão de Claude Code nunca passa por ele, então **o texto é
 *   o único portador da norma** naquele caminho. Essa linha muda comportamento.
 *
 * Regra de projeto entra sempre, independente da ação: ela é curadoria explícita de alguém,
 * não o default do sistema — e o custo dela é proporcional a quem a escreveu de propósito.
 */
function regraVaiParaOContexto(r: { action: string; projectId: string | null }): boolean {
  return r.projectId !== null || r.action.toLowerCase() === 'gate'
}

export interface ContextBuildRequest {
  projectId:  string
  taskType?:  string
  mode?:      WorkMode
  query?:     string
  maxTokens?: number
  include?:   ContextSection[]
}

export interface BuiltContext {
  sections:    Partial<Record<ContextSection, string>>
  falhas:      ContextSection[] // seções que ERRARAM — distinto de seção vazia; ver build()
  text:        string           // concatenated, ready to inject into system prompt
  totalChars:  number
  cacheHit:    boolean
  builtAt:     Date
}

export interface SurgicalContext {
  projectId:       string
  task:            string
  mode:            WorkMode
  context:         string        // assembled text, section by section
  readyToInject:   string        // prefixed with "# Rayzen Context", ready for system prompt
  totalChars:      number
  estimatedTokens: number
  sections:        string[]
  falhas:          ContextSection[] // seções que erraram — ausência por falha, não por vazio
  builtAt:         Date
}

// Sections included per work mode
const MODE_SECTIONS: Record<WorkMode, ContextSection[]> = {
  implementation: ['project_state', 'planning', 'policy_constraints', 'memory_relevant', 'recent_events', 'approval_gates'],
  debugging:      ['project_state', 'blockers', 'memory_relevant', 'recent_events', 'knowledge_graph', 'approval_gates'],
  review:         ['project_state', 'active_goal', 'memory_relevant', 'planning', 'knowledge_graph'],
  architecture:   ['project_state', 'active_goal', 'planning', 'blockers', 'policy_constraints', 'knowledge_graph'],
  study:          ['project_state', 'memory_relevant', 'recent_events', 'knowledge_graph'],
}

const DEFAULT_SECTIONS: ContextSection[] = [
  'project_state', 'active_goal', 'recent_events',
]

/**
 * A partir de quantos dias sem mudar de conteúdo o ProjectState se declara no contexto.
 *
 * Não é sempre: um "atualizado há 2 minutos" em todo prompt treina a ignorar o aviso —
 * mesmo princípio dos invariantes, que ficam calados quando está tudo certo. Uma semana
 * é a folga de um projeto tocado de vez em quando.
 */
const DIAS_ATE_ESTADO_VELHO = 7

/**
 * Até quando um evento ainda é "atividade recente".
 *
 * `getRecentEvents(projectId, 10)` traz os 10 últimos **sem olhar a data**, então um
 * projeto morto enche a cota com o que aconteceu meses atrás — e o cabeçalho da seção
 * diz "Recent Activity". Medido em 2026-08-20, com a mesma consulta nos 3 projetos do
 * baseline:
 *
 *   seção              Rayzen AI (ativo)   banco-imob (85d parado)
 *   Recent Activity                  765                      1218
 *   TOTAL                           3248                      4200
 *
 * O projeto parado recebia **mais** contexto que o ativo, e a maior parte da diferença
 * estava aqui. Não é volume de eventos — é que os 9 eventos de maio do banco-imob são
 * payloads crus de Grep/Glob, anteriores ao filtro de sinal do hook (16/08), enquanto os
 * do Rayzen AI são descrições curtas. Evento velho ocupa mais espaço por linha.
 *
 * 30 dias e não os 7 do `DIAS_ATE_ESTADO_VELHO`: aquele limiar responde "a descrição
 * parou?", este responde "vale a pena mostrar?". Voltar a um projeto depois de duas
 * semanas e ver onde parou é justamente o que se quer; ver maio em agosto, não.
 */
const DIAS_ATE_EVENTO_DEIXAR_DE_SER_RECENTE = 30

/**
 * Abaixo disto não há nada relevante a dizer, e a seção some.
 *
 * `memory_relevant` pega os 5 melhores por cosseno **sem piso**, então um projeto que não
 * tem nada a ver com a tarefa recebe 5 trechos assim mesmo — 400 chars cada, ~2.000 no
 * total, a maior seção do pacote. Depois de m4/m5/m6 ela virou **58% do orçamento no
 * Rayzen AI e 70% no banco-imob**, não por ter crescido, mas por todo o resto ter encolhido.
 *
 * Medido em 2026-08-20, mesma consulta ("cache de sessão no módulo de autenticação") nos
 * 4 projetos com acervo:
 *
 *   projeto        1º      5º     queda
 *   Rayzen AI      0.601   0.561    7%
 *   VB Ferragens   0.574   0.487   15%
 *   Commerce       0.531   0.509    4%
 *   banco-imob     0.480   0.455    5%
 *
 * Duas coisas saíram daí. **A curva é plana dentro de cada projeto**, então filtrar item a
 * item cortaria no meio de resultados equivalentes — por isso o piso decide se a seção
 * aparece, olhando só o melhor. E **o nível absoluto separa os projetos**: o melhor do
 * banco-imob é pior que o PIOR do Rayzen AI. É esse o sinal de "não há nada aqui".
 *
 * 0.52 e não 0.50 por causa do boost por modo, que soma até +0.030 ao score devolvido
 * (`memory.service.ts`): sem essa folga, o 0.480 do banco-imob viraria 0.510 e passaria.
 *
 * > As margens são estreitas — 0.010 acima do teto do banco-imob com boost, 0.011 abaixo do
 * > melhor do Commerce sem boost. Se um projeto legítimo começar a ficar sem a seção, é
 * > aqui que se mexe, e com nova medição, não por palpite.
 */
const PISO_DE_RELEVANCIA_DA_MEMORIA = 0.52

/**
 * Quantos trechos a seção serve.
 *
 * Era 5, e o 5º **quase nunca ganhava o lugar**. Medido em 2026-08-21 sobre as 10 consultas
 * do baseline (`docs/memoria-n1-baseline-precisao.md`), julgando slot a slot:
 *
 *   slot   útil em
 *    1º     7 de 10
 *    2º     5 de 10
 *    3º     4 de 10
 *    4º     5 de 10
 *    5º    **1 de 10**
 *
 * Cortar o 5º devolve ~20% do orçamento da maior seção do contexto e custa **um** trecho útil
 * em dez consultas. A precisão sai de ~26/50 (52%) para ~25/40 (**62%**) — o maior salto do
 * ciclo, e o único obtido servindo **menos** em vez de filtrar melhor.
 *
 * Por que não cortar mais: o 4º é tão útil quanto o 2º (5 de 10). A queda está entre o 4º e o
 * 5º, não numa curva suave — então 4 é onde a evidência manda parar.
 *
 * ── Por que o corte não é por score ──────────────────────────────────────────────
 * A tentação era manter os 5 e cortar por relevância. **Não dá:** o score não separa útil de
 * inútil nessa granularidade. Na consulta 1 o lixo pontua 0,58; na 5 o `cache.module.ts`,
 * que é o documento certo, pontua 0,557. **O lixo de uma consulta supera o ouro de outra.**
 * Piso absoluto, corte relativo ao topo e corte no maior intervalo foram todos testados
 * contra os dados e nenhum separa. Por isso o `PISO_…` acima decide só se a seção APARECE.
 */
const TRECHOS_DE_MEMORIA = 4

/**
 * ATRASADO = a descrição não se move **e** há trabalho acontecendo AGORA.
 *
 * A primeira versão usava a contagem acumulada desde a última mudança de conteúdo, e a
 * medição sobre os 8 projetos reais derrubou o limiar: ele errava em **quatro**.
 *
 *   projeto             dias  acumulado  últimas 24h   acumulado diz   certo
 *   Ray coach             99        138            0      atrasado    parado
 *   VB Ferragens          77         73            0      atrasado    parado
 *   marcelorayzen-site    50        111            0      atrasado    parado
 *   Commerce              54         68           67      atrasado    atrasado
 *
 * Contagem acumulada não distingue "trabalho acontecendo" de "138 eventos espalhados por
 * 99 dias mortos" — num projeto abandonado ela só cresce, então o aviso vira permanente,
 * que é o que se aprende a ignorar. O que separa o Commerce dos outros três é que **67
 * dos seus 68 eventos são de hoje**.
 *
 * Por isso a janela é recente, e há um piso em dias: sem ele, uma sessão normal de
 * trabalho num projeto saudável dispara o aviso (Rayzen AI faz 770 eventos/dia). Dois
 * dias sem a descrição andar, com um dia cheio de trabalho, é descompasso real.
 *
 * 40 é ~metade da janela que a própria síntese lê (`take: 120`, 80 no prompt).
 */
const EVENTOS_24H_ATE_ESTADO_ATRASADO = 40
const DIAS_MINIMOS_PARA_ATRASADO = 2
const JANELA_RECENTE_MS = 86_400_000

function diasDesde(data: Date): number {
  return Math.floor((Date.now() - new Date(data).getTime()) / 86_400_000)
}

@Injectable()
export class ContextEngineService {
  private readonly logger = new Logger(ContextEngineService.name)
  private readonly cache = new Map<string, { ctx: BuiltContext; expiresAt: number }>()
  private readonly TTL_MS = 5 * 60 * 1000  // 5 min

  constructor(
    private readonly v1Bridge:  V1BridgeService,
    private readonly memory:    MemoryService,
    private readonly knowledge: KnowledgeStorageService,
    private readonly policy:    PolicyEngineService,
    private readonly gates:     ApprovalGatesService,
  ) {}

  async build(req: ContextBuildRequest): Promise<BuiltContext> {
    const cacheKey = `${req.projectId}:${req.mode ?? 'default'}:${req.query ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.ctx, cacheHit: true }
    }

    const sections = req.include ?? (req.mode ? MODE_SECTIONS[req.mode] : DEFAULT_SECTIONS)
    const maxChars = (req.maxTokens ?? 4000) * 4  // ~4 chars per token

    const built: Partial<Record<ContextSection, string>> = {}
    const parts: string[] = []

    // Seção que falha não pode sumir calada.
    //
    // Achado em 2026-08-21 medindo o n5: `memory_relevant` veio VAZIA numa consulta porque
    // o container tinha acabado de subir e a busca falhou de forma transitória. Como o
    // `catch` só logava, a seção desapareceu do pacote e do array `sections` — e quem lê o
    // contexto não tem como distinguir **"não há memória relevante"** de **"a busca
    // falhou"**. As duas coisas pedem reações opostas.
    //
    // Continua sem relançar de propósito: um retrato parcial vale mais que exceção, e essa
    // decisão já estava certa. O que faltava era deixar rastro.
    const falhas: ContextSection[] = []
    await Promise.all(sections.map(async (section) => {
      try {
        const content = await this.fetchSection(section, req)
        if (content) built[section] = content
      } catch (e) {
        falhas.push(section)
        this.logger.warn(`section ${section} failed: ${e}`)
      }
    }))

    // Assemble in order
    for (const section of sections) {
      if (built[section]) {
        parts.push(`### ${sectionLabel(section)}\n${built[section]}`)
      }
    }

    // A marca vai no texto, não só no log: quem consome o contexto é quem precisa saber
    // que a ausência é falha, e ele nunca vê o log do servidor. Só aparece quando há
    // falha — pelo mesmo motivo dos invariantes, aviso em todo prompt é aviso ignorado.
    if (falhas.length) {
      parts.push(
        `### Aviso\n${falhas.map(sectionLabel).join(', ')} — indisponível nesta consulta ` +
        `por falha ao montar, **não** por ausência de dado. Trate como desconhecido, não como vazio.`,
      )
    }

    let text = parts.join('\n\n')
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + '\n... [truncated]'
    }

    const ctx: BuiltContext = {
      sections: built,
      falhas,
      text,
      totalChars: text.length,
      cacheHit:   false,
      builtAt:    new Date(),
    }

    // Contexto incompleto por falha transitória NÃO entra no cache. Sem isto, uma busca
    // que falhou por meio segundo congela a seção fora do pacote pelo TTL inteiro — o
    // erro dura ordens de magnitude mais que a causa, e a retentativa seguinte devolve
    // o mesmo buraco de graça.
    if (!falhas.length) {
      this.cache.set(cacheKey, { ctx, expiresAt: Date.now() + this.TTL_MS })
    }
    return ctx
  }

  invalidateCache(projectId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(projectId)) this.cache.delete(key)
    }
  }

  /**
   * Monta o pacote cirúrgico completo para injeção no Claude.
   * Inclui: ProjectState + Planning + Policy + Knowledge relevante + Memória semântica + Eventos recentes.
   */
  async buildSurgical(req: { projectId: string; task: string; mode?: WorkMode }): Promise<SurgicalContext> {
    const mode = req.mode ?? 'implementation'
    const baseSections = MODE_SECTIONS[mode] ?? DEFAULT_SECTIONS
    // Garante que policy_constraints e knowledge_graph estão sempre presentes no pacote cirúrgico
    const sections = [...new Set([...baseSections, 'policy_constraints' as ContextSection, 'knowledge_graph' as ContextSection])]

    const built = await this.build({
      projectId: req.projectId,
      mode,
      query:     req.task,
      include:   sections,
      maxTokens: 3000,
    })

    const readyToInject = `# Rayzen Context — ${req.task}\n\n${built.text}`

    return {
      projectId:       req.projectId,
      task:            req.task,
      mode,
      context:         built.text,
      readyToInject,
      totalChars:      built.totalChars,
      estimatedTokens: Math.ceil(built.totalChars / 4),
      sections:        Object.keys(built.sections),
      falhas:          built.falhas,
      builtAt:         built.builtAt,
    }
  }

  /**
   * Quem escolhe o que entra em `memory_relevant`. Existe separado da formatação por um
   * motivo específico: é a **única** seleção, e o invariante `memoria_relevante_serve_util`
   * a consome direto.
   *
   * A tentação era o invariante repetir esta busca com os mesmos parâmetros. Isso seria o
   * "Invariante 1 — Documentos sempre têm projectId" do contrato da V1: um check que testa
   * uma cópia local e passou verde com 236 órfãos no banco. Enunciado sem sensor. Com um
   * método só, mudar o piso, o limite ou o modo muda o que o sensor vê — de graça.
   */
  private async selecionarMemoria(req: ContextBuildRequest): Promise<MemorySearchResult[]> {
    if (!req.query) return []
    const results = await this.memory.search({
      query:     req.query,
      projectId: req.projectId,
      limit:     TRECHOS_DE_MEMORIA,
      mode:      (req.mode as WorkMode | undefined),
    })
    // O piso decide se a SEÇÃO aparece, não quais itens ficam. Dentro de um mesmo
    // projeto a curva é plana (4–7% entre o 1º e o 5º), então filtrar item a item
    // cortaria arbitrariamente no meio de coisas equivalentes.
    const melhor = results.results[0]?.score ?? 0
    if (melhor < PISO_DE_RELEVANCIA_DA_MEMORIA) return []
    // O `slice` é redundante hoje — `search()` já corta em `limit` — e existe mesmo
    // assim: quem define quanto a SEÇÃO serve é a seção, não a confiança de que outro
    // service vá respeitar o pedido.
    return results.results.slice(0, TRECHOS_DE_MEMORIA)
  }

  /**
   * Mesma seleção que vai para o prompt, sem virar texto — para quem precisa inspecionar
   * o que foi servido (hoje: o invariante). Não é um caminho paralelo: chama o mesmo
   * método que a seção chama.
   */
  async diagnosticarMemoria(req: { projectId: string; query: string; mode?: WorkMode }): Promise<MemorySearchResult[]> {
    return this.selecionarMemoria(req as ContextBuildRequest)
  }

  private async fetchSection(section: ContextSection, req: ContextBuildRequest): Promise<string> {
    switch (section) {
      case 'project_state': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        // `getProjectState` devolve a linha CRUA do Prisma — não passa pelo
        // `serialize()` da V1, que é onde a limpeza mora lá. Sem isto o mesmo
        // ProjectState responde duas coisas conforme quem pergunta: a V1 devolvia ''
        // para o objetivo derivado de arquivo do Commerce enquanto a V2 o injetava
        // inteiro em todo contexto.
        const objetivo = textoLimpo(state.objective)
        const parts = [
          objetivo    ? `Objective: ${objetivo}` : '',
          state.stage ? `Stage: ${state.stage}` : '',
        ].filter(Boolean)

        // Estado velho apresentado como atual é pior que estado ausente: quem lê não tem
        // como saber. Toda linha de `recent_events` carrega data; a seção mais categórica
        // do contexto não carregava nenhuma. Medido em 2026-08-16: o banco-imob servia um
        // estado de 27/05 — 81 dias — com exatamente a mesma cara do estado do Rayzen AI,
        // sintetizado no mesmo dia.
        //
        // A pergunta não é "quando escrevemos?" e sim "quanta realidade se acumulou desde
        // que essa descrição foi confirmada?". Por isso o marco é `contentChangedAt` (só
        // avança quando o hash dos campos semânticos muda) e não `updatedAt` (marca
        // d'água do refresh, avança em toda escrita). Medido no Commerce em 2026-08-17:
        // um refresh zerou o contador mantendo o objetivo de 24/06 — a data atestava um
        // frescor que o texto não tinha.
        const marco = state.contentChangedAt ?? state.updatedAt
        const dias = diasDesde(marco)
        const [eventos, eventosRecentes] = await Promise.all([
          this.v1Bridge.countEventsSince(req.projectId, new Date(marco)),
          this.v1Bridge.countEventsSince(req.projectId, new Date(Date.now() - JANELA_RECENTE_MS)),
        ])

        const atrasado = dias >= DIAS_MINIMOS_PARA_ATRASADO
          && eventosRecentes >= EVENTOS_24H_ATE_ESTADO_ATRASADO

        if (atrasado) {
          // Trabalho acontecendo agora sobre uma descrição que não anda — o caso que a
          // versão por `updatedAt` nunca via, porque ela dizia "0 dias".
          parts.push(`(descrição inalterada há ${dias} dias, mas ${eventosRecentes} eventos só nas últimas 24h — provavelmente atrasada em relação ao trabalho atual)`)
        } else if (dias >= DIAS_ATE_ESTADO_VELHO) {
          // Parado: o estado provavelmente está certo, só é antigo. Dizer quantos eventos
          // houve é o que separa "abandonado" de "errado".
          parts.push(`(descrição inalterada há ${dias} dias, com ${eventos} eventos desde então — projeto provavelmente parado)`)
        }

        return parts.join('\n')
      }

      case 'active_goal': {
        const goal = await this.v1Bridge.getProjectGoal(req.projectId)
        if (!goal) return ''
        const criteria = Array.isArray(goal.successCriteria)
          ? (goal.successCriteria as Array<Record<string, unknown>>)
              .map((c) => {
                const text = nodeLabel(c)
                const done = Boolean(c.done ?? c.completed ?? c.checked)
                return text ? `- [${done ? 'x' : ' '}] ${text}` : ''
              })
              .filter(Boolean)
              .join('\n')
          : ''
        return `Goal: ${goal.title}${criteria ? `\n${criteria}` : ''}`
      }

      case 'recent_events': {
        const events = await this.v1Bridge.getRecentEvents(req.projectId, 10)
        const corte = Date.now() - DIAS_ATE_EVENTO_DEIXAR_DE_SER_RECENTE * 86_400_000
        const recentes = events.filter((e) => new Date(e.ts).getTime() >= corte)
        // Nada dentro da janela: a seção some em vez de virar cabeçalho mentindo.
        // O `project_state` já diz há quantos dias o projeto não anda.
        if (!recentes.length) return ''
        return recentes
          .map((e) => `[${new Date(e.ts).toISOString().slice(0, 16)}] ${e.type}: ${String(e.content).slice(0, 120)}`)
          .join('\n')
      }

      case 'planning': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const ms = Array.isArray(state.milestones) ? state.milestones : []
        const ns = Array.isArray(state.nextSteps) ? state.nextSteps : []
        const renderMilestone = (m: unknown): string => {
          const status = m && typeof m === 'object' ? (m as Record<string, unknown>).status : undefined
          return `- ${nodeLabel(m)}${status ? ` (${String(status)})` : ''}`
        }
        const parts = [
          ms.length ? `Milestones:\n${ms.map(renderMilestone).join('\n')}` : '',
          ns.length ? `Next steps:\n${ns.map((n) => `- ${nodeLabel(n)}`).join('\n')}` : '',
        ].filter(Boolean)
        return parts.join('\n\n')
      }

      case 'blockers': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const bl = Array.isArray(state.blockers) ? state.blockers : []
        return bl.length ? bl.map((b) => `- ${nodeLabel(b)}`).join('\n') : 'No active blockers.'
      }

      case 'memory_relevant': {
        const escolhidos = await this.selecionarMemoria(req)
        // Conteúdo do acervo é escrito por TERCEIROS (`indexUrl`/`indexNotion`/`indexGithub`/
        // `indexFile`) e entrava cru aqui — sem rótulo, sem procedência, no mesmo canal das
        // instruções do sistema. Ver `trecho-de-terceiro.const.ts` para o que a fronteira
        // entrega de fato, e para o que ela explicitamente não garante.
        return blocoDeTrechosDeTerceiro(escolhidos)
      }

      case 'knowledge_graph': {
        const nodes = await this.knowledge.listNodes(req.projectId)
        if (!nodes.length) return ''

        let filtered = nodes
        if (req.query) {
          // `\p{Diacritic}` em vez de um intervalo de combinantes literais: este repo já teve
          // corrupção de encoding (U+FFFD, 128 linhas em 11 tabelas), e caractere invisível no
          // fonte é exatamente o que se perde numa dessas. Ver project_encoding_cleanup.
          const normaliza = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
          const words = normaliza(req.query).split(/\s+/).filter((w) => w.length > 3)
          const matched = nodes.filter((n) =>
            words.some(
              (w) => normaliza(n.label).includes(w) || (n.description ? normaliza(n.description).includes(w) : false),
            ),
          )
          // Sem correspondência, o fallback era **todos** os nós por confiança — e como 535 dos
          // 570 são varredura de código (`file`), isso servia 15 caminhos de arquivo sorteados
          // por ordem de confiança, sem relação com a tarefa. Medido em 2026-08-20 numa sessão
          // de auditoria: a seção trouxe `parse-test-report.ts`, `rayzen-context-hook.mjs` e
          // outros 8, nenhum ligado ao que se estava fazendo.
          //
          // O tipo `file` não é o problema — quando ele CASA com a consulta é ótimo
          // (`cache.service.ts` para "implementar cache de sessão"). O problema é o palpite:
          // nó curado à mão (entity, concept, module, rule, adr) diz algo sobre o projeto
          // mesmo sem casar; caminho de arquivo sorteado não diz nada.
          filtered = matched.length ? matched : nodes.filter((n) => n.type !== 'file')
        }

        return filtered
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 15)
          .map((n) => `[${n.type}] ${n.label}${n.description ? ` — ${n.description.slice(0, 120)}` : ''} (conf=${n.confidence.toFixed(2)})`)
          .join('\n')
      }

      case 'policy_constraints': {
        const rules = await this.policy.listRules(req.projectId)
        const enabled = rules.filter((r) => r.enabled)
        if (!enabled.length) return 'No active policy constraints.'
        // Project rule wins over system rule with same name (mirrors evaluate() logic)
        const ruleMap = new Map<string, typeof enabled[number]>()
        for (const rule of enabled) {
          const existing = ruleMap.get(rule.name)
          if (!existing || rule.projectId !== null) ruleMap.set(rule.name, rule)
        }
        return [...ruleMap.values()]
          .filter(regraVaiParaOContexto)
          .map((r) => `[${r.action.toUpperCase()}] ${r.name}: ${r.description}`)
          .join('\n')
      }

      case 'approval_gates': {
        const pending = await this.gates.findPending(req.projectId)
        if (!pending.length) return ''
        return pending
          .map((g) => `[${g.type.toUpperCase()}] ${g.description} (gate=${g.id.slice(0, 8)}, mission=${(g.missionId ?? 'n/a').slice(0, 8)})`)
          .join('\n')
      }

      default:
        return ''
    }
  }
}

// State JSON fields (milestones, nextSteps, successCriteria, blockers) may hold
// strings or objects ({id,title,status} / {id,text,done}). Extract a human label robustly.
function nodeLabel(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    const label = o.title ?? o.description ?? o.text ?? o.name ?? o.label
    if (typeof label === 'string') return label
  }
  return ''
}

function sectionLabel(s: ContextSection): string {
  const labels: Record<ContextSection, string> = {
    project_state:      'Project State',
    active_goal:        'Active Goal',
    recent_events:      'Recent Activity',
    memory_relevant:    'Relevant Knowledge',
    planning:           'Planning',
    blockers:           'Blockers',
    knowledge_graph:    'Knowledge Graph',
    policy_constraints: 'Policy Constraints',
    approval_gates:     'Pending Approval Gates',
  }
  return labels[s] ?? s
}
