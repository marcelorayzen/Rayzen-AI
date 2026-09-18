import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { classificarResposta } from './resposta-aprovacao.const'
import { pedeAcaoNoFuturo, respostaSemAgendadorAbsoluto, atrasoDoPedido } from './pedido-agendado'
import { ehEscopoGeral, escopoDeBusca } from '../../common/escopo-geral.const'
import { anotarComDominio, type TrechoComDono } from '../../common/dominio-do-projeto.const'
import { blocoDeTrechosDeTerceiro } from '../memory/trecho-de-terceiro.const'
import {
  consultarFonte, avisoDeFontesIndisponiveis, avisoDeEstadoDesatualizado, SEM_ESTADO_SINTETIZADO,
} from './fontes-de-contexto'
import OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { TaskModule, ChatMessage } from '@rayzen/types'
import { getWorkModeConfig } from './work-modes'
import { ehTextoDerivadoDeEvento } from '../project-state/event-derived-text.const'
import { carregarSoul, CAMINHO_SOUL } from './soul'
import { MemoryService } from '../memory/memory.service'
import { DocumentProcessingService } from '../document-processing/document-processing.service'
import { ExecutionService } from '../execution/execution.service'
import { ContentEngineService } from '../content-engine/content-engine.service'
import { RayzenConfigService } from '../configuration/configuration.service'
import { ValidationService } from '../validation/validation.service'
import { EventService } from '../event/event.service'
import { buildJarvisPayload } from '../execution/jarvis-payload-builder'
import { MetricsService } from '../metrics/metrics.service'
import { AgentSessionService } from '../agent-session/agent-session.service'


export interface ClassifyResult {
  module: TaskModule
  action: string
  confidence: number
}

export interface OrchestrateResult {
  reply: string
  module: TaskModule
  action: string
  confidence: number
  tokensUsed: number
  sessionId: string
}

interface PendingAction {
  action: string
  payload: Record<string, unknown>
  prompt: string
  risk: 'medium' | 'high'
}

const MODULE_ROLE_SUFFIXES: Record<string, string> = {
  // ── Negar capacidade que existe é inventar fato, igual a afirmar a que não existe ──────────
  //
  // O caminho `system` era o ÚNICO sem sufixo: o modelo recebia o SOUL e mais nada, e o SOUL não
  // diz que existe um executor local. Medido em 15/09, no primeiro teste real pelo Telegram —
  // logo depois de OFERECER a captura de tela, respondeu "não consigo capturar ou enviar imagens
  // da tela", e em seguida descreveu uma interface inventada, citando "ChatGPT".
  //
  // Não enumera ações aqui de propósito. A lista já existe no prompt do classificador, e uma
  // segunda cópia divergiria — esta casa já teve `SAFE_ROOTS` em quatro versões como lembrete.
  // O que o modelo precisa saber é que **a decisão de executar não é dele**: quem roteia é o
  // classificador, quem executa é o agent. Dizer "não consigo" é responder por um mecanismo que
  // ele não consultou.
  system:  '\n\nVocê opera com um executor local (agent) na máquina do Marcelo e no servidor; pedidos de ação são roteados para ele por outro caminho, não por esta resposta. Nunca afirme que não tem capacidade de agir no computador, ver tela, ler arquivos ou rodar comandos — você não sabe daqui o que o executor aceita. Se algo não for possível, diga o que falta em vez de negar a capacidade. E nunca descreva uma tela, arquivo ou estado que você não recebeu no contexto.',
  // ── O sufixo `jarvis` saiu em 16/09: afirmava execução que o sistema não verifica ─────────
  //
  // Ele dizia *"Contexto desta resposta: executei uma tarefa local no PC"*. Nenhum código
  // conferia se alguma execução tinha de fato acontecido — era uma afirmação entregue ao modelo
  // pelo próprio sistema, e afirmar o que não se verificou é a definição do que o SOUL proíbe.
  //
  // Estava **morto**: todos os caminhos do ramo `jarvis` retornam antes do `getSystemPrompt`, e
  // a síntese pós-execução monta prompt próprio (aí a frase seria verdadeira, e ela nem é usada).
  // Morto e falso é pior que vivo e falso: ninguém o corrige, porque ninguém o vê falhar.
  //
  // E a forma que o tornaria vivo já existe ao lado — o ramo `content` tem `catch { /* fallback
  // para chat normal */ }`, e cai no chat **carregando o rótulo do módulo**. Bastava um `catch`
  // igual no ramo `jarvis` para o modelo receber "executei uma tarefa" logo depois de falhar em
  // executá-la. Crítica externa apontou a forma; a varredura achou a instância.
  //
  // `brain` e `doc` também estão inalcançáveis hoje, pelo mesmo motivo. Ficam porque descrevem
  // ESTILO, não fato — não há o que ser falso neles.
  brain:   '\n\nContexto desta resposta: baseie-se nos documentos e informações da memória semântica. Apresente com confiança — sem ressalvas desnecessárias.',
  doc:     '\n\nContexto desta resposta: geração de documentos técnicos. Use markdown estruturado, listas e seções bem definidas.',
  content: '\n\nContexto desta resposta: criação de conteúdo. Entregue imediatamente, sem introdução.',
}

/** Quantas mensagens da conversa entram no prompt — as ÚLTIMAS, ver `janelaDeHistorico`. */
const JANELA_DE_HISTORICO = 20

// As listas fechadas `CONFIRM_WORDS`/`CANCEL_WORDS` sairam daqui em 15/09: `^confirma$` nao casa
// "confirmo", e foi assim que o primeiro teste real da jornada pelo Telegram morreu no card de
// confirmacao. A decisao agora e a mesma do A02 — ver `resposta-aprovacao.const.ts`.
const ACTION_RISK: Record<string, 'low' | 'medium' | 'high'> = {
  list_dir: 'low',
  file_search: 'low',
  get_system_info: 'low',
  git_status: 'low',
  git_log: 'low',
  docker_ps: 'low',
  docker_logs: 'low',
  inspect_schema: 'low',
  open_app: 'medium',
  open_url: 'medium',
  open_vscode: 'medium',
  create_project_folder: 'medium',
  run_tests: 'medium',
  screenshot: 'medium',
  notify: 'medium',
  clipboard_read: 'medium',
  organize_downloads: 'high',
  clipboard_write: 'high',
  git_branch: 'high',
  git_commit: 'high',
  run_command: 'high',
  docker_start: 'high',
  docker_stop: 'high',
  read_emails: 'medium',
  send_email: 'high',
  get_calendar: 'medium',
  restart_api: 'high',
  parse_test_report: 'low',
  get_qa_summary: 'low',
}

@Injectable()
export class OrchestratorService {
  private llm: OpenAI
  /** Evita repetir o aviso de SOUL ausente a cada mensagem. */
  private avisouSoulAusente = false

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private memory: MemoryService,
    private documentProcessing: DocumentProcessingService,
    private execution: ExecutionService,
    private contentEngine: ContentEngineService,
    private rayzenConfig: RayzenConfigService,
    private validation: ValidationService,
    private eventService: EventService,
    private metrics: MetricsService,
    private agentSession: AgentSessionService,
  ) {
    this.llm = createLlmClient('orchestrator', {
      apiKey:  this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
    })
  }

  private getRayzenConfig() {
    try { return this.rayzenConfig.getConfig() } catch { return null }
  }

  /**
   * Anota cada trecho com o domínio declarado do projeto dono.
   *
   * A regra mora em `common/dominio-do-projeto.const.ts` porque **dois caminhos** servem trecho
   * indexado ao modelo — este bloco e a síntese do Brain (`MemoryService.searchAndSynthesize`) —
   * e duas cópias seriam a família de drift que esta casa já pagou com `SAFE_ROOTS`.
   */
  private async comDominio(trechos: TrechoComDono[]) {
    return anotarComDominio(trechos, (ids) =>
      this.prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, domain: true } }),
    )
  }

  private async getProjectContext(projectId?: string): Promise<string> {
    // `ehEscopoGeral` e nao `!projectId`: desde 18/09 o contexto geral e um Project de verdade, e
    // pedir o ProjectState dele traria um objetivo sintetizado a partir de conversa solta.
    if (ehEscopoGeral(projectId)) return ''
    try {
      // Cada `.catch(() => null)` aqui dizia ao modelo "não existe" quando a verdade era "não
      // consegui ler" — ver `fontes-de-contexto.ts`. O estado agora é carregado junto com o dado.
      const [projeto, estado, meta, eventos] = await Promise.all([
        consultarFonte('o projeto',
          () => this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true } }),
          null, (v) => v === null),
        consultarFonte('o estado do projeto',
          () => this.prisma.projectState.findFirst({
            where: { projectId },
            orderBy: { updatedAt: 'desc' },
            select: { objective: true, stage: true, blockers: true, recentDecisions: true, activeFocus: true, contentChangedAt: true, updatedAt: true },
          }) as Promise<{ objective: string | null; stage: string | null; blockers: unknown; recentDecisions: unknown; activeFocus: string | null; contentChangedAt: Date | null; updatedAt: Date } | null>,
          null, (v) => v === null),
        consultarFonte('a meta ativa',
          () => this.prisma.projectGoal.findFirst({
            where: { projectId, status: 'active' },
            orderBy: { createdAt: 'desc' },
            select: { title: true, successCriteria: true, targetDate: true },
          }) as Promise<{ title: string; successCriteria: unknown; targetDate: Date | null } | null>,
          null, (v) => v === null),
        consultarFonte('os eventos recentes',
          () => this.prisma.event.findMany({
            where: { projectId },
            orderBy: { ts: 'desc' },
            take: 8,
            select: { content: true, type: true },
          }),
          [] as Array<{ content: string; type: string }>, (v) => v.length === 0),
      ])

      const fontes = [projeto, estado, meta, eventos]
      const project      = projeto.valor
      const state        = estado.valor
      const goal         = meta.valor
      const recentEvents = eventos.valor

      // Falhar ao LER o projeto é diferente de o projeto não existir: no primeiro caso, devolver
      // contexto vazio faria o modelo conversar como se não houvesse projeto nenhum.
      if (!project) return estado.estado === 'falhou' || projeto.estado === 'falhou'
        ? avisoDeFontesIndisponiveis(fontes)
        : ''

      let ctx = `\n\nProjeto ativo: "${project.name}"${project.description ? ` — ${project.description}` : ''}. Responda SOMENTE sobre este projeto.`

      if (state?.objective) {
        ctx += `\n\nEstado atual: ${state.stage ?? 'desconhecido'} | Objetivo: ${state.objective}`
        if (state.activeFocus) ctx += ` | Foco: ${state.activeFocus}`
        const blockers = (state.blockers as Array<{ title: string }> | null) ?? []
        if (blockers.length > 0) ctx += `\nBlockers: ${blockers.map(b => b.title).join(', ')}`
        const decisions = (state.recentDecisions as string[] | null) ?? []
        if (decisions.length > 0) ctx += `\nDecisões recentes: ${decisions.slice(0, 3).join('; ')}`

        // Contradição entre o que a descrição diz e o que o trabalho mostra. A V2 declara isso
        // desde 17/08; o chat da V1 servia a seção mais categórica do contexto **sem data
        // nenhuma**. Marco é `contentChangedAt`, nunca `updatedAt` — ver `fontes-de-contexto.ts`.
        const marco = state.contentChangedAt ?? state.updatedAt
        if (marco) {
          const [desdeOMarco, ultimas24h] = await Promise.all([
            this.prisma.event.count({ where: { projectId, ts: { gte: new Date(marco) } } }).catch(() => 0),
            this.prisma.event.count({ where: { projectId, ts: { gte: new Date(Date.now() - 86_400_000) } } }).catch(() => 0),
          ])
          ctx += avisoDeEstadoDesatualizado(marco, desdeOMarco, ultimas24h)
        }
      } else if (estado.estado === 'vazio') {
        // Projeto real que ainda não teve checkpoint. Silêncio aqui convida o modelo a preencher
        // objetivo e fase a partir do nome do projeto e dos eventos.
        ctx += SEM_ESTADO_SINTETIZADO
      }

      if (goal) {
        const criteria = (goal.successCriteria as Array<{ text: string; done: boolean }> | null) ?? []
        const done = criteria.filter(c => c.done).length
        ctx += `\n\nMeta ativa: "${goal.title}" (${done}/${criteria.length} critérios concluídos)`
        if (goal.targetDate) ctx += ` | Prazo: ${new Date(goal.targetDate).toLocaleDateString('pt-BR')}`
      }

      // "Atividade não é intenção": eco de ferramenta (`Bash: …`, `Edit: <caminho>`,
      // `Workspace alterado: …`) descreve o MEIO, não o trabalho — e servido como "atividade do
      // projeto" ele não só polui: o modelo CONCLUI a partir dele. Medido em 14/09, na primeira
      // conversa real pelo Telegram: de `Bash: Check whether the pnpm install is alive or hung`
      // a resposta afirmou "o pnpm install está rodando normalmente", o oposto do que acontecia.
      //
      // `ehTextoDerivadoDeEvento` já existia e já era aplicado no ProjectState desde 17/08,
      // nascido deste mesmo defeito (292 ecos em 7 dias moldando o objetivo do projeto). A regra
      // estava escrita e aplicada num lugar só; o chat lia a tabela crua.
      //
      // `Bash: <description>` NÃO é filtrado, de propósito: o contrato desta casa trata a
      // descrição do comando como sinal (o comando cru é que seria ruído), e classificar por
      // prefixo aqui seria voltar a decidir por CAMPO. O que se corrige é o RÓTULO e a ORDEM.
      const atividadeReal = recentEvents.filter(e => !ehTextoDerivadoDeEvento(e.content))
      if (atividadeReal.length > 0) {
        // Decisão antes de execução: decisão responde "onde o projeto está", execução conta
        // "como se chegou aqui". Com oito execuções recentes, uma decisão some da janela —
        // e foi assim que uma pergunta de status virou uma lista de comandos de depuração.
        const peso = (t: string) => (t === 'decision' ? 0 : t === 'execution' ? 2 : 1)
        const ordenados = [...atividadeReal].sort((a, b) => peso(a.type) - peso(b.type))

        // O rótulo é metade do conserto. "Atividade recente" convida a concluir estado a partir
        // de telemetria — e o modelo aceitou o convite: de `Bash: Check whether the pnpm install
        // is alive or hung` saiu "o pnpm install está rodando normalmente", o oposto do que
        // acontecia. A seção agora diz o que é, e o que não é.
        ctx += `\n\nRegistro operacional recente (telemetria do trabalho — NÃO são o estado do ` +
               `projeto; não conclua nada a partir destas linhas):\n` + ordenados
          .map(e => `- [${e.type}] ${e.content.slice(0, 120)}`)
          .join('\n')
      }

      return ctx + avisoDeFontesIndisponiveis(fontes)
    } catch {
      // O catch externo devolvia `''`: qualquer soluco do Postgres fazia o modelo receber
      // um projeto sem estado, sem meta e sem historico -- indistinguivel de um projeto
      // recem-criado. Agora ele diz que nao conseguiu ler.
      return avisoDeFontesIndisponiveis([{ nome: 'o contexto do projeto', estado: 'falhou', valor: null }])
    }
  }

  /**
   * A identidade vem do SOUL — o MESMO arquivo que o Hermes carrega. Até 14/09 vinha de
   * `rayzen.config.json → identity.personality`, e o resultado eram dois Rayzen diferentes
   * conforme o canal: pelo Telegram ele se apresentava como "agente operacional principal da
   * plataforma", pelo Hermes como "assistente pessoal de IA de Marcelo".
   *
   * Os sufixos por módulo FICAM: eles não são identidade, são contexto da resposta ("executei
   * uma tarefa local", "baseie-se nos documentos"). Quem ele é não muda por módulo; o que ele
   * está fazendo, sim.
   */
  private getSystemPrompt(module: string): string {
    const suffix = MODULE_ROLE_SUFFIXES[module] ?? ''
    const soul = carregarSoul()
    if (soul) return soul + suffix

    // Identidade que some sem ninguém notar é o mesmo modo de falha do `TELEGRAM_API_TOKEN` que
    // nunca existiu: responder com personalidade genérica e seguir calado esconde o problema.
    // Avisa uma vez por processo — a cada mensagem viraria ruído de log.
    if (!this.avisouSoulAusente) {
      this.avisouSoulAusente = true
      console.error(
        `[orchestrator] SOUL não encontrado em ${CAMINHO_SOUL} — respondendo com a personalidade ` +
        `de rayzen.config.json. A imagem precisa copiar core/identity/.`,
      )
    }
    const cfg = this.getRayzenConfig()
    const base = cfg?.identity.personality ?? 'Seja direto e objetivo. Sem frases de abertura. Português brasileiro.'
    return base + suffix
  }

  private actionRisk(action: string): 'low' | 'medium' | 'high' {
    return ACTION_RISK[action] ?? 'high'
  }

  private requiresConfirmation(action: string): boolean {
    return this.actionRisk(action) !== 'low'
  }

  private encodePendingAction(pending: PendingAction): string {
    return Buffer.from(JSON.stringify(pending)).toString('base64')
  }

  private decodePendingAction(encoded: string): PendingAction {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as PendingAction
  }

  private parseLlmJson<T>(content: string | null | undefined, fallback: T, context: string): T {
    if (!content) return fallback

    const normalized = content.trim()
    const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    const candidate = (fenced?.[1] ?? normalized).trim()

    try {
      return JSON.parse(candidate) as T
    } catch {
      const start = candidate.search(/[\[{]/)
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1)) as T
      }
      throw new Error(`${context}: invalid JSON returned by model`)
    }
  }

  private async lastAssistantMessage(sessionId: string) {
    return this.prisma.conversationMessage.findFirst({
      where: { sessionId, role: 'assistant' },
      orderBy: { createdAt: 'desc' },
    })
  }

  async isPendingDocConfirmation(prompt: string, sessionId: string): Promise<boolean> {
    if (classificarResposta(prompt) !== 'aprovado') return false
    const lastMsg = await this.lastAssistantMessage(sessionId)
    return !!lastMsg?.content?.includes('[DOC_PENDING:')
  }

  async isPendingActionResponse(prompt: string, sessionId: string): Promise<boolean> {
    const decisao = classificarResposta(prompt)
    if (decisao !== 'aprovado' && decisao !== 'rejeitado') return false
    const lastMsg = await this.lastAssistantMessage(sessionId)
    return !!lastMsg?.content?.includes('[ACTION_PENDING:')
  }

  async handleMessage(prompt: string, sessionId: string, projectId?: string, workMode?: string): Promise<OrchestrateResult> {
    // 0. Check for pending doc confirmation before anything else
    const decisao = classificarResposta(prompt)
    if (decisao === 'aprovado') {
      const lastMsg = await this.prisma.conversationMessage.findFirst({
        where: { sessionId, role: 'assistant' },
        orderBy: { createdAt: 'desc' },
      })
      const pendingMatch = lastMsg?.content?.match(/\[DOC_PENDING:([A-Za-z0-9+/=]+)\]/)
      if (pendingMatch) {
        const pendingPrompt = Buffer.from(pendingMatch[1], 'base64').toString('utf-8')
        try {
          const result = await this.documentProcessing.generatePDF(pendingPrompt, sessionId)
          const downloadPath = `/documents/download/${result.fileName}`
          const reply = `Documento gerado: **${result.fileName}** (${Math.round(result.sizeBytes / 1024)}KB)\n\n[⬇ Baixar PDF](${downloadPath})`
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'doc', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'doc', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: 'doc', action: 'generate', confidence: 1.0, tokensUsed: 0, sessionId }
        } catch (err) {
          const errReply = `Erro ao gerar documento: ${(err as Error).message}`
          return { reply: errReply, module: 'doc', action: 'generate', confidence: 1.0, tokensUsed: 0, sessionId }
        }
      }
    }

    const actionResponse = decisao === 'aprovado' || decisao === 'rejeitado'
    if (actionResponse) {
      const lastMsg = await this.lastAssistantMessage(sessionId)
      const actionMatch = lastMsg?.content?.match(/\[ACTION_PENDING:([A-Za-z0-9+/=]+)\]/)
      if (actionMatch) {
        if (decisao === 'rejeitado') {
          const reply = 'Ação cancelada. Nada foi executado.'
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: 'jarvis', action: 'cancel', confidence: 1, tokensUsed: 0, sessionId }
        }

        const pending = this.decodePendingAction(actionMatch[1])
        return this.executeJarvisAction(pending.action, pending.payload, pending.prompt, sessionId, projectId)
      }
    }

    // 1. Validar prompt antes de qualquer processamento
    this.validation.assertValidPrompt(prompt)

    // 1b. Detectar intenção de sessão supervisionada
    if (this.isSupervisedSessionRequest(prompt) && projectId) {
      const session = await this.agentSession.create(projectId, prompt)
      const reply = `▶️ Sessão supervisionada iniciada (\`${session.id}\`).\nVocê receberá atualizações no Telegram. Pode fechar o PC.`
      await this.prisma.conversationMessage.createMany({
        data: [
          { sessionId, module: 'system', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
          { sessionId, module: 'system', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
        ],
      })
      return { reply, module: 'system', action: 'start_supervised_session', confidence: 1, tokensUsed: 0, sessionId }
    }

    // 2. Classificar intent
    const classify = await this.classify(prompt)

    // 2. Rotear para Brain se necessário
    if (classify.module === 'brain') {
      try {
        const result = await this.memory.searchAndSynthesize(prompt, sessionId, escopoDeBusca(projectId))
        this.extractAndIndex(prompt, result.answer, projectId)
        return {
          reply: result.answer,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: result.tokensUsed,
          sessionId,
        }
      } catch (err) {
        const reply = `Não consegui consultar o Brain agora: ${(err as Error).message}. Não vou responder com base em suposição.`
        await this.prisma.conversationMessage.createMany({
          data: [
            { sessionId, module: 'brain', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
            { sessionId, module: 'brain', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
          ],
        })
        return {
          reply,
          module: 'brain',
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: 0,
          sessionId,
        }
        // Fallback para chat normal se embeddings não estiverem disponíveis
      }
    }

    // 3. Rotear para Jarvis se necessário
    if (classify.module === 'jarvis') {
      // Pedido para agir DEPOIS não tem mecanismo: `jarvis:notify` recebe `{title, message}` e
      // dispara na hora, e não existe agendador em lugar nenhum da API. Sem esta recusa, "me
      // notifica daqui 10 min" executava imediatamente e a resposta dava a entender que ficou
      // agendado — ver `pedido-agendado.ts`.
      const futuro = pedeAcaoNoFuturo(prompt)
      if (futuro) {
        // ── Agendar, quando a hora é sem ambiguidade ────────────────────────
        //
        // Até 16/09 TODO pedido de futuro era recusado, porque não havia mecanismo. Havia: a fila
        // do Bull aceita `delay` desde sempre, e eu não tinha olhado a infraestrutura que a
        // plataforma já usa — só o código dela. O que faltava era `jaEstaNaHora()` no claim, sem
        // o qual o job atrasado seria reivindicado na hora.
        //
        // Só formas RELATIVAS agendam. Horário de relógio exigiria o fuso do usuário, que não
        // existe no modelo de dados, e errar por três horas é pior que recusar — ver
        // `pedido-agendado.ts`.
        const quando = atrasoDoPedido(prompt)
        if (quando) {
          try {
            const payloadBase = buildJarvisPayload(classify.action, prompt)
            const payloadFinal = await this.enrichJarvisPayload(classify.action, payloadBase, projectId, prompt)
            const jobId = await this.execution.enqueue(classify.action, payloadFinal, quando.ms)
            const emMinutos = Math.round(quando.ms / 60_000)
            const reply =
              `Agendado: **${this.formatActionValue(classify.action)}** em ${emMinutos} min ` +
              `(pedido: "${quando.trecho}").

Id da tarefa: \`${jobId}\`. ` +
              `A execução acontece na máquina, não nesta conversa — o resultado não volta aqui automaticamente.`
            await this.prisma.conversationMessage.createMany({
              data: [
                { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
                { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
              ],
            })
            return { reply, module: 'jarvis', action: classify.action, confidence: classify.confidence, tokensUsed: 0, sessionId }
          } catch (err) {
            // Agent offline, ação desconhecida: dizer o que houve, nunca prometer o agendamento.
            const reply = `Não consegui agendar: ${(err as Error).message}`
            return { reply, module: 'jarvis', action: 'sem_agendador', confidence: 1, tokensUsed: 0, sessionId }
          }
        }

        // Entendeu o pedido, não a hora — a recusa diz qual das duas faltou.
        const reply = respostaSemAgendadorAbsoluto(futuro)
        await this.prisma.conversationMessage.createMany({
          data: [
            { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
            { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
          ],
        })
        return { reply, module: 'jarvis', action: 'sem_agendador', confidence: 1, tokensUsed: 0, sessionId }
      }

      try {
        const baseJarvisPayload = buildJarvisPayload(classify.action, prompt)
        const jarvisPayload = await this.enrichJarvisPayload(classify.action, baseJarvisPayload, projectId, prompt)
        if (this.requiresConfirmation(classify.action)) {
          const risk = this.actionRisk(classify.action) as 'medium' | 'high'
          const encoded = this.encodePendingAction({ action: classify.action, payload: jarvisPayload, prompt, risk })
          const reply = this.buildPendingActionReply(classify.action, jarvisPayload, risk, encoded)
          await this.prisma.conversationMessage.createMany({
            data: [
              { sessionId, module: 'jarvis', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
              { sessionId, module: 'jarvis', role: 'assistant', content: reply, tokensUsed: 0, projectId, workMode: workMode ?? null },
            ],
          })
          return { reply, module: classify.module, action: classify.action, confidence: classify.confidence, tokensUsed: 0, sessionId }
        }
        const result = await this.execution.dispatch(classify.action, jarvisPayload)
        const directReply = this.buildDirectJarvisReply(classify.action, result)
        if (directReply) {
          return {
            reply: directReply,
            module: classify.module,
            action: classify.action,
            confidence: classify.confidence,
            tokensUsed: 0,
            sessionId,
          }
        }
        // Sintetiza resposta natural a partir do resultado
        const jarvisSynthStart = Date.now()
        const synthesis = await this.llm.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Você é Rayzen, assistente pessoal. O PC Agent executou uma tarefa e retornou dados.
Vá direto ao ponto — apresente os dados imediatamente, sem frases introdutórias como "Olá", "Claro", "Com prazer" ou "Estou aqui para ajudar".
Seja direto, claro e amigável. Português brasileiro. Sem JSON bruto.`,
            },
            {
              role: 'user',
              content: `Pedido original: "${prompt}"\nDados retornados: ${JSON.stringify(result, null, 2)}`,
            },
          ],
          temperature: 0.4,
        })
        const jarvisTokens = synthesis.usage?.total_tokens ?? 0
        this.metrics.llmTokensTotal.inc({ module: 'orchestrator', model: 'gpt-4o-mini' }, jarvisTokens)
        this.metrics.llmRequestDuration.observe({ module: 'orchestrator', model: 'gpt-4o-mini' }, (Date.now() - jarvisSynthStart) / 1000)
        return {
          reply: synthesis.choices[0].message.content ?? JSON.stringify(result),
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: jarvisTokens,
          sessionId,
        }
      } catch (err) {
        return {
          reply: `Não consegui executar a tarefa: ${(err as Error).message}`,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: 0,
          sessionId,
        }
      }
    }

    // 4. Rotear para Content se necessário
    if (classify.module === 'content') {
      try {
        const isDiagram = classify.action === 'diagram' || /diagrama|mermaid|fluxo|flowchart|sequence diagram|arquitetura visual/i.test(prompt)
        if (isDiagram) {
          const result = await this.contentEngine.generateDiagram(prompt, sessionId)
          const reply = `**Diagrama (${result.type})**\n\n\`\`\`mermaid\n${result.diagram}\n\`\`\``
          return {
            reply,
            module: classify.module,
            action: 'diagram',
            confidence: classify.confidence,
            tokensUsed: result.tokensUsed,
            sessionId,
          }
        }

        const isCalendar = classify.action === 'calendar' || prompt.toLowerCase().includes('calendário')
        if (isCalendar) {
          const result = await this.contentEngine.generateCalendar(prompt, 7, sessionId)
          const formatted = result.entries
            .map((e) => `Dia ${e.day} — ${e.format.toUpperCase()}: ${e.theme}\n↳ ${e.hook}`)
            .join('\n\n')
          return {
            reply: `Calendário editorial (${result.period}):\n\n${formatted}`,
            module: classify.module,
            action: classify.action,
            confidence: classify.confidence,
            tokensUsed: result.tokensUsed,
            sessionId,
          }
        }

        const type = (['post', 'thread', 'article'].includes(classify.action) ? classify.action : 'post') as 'post' | 'thread' | 'article'
        const result = await this.contentEngine.generate(type, prompt, 'professional', sessionId)
        return {
          reply: result.content,
          module: classify.module,
          action: classify.action,
          confidence: classify.confidence,
          tokensUsed: result.tokensUsed,
          sessionId,
        }
      } catch {
        // Fallback para chat normal
      }
    }

    // 5. Rotear para Doc se necessário — pede confirmação antes de gerar
    if (classify.module === 'doc') {
      const tema = prompt.length > 100 ? prompt.slice(0, 100) + '…' : prompt
      const encoded = Buffer.from(prompt).toString('base64')
      const previewReply = `Vou gerar um documento sobre: **${tema}**\n\nResponda **confirmar** para prosseguir, ou detalhe o que precisa diferente.\n\n[DOC_PENDING:${encoded}]`
      await this.prisma.conversationMessage.createMany({
        data: [
          { sessionId, module: 'doc', role: 'user', content: prompt, projectId, workMode: workMode ?? null },
          { sessionId, module: 'doc', role: 'assistant', content: previewReply, tokensUsed: 0, projectId, workMode: workMode ?? null },
        ],
      })
      return {
        reply: previewReply,
        module: classify.module,
        action: classify.action,
        confidence: classify.confidence,
        tokensUsed: 0,
        sessionId,
      }
    }

    // 4. Carregar histórico da sessão
    const history = await this.janelaDeHistorico(sessionId, projectId)

    const historyMessages: ChatMessage[] = history.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    // 3. Gerar resposta com contexto do módulo + work mode + projeto + brain
    const [basePromptStr, projectCtx, brainResults] = await Promise.all([
      Promise.resolve(this.getSystemPrompt(classify.module)),
      this.getProjectContext(projectId),
      consultarFonte('a memoria semantica',
        // `escopoDeBusca` devolve `undefined` no geral — de proposito e POR VALOR: e o que faz a
        // busca varrer o acervo inteiro, que e a razao de o contexto geral existir. Passar o id do
        // Geral aqui traria so o que foi dito dentro dele, que e quase nada.
        () => this.memory.search(prompt, 4, escopoDeBusca(projectId)),
        [] as import('../memory/memory.service').SearchResult[], (v) => v.length === 0),
    ])
    const modeConfig = getWorkModeConfig(workMode)
    let systemPrompt = basePromptStr + projectCtx
    if (modeConfig) systemPrompt += modeConfig.systemPromptSuffix

    // O bloco já delimitava e já trazia `sourcePath`, mas dizia só "use como referência" — que não
    // é a mesma coisa que "isto não é ordem". `blocoDeTrechosDeTerceiro` é a fronteira única das
    // duas apps; ver `memory/trecho-de-terceiro.const.ts`.
    const brainCtx = blocoDeTrechosDeTerceiro(await this.comDominio(brainResults.valor.filter(r => r.score > 0.5)), !ehEscopoGeral(projectId))
    if (brainCtx) systemPrompt += `\n\n${brainCtx}`
    // Busca que FALHOU nao pode parecer acervo vazio: sem isto, um erro de embedding ou do
    // pgvector faz o modelo responder como se nao houvesse nada indexado sobre o assunto.
    systemPrompt += avisoDeFontesIndisponiveis([brainResults])

    const messages: ChatMessage[] = [...historyMessages, { role: 'user', content: prompt }]

    const chatStart = Date.now()
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    })

    const reply = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0
    this.metrics.llmTokensTotal.inc({ module: 'orchestrator', model: 'gpt-4o' }, tokensUsed)
    this.metrics.llmRequestDuration.observe({ module: 'orchestrator', model: 'gpt-4o' }, (Date.now() - chatStart) / 1000)

    // 4. Salvar mensagens no banco
    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: classify.module, role: 'user', content: prompt, projectId, workMode: workMode ?? null },
        { sessionId, module: classify.module, role: 'assistant', content: reply, tokensUsed, projectId, workMode: workMode ?? null },
      ],
    })

    // 5. Extrair e indexar memória em background (sem bloquear resposta)
    this.extractAndIndex(prompt, reply, projectId)

    // 6. Emitir evento de chat
    this.eventService.create({
      projectId,
      source: 'chat',
      type: 'message',
      content: prompt,
      metadata: { module: classify.module, action: classify.action, sessionId, tokensUsed },
    }).catch(() => null)

    return {
      reply,
      module: classify.module,
      action: classify.action,
      confidence: classify.confidence,
      tokensUsed,
      sessionId,
    }
  }

  async classify(prompt: string): Promise<ClassifyResult> {
    const deterministic = this.classifyDeterministic(prompt)
    if (deterministic) return deterministic

    if (this.isHowToQuestion(prompt)) {
      return { module: 'system', action: 'answer', confidence: 0.95 }
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Você é um classificador de intenções. Responda APENAS em JSON.
Módulos disponíveis:
- jarvis: executar tarefas no PC local — abrir apps, listar arquivos, organizar downloads, obter info do sistema (CPU, RAM, disco, SO), capturar screenshot
- content: criar conteúdo — posts, threads, artigos, calendário editorial
- doc: gerar documentos — PDFs, DOCXs, contratos, propostas, relatórios
- brain: memória e busca — indexar, pesquisar, resumir notas e documentos
- system: perguntas sobre o assistente, saudações, o que você pode fazer

Ações do jarvis disponíveis: open_app, open_url, open_vscode, create_project_folder, list_dir, file_search, organize_downloads, get_system_info, screenshot, notify, clipboard_read, clipboard_write, git_status, git_log, git_branch, git_commit, run_command, run_tests, inspect_schema, docker_ps, docker_start, docker_stop, docker_logs, read_emails, send_email, get_calendar, restart_api, parse_test_report, get_qa_summary
Ações do content disponíveis: post, thread, article, calendar, diagram
Exemplos jarvis: "qual o status do PC", "abra o chrome", "liste os downloads", "coloca música no youtube", "leia meus emails", "manda email para X", "abre o vscode", "crie projeto meu-app nextjs", "tira um screenshot", "tire um print da tela: teste de API 52", "captura de tela do erro", "notifica: build terminou", "lê minha área de transferência", "git status do projeto X", "quais commits recentes", "cria branch feature/Y", "roda os testes do projeto X", "lista containers docker", "mostra os logs do container rayzen-ai-api-1", "para o container redis", "minha agenda de hoje", "procura arquivo relatorio.pdf", "mostra o schema do banco", "inspeciona o schema prisma", "reinicia a API na VPS", "restart api", "atualiza e reinicia o servidor", "analisa o relatório de testes em C:/projetos/report.xml", "parseia o resultado dos testes junit", "lê o relatório allure e mostra as falhas", "como estão os testes?", "quais testes estão falhando mais?", "tem algum teste flaky?", "mostra a tendência de qualidade dos testes", "qual o status da suíte de testes?", "como está a qualidade dos dados?", "verifica qualidade da tabela clientes", "quais regras de qualidade estão falhando?", "score de qualidade do dataset pedidos", "tem dados nulos na tabela produtos?", "mostra histórico de qualidade dos dados"
Exemplos content: "crie um post sobre X", "escreva uma thread sobre Y", "faça um artigo sobre Z", "crie um calendário editorial", "gere um diagrama da arquitetura", "desenhe o fluxo entre API e Agent", "crie um sequence diagram do chat"
Exemplos brain: "qual minha profissão?", "o que você sabe sobre mim?", "qual meu nome?", "o que eu te disse sobre X?", "me fale sobre meus projetos"
Exemplos system: "quem é você", "o que você pode fazer", "olá", "como você funciona", "meu nome é X", "trabalho como Y", "sou Z", "me chamo X", afirmações e apresentações pessoais do usuário

Formato da resposta: { "module": "...", "action": "...", "confidence": 0.0-1.0 }`,
      },
      { role: 'user', content: prompt },
    ]
    const classifyStart = Date.now()
    const res = await this.llm.chat.completions.create({
      model: 'gpt-local',
      messages,
      temperature: 0,
    })
    this.metrics.llmTokensTotal.inc({ module: 'orchestrator', model: 'gpt-local' }, res.usage?.total_tokens ?? 0)
    this.metrics.llmRequestDuration.observe({ module: 'orchestrator', model: 'gpt-local' }, (Date.now() - classifyStart) / 1000)
    const parsed = this.parseLlmJson<ClassifyResult>(
      res.choices[0].message.content,
      { module: 'system', action: 'answer', confidence: 0.1 },
      'classify',
    )
    if (parsed.module === 'jarvis' && !this.isExplicitExecutionRequest(prompt)) {
      return { module: 'system', action: 'answer', confidence: 0.9 }
    }
    return parsed
  }


  private buildPendingActionReply(
    action: string,
    payload: Record<string, unknown>,
    risk: 'medium' | 'high',
    encoded: string,
  ): string {
    if (action === 'screenshot') {
      const description = this.asDisplayValue(payload.description)
      const projectName = this.asDisplayValue(payload.projectName)
      const category = this.asDisplayValue(payload.category)
      const label = this.asDisplayValue(payload.label)
      const lines = [
        'Vou preparar uma evid\u00eancia de QA para este teste.',
        '',
        '**Fluxo QA:** Captura de tela -> Evid\u00eancia -> Documenta\u00e7\u00e3o de testes',
        '**A\u00e7\u00e3o:** Screenshot',
      ]
      if (projectName) lines.push(`**Projeto:** ${projectName}`)
      if (description) lines.push(`**Teste/descri\u00e7\u00e3o:** ${description}`)
      if (category) lines.push(`**Categoria:** ${this.formatActionValue(category)}`)
      if (label) lines.push(`**Nome sugerido:** ${label}`)
      lines.push(
        '**V\u00ednculo TestRun:** ser\u00e1 associado automaticamente ao TestRun recente do projeto, quando existir.',
        '**Ap\u00f3s confirmar:** a imagem deve ser salva, enviada para evid\u00eancias e aparecer na documenta\u00e7\u00e3o de testes.',
        '',
        'Confirme para executar ou cancele para abortar.',
        '',
        `[ACTION_PENDING:${encoded}]`,
      )
      return lines.join('\n')
    }

    const lines = [
      `Vou executar uma a\u00e7\u00e3o local (${risk === 'high' ? 'alto risco' : 'risco m\u00e9dio'}).`,
      '',
      `**A\u00e7\u00e3o:** ${this.formatActionValue(action)}`,
      ...this.formatPayloadSummary(payload),
      '',
      'Confirme para executar ou cancele para abortar.',
      '',
      `[ACTION_PENDING:${encoded}]`,
    ]
    return lines.join('\n')
  }

  private formatPayloadSummary(payload: Record<string, unknown>): string[] {
    const hidden = new Set(['projectId', 'prompt'])
    return Object.entries(payload)
      .filter(([key, value]) => !hidden.has(key) && value !== undefined && value !== null && value !== '')
      .slice(0, 6)
      .map(([key, value]) => `**${this.formatActionValue(key)}:** ${this.asDisplayValue(value) ?? String(value)}`)
  }

  private asDisplayValue(value: unknown): string | null {
    if (value === undefined || value === null) return null
    if (typeof value === 'string') return value.trim() || null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
  }

  private formatActionValue(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
  }

  private async executeJarvisAction(
    action: string,
    payload: Record<string, unknown>,
    prompt: string,
    sessionId: string,
    projectId?: string,
  ): Promise<OrchestrateResult> {
    const result = await this.execution.dispatch(action, payload)
    const directReply = this.buildDirectJarvisReply(action, result)
    if (directReply) {
      return {
        reply: directReply,
        module: 'jarvis',
        action,
        confidence: 1,
        tokensUsed: 0,
        sessionId,
      }
    }
    const synthesis = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Você é Rayzen, assistente pessoal. O PC Agent executou uma tarefa e retornou dados.
Vá direto ao ponto — apresente os dados imediatamente, sem frases introdutórias como “Olá”, “Claro”, “Com prazer” ou “Estou aqui para ajudar”.
Seja direto, claro e amigável. Português brasileiro. Sem JSON bruto.`,
        },
        {
          role: 'user',
          content: `Pedido original: "${prompt}"\nDados retornados: ${JSON.stringify(result, null, 2)}`,
        },
      ],
      temperature: 0.4,
    })

    return {
      reply: synthesis.choices[0].message.content ?? JSON.stringify(result),
      module: 'jarvis',
      action,
      confidence: 1,
      tokensUsed: synthesis.usage?.total_tokens ?? 0,
      sessionId,
    }
  }

  private buildDirectJarvisReply(action: string, result: unknown): string | null {
    if (action !== 'screenshot') return null
    const screenshot = result as {
      path?: string
      takenAt?: string
      upload?: { url?: string }
    }
    const fileName = screenshot.path?.split(/[\\/]/).pop()
    const lines = [
      screenshot.path ? `Print salvo: \`${fileName ?? screenshot.path}\`.` : 'Print capturado.',
    ]
    if (screenshot.upload?.url) {
      lines.push(`[Abrir evidência](${screenshot.upload.url})`)
    }
    return lines.join('\n\n')
  }

  private async enrichJarvisPayload(
    action: string,
    payload: Record<string, unknown>,
    projectId?: string,
    prompt?: string,
  ): Promise<Record<string, unknown>> {
    if (action !== 'screenshot' || !projectId) return payload

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, repoSlug: true },
    })

    return project?.name
      ? {
          ...payload,
          projectId,
          projectName: project.name,
          projectFolder: project.repoSlug ?? project.name,
          prompt,
        }
      : { ...payload, projectId, prompt }
  }

  private isSupervisedSessionRequest(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase()
    return /\b(supervisionar|supervise|executar sem minha presen[çc]a|implementar autonomamente|rodar (o )?claude no background|claude no background|modo aut[oô]nomo)\b/.test(normalized)
  }

  private classifyDeterministic(prompt: string): ClassifyResult | null {
    if (this.isHowToQuestion(prompt)) return null

    const normalized = prompt.trim().toLowerCase()

    const screenshotCommand =
      /\b(tir[ae]|tirar|captur[ae]|capturar|capture|faz|fa\u00e7a|faca)\b.*\b(print|screenshot|captura de tela|foto da tela)\b/.test(normalized)
      || /\b(print|screenshot|captura de tela|foto da tela)\b.*\b(tela|screen|erro|bug|teste|evid\u00eancia|evidencia|evidence)\b/.test(normalized)

    if (screenshotCommand) {
      return { module: 'jarvis', action: 'screenshot', confidence: 1 }
    }

    return null
  }

  private isHowToQuestion(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase()
    if (!normalized.includes('?')) return false

    return /^(como|qual|quais|quando|onde|por que|porque|me explica|explique)\b/.test(normalized)
      || /\b(como devo|como eu devo|como fa[cç]o|qual seria|qual [ée] a ordem|me orienta|me ensina)\b/.test(normalized)
  }

  private isExplicitExecutionRequest(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase()
    if (this.isHowToQuestion(prompt)) return false

    return /\b(abra|abre|abrir|liste|lista|listar|crie|cria|criar|rode|roda|rodar|execute|executa|tira|tire|tirar|capture|captura|capturar|notifica|copie|copia|cole|cola|leia|lê|manda|envia|pare|para|inicia|start|stop|reinicia|reiniciar|reinicie|restart|procura|busca|encontra|organiza|inspeciona|atualiza|atualizar)\b/.test(normalized)
      || /\b(git status|git log|git commit|branch|docker|screenshot|print da tela|captura de tela|clipboard|restart[_ ]api|reiniciar[_ ]api)\b/.test(normalized)
      || /\b(qual|quais|mostra|minha|meus|minhas)\b.*\b(status do pc|status do computador|info do sistema|commits recentes|agenda|emails|schema)\b/.test(normalized)
  }

  private async extractAndIndex(prompt: string, reply: string, projectId?: string): Promise<void> {
    try {
      const res = await this.llm.chat.completions.create({
        model: 'gpt-local',
        messages: [
          {
            role: 'system',
            content: `Você é um extrator de memória. Analise a mensagem do usuário e responda em JSON.
Se o usuário revelou informações pessoais relevantes (nome, profissão, cidade, projeto, preferência, habilidade, objetivo), retorne:
{ "hasMemory": true, "content": "frase curta descrevendo o fato em 3ª pessoa", "sourcePath": "memoria/auto" }
Se não há informação relevante para memorizar, retorne:
{ "hasMemory": false }
Seja criterioso — não memorize perguntas, comandos ou respostas genéricas.`,
          },
          { role: 'user', content: `Mensagem do usuário: "${prompt}"` },
        ],
        temperature: 0,
      })

      const extracted = this.parseLlmJson<{ hasMemory: boolean; content?: string; sourcePath?: string }>(
        res.choices[0].message.content,
        { hasMemory: false },
        'extractAndIndex',
      )
      if (extracted.hasMemory && extracted.content) {
        console.log('[extractAndIndex] indexando:', extracted.content)
        await this.memory.indexDocument(extracted.content, extracted.sourcePath ?? 'memoria/auto', {
          auto: true,
          originalPrompt: prompt.slice(0, 100),
        }, projectId)
      }
    } catch (err) {
      console.error('[extractAndIndex] falhou:', (err as Error).message)
    }
  }

  /**
   * ── A07 da auditoria de 13/09: a janela do histórico ─────────────────────────
   *
   * Era `orderBy: { createdAt: 'asc' }, take: 20` — as **vinte PRIMEIRAS** mensagens da sessão.
   * Numa conversa curta, indistinguível do correto. Passando de vinte, o prompt congelava no
   * começo do papo e **ignorava tudo o que foi dito depois**: uma instrução que substituísse
   * outra nunca chegava ao modelo, e a correção mais recente era exatamente a que ficava de
   * fora.
   *
   * Buscar `desc` e reverter devolve as vinte ÚLTIMAS em ordem cronológica — que é o que o
   * prompt precisa, nas duas pontas (chat comum e streaming).
   *
   * Uma função só para os dois chamadores: eram duas cópias idênticas do mesmo `findMany`, e
   * consertar uma delas deixaria a outra errada em silêncio.
   */
  private async janelaDeHistorico(
    sessionId: string,
    projectId?: string,
  ): Promise<{ role: string; content: string }[]> {
    const recentes = await this.prisma.conversationMessage.findMany({
      where: { sessionId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: JANELA_DE_HISTORICO,
    })
    return recentes.reverse()
  }

  async streamChat(prompt: string, sessionId: string, module: string, onToken: (token: string) => void, projectId?: string, workMode?: string): Promise<void> {
    const history = await this.janelaDeHistorico(sessionId, projectId)

    const historyMessages: ChatMessage[] = history.map((m: { role: string; content: string }) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const [basePrompt, projectCtx, brainResults] = await Promise.all([
      Promise.resolve(this.getSystemPrompt(module)),
      this.getProjectContext(projectId),
      consultarFonte('a memoria semantica',
        // `escopoDeBusca` devolve `undefined` no geral — de proposito e POR VALOR: e o que faz a
        // busca varrer o acervo inteiro, que e a razao de o contexto geral existir. Passar o id do
        // Geral aqui traria so o que foi dito dentro dele, que e quase nada.
        () => this.memory.search(prompt, 4, escopoDeBusca(projectId)),
        [] as import('../memory/memory.service').SearchResult[], (v) => v.length === 0),
    ])
    const modeConfig = getWorkModeConfig(workMode)
    let systemPrompt = basePrompt + projectCtx
    if (modeConfig) systemPrompt += modeConfig.systemPromptSuffix

    // O bloco já delimitava e já trazia `sourcePath`, mas dizia só "use como referência" — que não
    // é a mesma coisa que "isto não é ordem". `blocoDeTrechosDeTerceiro` é a fronteira única das
    // duas apps; ver `memory/trecho-de-terceiro.const.ts`.
    const brainCtx = blocoDeTrechosDeTerceiro(await this.comDominio(brainResults.valor.filter(r => r.score > 0.5)), !ehEscopoGeral(projectId))
    if (brainCtx) systemPrompt += `\n\n${brainCtx}`
    // Busca que FALHOU nao pode parecer acervo vazio: sem isto, um erro de embedding ou do
    // pgvector faz o modelo responder como se nao houvesse nada indexado sobre o assunto.
    systemPrompt += avisoDeFontesIndisponiveis([brainResults])

    const messages: ChatMessage[] = [...historyMessages, { role: 'user', content: prompt }]

    const stream = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
      stream: true,
    })

    let fullReply = ''
    let tokensUsed = 0

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (token) {
        fullReply += token
        onToken(token)
      }
      if (chunk.usage) tokensUsed = chunk.usage.total_tokens
    }

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module, role: 'user', content: prompt, projectId, workMode: workMode ?? null },
        { sessionId, module, role: 'assistant', content: fullReply, tokensUsed, projectId, workMode: workMode ?? null },
      ],
    })

    // Extrair e indexar memória em background
    this.extractAndIndex(prompt, fullReply, projectId)

    // Emitir evento de chat
    this.eventService.create({
      projectId,
      source: 'chat',
      type: 'message',
      content: prompt,
      metadata: { module, sessionId, tokensUsed },
    }).catch(() => null)
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    })
    return res.choices[0].message.content ?? ''
  }
}
