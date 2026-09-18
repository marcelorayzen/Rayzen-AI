import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ProjectService } from '../project/project.service'
import { ProjectStateService } from '../project-state/project-state.service'
import { GraphService } from '../graph/graph.service'
import { PendingReplyService } from '../agent-session/pending-reply.service'
import { SessionService } from '../session/session.service'

/** Teto de caracteres por mensagem do Telegram, com margem. */
export const TELEGRAM_MAX_CHARS = 4000

/**
 * Dito quando a resposta saiu sem projeto selecionado. Precisa nomear a CONSEQUÊNCIA
 * ("sem contexto") e não só o estado ("sem projeto") — quem lê tem que entender por que
 * a resposta veio pobre, e o que fazer a respeito.
 */
export const AVISO_SEM_PROJETO =
  '⚠️ Respondido SEM contexto de projeto — nenhum está selecionado. Use /projeto para escolher.'

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name)
  private readonly token: string
  private readonly chatId: string
  private readonly baseUrl: string
  private readonly apiUrl: string
  private offset = 0
  private pollTimer: NodeJS.Timeout | null = null
  /** Seleções pendentes dos fluxos do próprio Telegram (`/projeto`, `/autorizar`), por origem. */
  private readonly replyHandlers = new Map<string, (text: string) => void>()

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly projectSvc: ProjectService,
    private readonly stateSvc: ProjectStateService,
    private readonly graphSvc: GraphService,
    // A06: resolve para qual sessão supervisionada vai uma resposta, consultando o estado
    // persistido. Serviço próprio (não `AgentSessionService`) para não fechar ciclo de módulos.
    private readonly pendingReply: PendingReplyService,
    // A política de "em qual conversa escrever" é uma só, do servidor — ver `janela-de-sessao.ts`.
    private readonly sessionSvc: SessionService,
  ) {
    this.token  = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? ''
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID')  ?? ''
    this.baseUrl = `https://api.telegram.org/bot${this.token}`
    // Call orchestrate via HTTP to avoid circular dependency with OrchestratorModule
    const port = this.config.get<string>('API_PORT') ?? '3001'
    this.apiUrl = `http://localhost:${port}`
  }

  onModuleInit() {
    if (!this.token || !this.chatId) {
      this.logger.warn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — Telegram disabled')
      return
    }
    this.startPolling()
  }

  onModuleDestroy() {
    if (this.pollTimer) clearTimeout(this.pollTimer)
  }

  /**
   * ── A06: handler por CHAT+TÓPICO, nunca global ─────────────────────────────
   *
   * Era um campo único (`private replyHandler`), consultado em `processUpdate` **antes de
   * qualquer roteamento**. Com ele armado, toda mensagem de todo chat autorizado era desviada —
   * conversa normal com o orquestrador incluída, em qualquer projeto ou tópico. E quem
   * perguntasse por último apagava a pergunta de quem perguntou antes.
   *
   * Agora a chave é a origem da mensagem: uma seleção pendente em `/projeto` no chat privado não
   * enxerga nem consome o que é escrito num tópico de supergrupo.
   */
  private chaveDeOrigem(chatId: string, threadId: string): string {
    return `${chatId}:${threadId}`
  }

  setReplyHandler(handler: (text: string) => void, chatId: string, threadId = '') {
    this.replyHandlers.set(this.chaveDeOrigem(chatId, threadId), handler)
  }

  clearReplyHandler(chatId: string, threadId = '') {
    this.replyHandlers.delete(this.chaveDeOrigem(chatId, threadId))
  }

  // ─── Send ────────────────────────────────────────────────────────────────────

  /**
   * `threadId` e o terceiro parametro, opcional, de proposito: `agent-session.service` e
   * outros chamam `send(texto)` e `send(texto, chatId)`. Mudar a ordem ou tornar
   * obrigatorio quebraria quem ja chama.
   *
   * Sem `message_thread_id`, a resposta a uma mensagem de topico cai no topico Geral do
   * supergrupo — a pergunta fica num lugar e a resposta em outro.
   */
  async send(text: string, chatId?: string, threadId?: string): Promise<void> {
    if (!this.token) return
    const target = chatId ?? this.chatId
    if (!target) return
    try {
      await fetch(`${this.baseUrl}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: target,
          text: text.slice(0, 4096),
          parse_mode: 'Markdown',
          ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        }),
      })
    } catch (err) {
      this.logger.error('Telegram send failed', err)
    }
  }

  async sendPhoto(imageUrl: string, caption: string): Promise<void> {
    if (!this.token || !this.chatId) return
    try {
      await fetch(`${this.baseUrl}/sendPhoto`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, photo: imageUrl, caption }),
      })
    } catch (err) {
      this.logger.error('Telegram sendPhoto failed', err)
    }
  }

  // ─── Session ─────────────────────────────────────────────────────────────────

  /**
   * Decide se o bot atende este chat, e registra quem bateu na porta.
   *
   * Até 2026-09-06 a autorização era `fromId !== TELEGRAM_CHAT_ID`: um valor único, e a
   * única barreira entre um estranho e o `/orchestrate` inteiro. Aceitar mais de um chat
   * sem substituir isso seria aceitar todos.
   *
   * O chat da variável de ambiente continua sendo a **raiz de confiança** e nunca depende
   * do banco — assim uma linha apagada por engano não tranca o dono para fora.
   *
   * Chat desconhecido é registrado e **não respondido**. O silêncio é deliberado: uma
   * recusa educada confirmaria que existe um bot ali. E o registro existe porque, sem
   * ele, descobrir o `chatId` de um grupo novo exigiria ler log de servidor — a linha
   * aparece em `/autorizar` para o dono liberar de dentro do chat raiz.
   */
  private async chatAutorizado(chatId: string, titulo?: string): Promise<boolean> {
    if (chatId === this.chatId) return true

    const existente = await this.prisma.telegramChat.findUnique({ where: { chatId } })

    // Chat nunca visto: registra e AVISA O DONO, uma única vez.
    //
    // Não responder ao desconhecido é a proteção, e continua valendo — o que faltava era dizer
    // que existe algo a decidir. Sem o aviso, o silêncio é indistinguível de bot quebrado: foi
    // assim que apareceu em 14/09 ("criei o grupo, mandei /projeto e nada"), porque nem comando
    // é atendido antes da autorização.
    //
    // O aviso vai só na PRIMEIRA vez: um chat insistente viraria fonte de spam no chat do dono.
    if (!existente) {
      await this.prisma.telegramChat.create({ data: { chatId, title: titulo ?? null } })
      await this.send(
        `🔔 *Chat novo pediu acesso*\n\n${titulo ?? '(sem título)'} — \`${chatId}\`\n\n` +
        'Ele não é atendido enquanto não for liberado. Use /autorizar aqui para liberar.',
        this.chatId,
      )
      return false
    }

    if (titulo && titulo !== existente.title) {
      await this.prisma.telegramChat.update({ where: { chatId }, data: { title: titulo } })
    }
    return existente.authorized
  }

  /**
   * A linha do chat — que é o **vínculo com o projeto**, não mais a identidade da conversa.
   *
   * `session_id` continua na tabela e deixou de ser usado para escrever: ele era criado uma vez
   * por `(chatId, threadId)` e **nunca rotacionava**, então um chat era uma sessão eterna — a mais
   * antiga aqui é de 31/05. O extremo oposto do defeito da web, que cunhava um id a cada
   * carregamento de página.
   *
   * Quem decide agora é `sessaoAtual()`, a mesma política que a web consulta. É isso que faz a
   * conversa atravessar: perguntar no celular e continuar na web passa a cair no mesmo fio,
   * porque os dois fazem a mesma pergunta ao mesmo lugar.
   *
   * A coluna fica (sem migração): ela ainda identifica a linha e some sem aviso se alguém a
   * reaproveitar. O que mudou é quem a lê.
   */
  private async getOrCreateSession(chatId: string, threadId = '') {
    return this.prisma.telegramSession.upsert({
      where:  { telegramChatId_threadId: { telegramChatId: chatId, threadId } },
      create: { telegramChatId: chatId, threadId },
      update: {},
    })
  }

  /**
   * O fio em que este chat escreve agora, pela política compartilhada.
   *
   * Nunca lança: sem isto, uma falha de leitura no banco deixaria o bot mudo. Cair no
   * `session_id` da linha do chat é a degradação certa — é exatamente o comportamento de antes
   * desta mudança, então o pior caso é voltar ao que já funcionava.
   */
  private async fioDaConversa(session: { sessionId: string; projectId: string | null }): Promise<string> {
    try {
      const { sessionId } = await this.sessionSvc.sessaoAtual(session.projectId ?? null)
      return sessionId
    } catch {
      return session.sessionId
    }
  }

  /**
   * Diz quando a resposta saiu SEM contexto de projeto.
   *
   * Os quatro comandos (`/status`, `/goal`, `/eventos`, `/checkpoint`) já guardavam com
   * `if (!pid)`. O texto livre — que é o caminho usado o tempo todo — não guardava: ele
   * chamava `orchestrate` com `projectId` indefinido e `getProjectContext` devolvia
   * string vazia. O resultado é pior que um erro: a conversa responde **como se
   * soubesse**, sem objetivo, memória, eventos nem políticas, e nada denuncia.
   *
   * Medido em 2026-09-05. Os caminhos protegidos eram os raros; o desprotegido, o comum.
   *
   * Avisa em vez de recusar: nem toda mensagem precisa de projeto, e bloquear quebraria
   * o uso casual. O aviso não vira ruído permanente porque se extingue no instante em
   * que alguém escolhe um projeto — ao contrário de um alerta sobre algo que não se pode
   * consertar, que é o que ensina a ignorar avisos.
   */
  private comAvisoDeProjeto(reply: string, projectId: string | null): string {
    if (projectId) return reply.slice(0, TELEGRAM_MAX_CHARS)
    const aviso = `\n\n_${AVISO_SEM_PROJETO}_`
    return reply.slice(0, TELEGRAM_MAX_CHARS - aviso.length) + aviso
  }

  private async setProject(chatId: string, projectId: string, threadId = '') {
    return this.prisma.telegramSession.update({
      where: { telegramChatId_threadId: { telegramChatId: chatId, threadId } },
      data:  { projectId },
    })
  }

  /**
   * ── O sensor do canal (14/09) ───────────────────────────────────────────────
   *
   * O chat livre respondeu 401 por meses e virava "erro ao processar mensagem", sem nada
   * acusar: os comandos funcionavam (não passam pelo orquestrador), o processo subia saudável e
   * o long-polling logava "started". Painel verde, canal quebrado — o critério de entrada do
   * catálogo de invariantes.
   *
   * Responde **sem efeito colateral**: não envia mensagem, não cria conversa, não gasta LLM.
   * Sondar `POST /orchestrate` de verdade a cada 30 min pagaria uma conversa por sonda, e sensor
   * caro é sensor que alguém desliga.
   *
   * `chatsSemProjeto` entra como número e **não** derruba o check: chat sem projeto responde sem
   * contexto, o que é configuração incompleta, não canal quebrado. Vermelho permanente é o que
   * se aprende a ignorar.
   */
  async diagnostico(): Promise<{
    ok: boolean
    botConfigurado: boolean
    pollingAtivo: boolean
    credencialOrquestrador: 'ok' | 'ausente'
    chatsAutorizados: number
    chatsSemProjeto: number
    detalhe: string
  }> {
    const botConfigurado = Boolean(this.token && this.chatId)
    const pollingAtivo   = this.pollTimer != null
    const temCredencial  = Boolean(
      this.config.get<string>('TELEGRAM_API_TOKEN') ?? this.config.get<string>('AGENT_TOKEN'),
    )

    const [chatsAutorizados, totalSessoes, comProjeto] = await Promise.all([
      this.prisma.telegramChat.count({ where: { authorized: true } }).catch(() => 0),
      this.prisma.telegramSession.count().catch(() => 0),
      this.prisma.telegramSession.count({ where: { projectId: { not: null } } }).catch(() => 0),
    ])
    const chatsSemProjeto = Math.max(totalSessoes - comProjeto, 0)

    const problemas: string[] = []
    if (!botConfigurado) problemas.push('TELEGRAM_BOT_TOKEN/CHAT_ID ausente')
    if (!pollingAtivo)   problemas.push('long-polling parado')
    if (!temCredencial)  problemas.push('sem credencial para o orquestrador — todo texto livre responde 401')

    const notas: string[] = []
    if (chatsSemProjeto > 0) notas.push(`${chatsSemProjeto} chat(s) sem projeto vinculado (respondem sem contexto)`)

    return {
      ok: problemas.length === 0,
      botConfigurado,
      pollingAtivo,
      credencialOrquestrador: temCredencial ? 'ok' : 'ausente',
      chatsAutorizados,
      chatsSemProjeto,
      detalhe: problemas.length > 0
        ? problemas.join('; ')
        : ['canal pronto', ...notas].join(' — '),
    }
  }

  // ─── Orchestrate via HTTP (avoids circular dep) ───────────────────────────────

  private async orchestrate(prompt: string, sessionId: string, projectId?: string): Promise<string> {
    // `TELEGRAM_API_TOKEN` **nunca existiu** — nem no `.env`, nem no compose, nem no container.
    // Com o `?? ''` anterior, toda conversa de texto livre saía com `Bearer ` vazio, tomava 401 e
    // virava "erro ao processar mensagem"; os comandos funcionavam porque não passam por aqui.
    // Descoberto no primeiro uso real, em 14/09.
    //
    // O `JwtAuthGuard` é global e aceita **JWT ou `AGENT_TOKEN`**, e este serviço roda DENTRO da
    // api chamando a própria api — qual credencial usa nesse salto é detalhe interno. Exigir uma
    // variável própria só criava um ponto de falha a mais, que falhava em runtime e em silêncio.
    const jwt = this.config.get<string>('TELEGRAM_API_TOKEN')
      ?? this.config.get<string>('AGENT_TOKEN')
      ?? ''

    // Falhar dizendo o que falta, em vez de sair e colher um 401 genérico lá na frente.
    if (!jwt) {
      throw new Error(
        'Sem credencial para chamar o orquestrador: defina TELEGRAM_API_TOKEN ou AGENT_TOKEN.',
      )
    }

    const res = await fetch(`${this.apiUrl}/orchestrate`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${jwt}`,
      },
      body: JSON.stringify({ prompt, sessionId, projectId }),
    })
    if (!res.ok) throw new Error(`Orchestrate failed: ${res.status}`)
    const data = await res.json() as { reply?: string }
    return data.reply ?? 'Sem resposta.'
  }

  // ─── Command Router ───────────────────────────────────────────────────────────

  private async handleCommand(cmd: string, args: string, chatId: string, session: { sessionId: string; projectId: string | null }, threadId = '') {
    const pid = session.projectId

    switch (cmd) {
      case '/ajuda':
        await this.send([
          '*Comandos disponíveis:*',
          '/projeto — selecionar projeto ativo',
          '/status — estado atual do projeto',
          '/goal — meta ativa e progresso',
          `/eventos [n] — últimos N eventos (padrão 10)`,
          '/checkpoint — disparar checkpoint de sessão',
          '/autorizar — liberar um grupo novo (só no chat raiz)',
          '/ajuda — esta mensagem',
          '',
          '_Qualquer outro texto vai para o Rayzen._',
          '',
          // A06 (13/09): responder sessão supervisionada pelo Telegram passou a funcionar de
          // verdade — antes o callback era global e a resposta podia cair na sessão errada, ou
          // sequestrar uma conversa comum. Quem usa precisa saber que o caminho existe e como
          // endereçar quando há mais de uma pendência.
          '*Sessão supervisionada aguardando aprovação:*',
          'responda normalmente para decidir a etapa.',
          'Com mais de uma sessão aberta, enderece com o id na frente —',
          '`a1b2c3d4: pode continuar`.',
          '_Silêncio não aprova: a sessão para e avisa._',
        ].join('\n'), chatId, threadId)
        break

      case '/autorizar': {
        // Só da raiz de confiança. Sem isto, um grupo autorizado poderia autorizar
        // outro, e a cadeia de confiança deixaria de ter dono.
        if (chatId !== this.chatId) {
          await this.send('Comando disponível apenas no chat raiz.', chatId, threadId)
          break
        }
        const pendentes = await this.prisma.telegramChat.findMany({
          where:   { authorized: false },
          orderBy: { lastSeenAt: 'desc' },
          take:    10,
        })
        if (pendentes.length === 0) {
          await this.send([
            'Nenhum chat aguardando autorização.',
            '',
            '_Adicione o bot ao grupo e mande qualquer mensagem lá — ele fica em silêncio,_',
            '_mas o chat aparece aqui._',
          ].join('\n'), chatId, threadId)
          break
        }
        const lista = pendentes
          .map((c, i) => `${i + 1}. ${c.title ?? '(sem título)'} — \`${c.chatId}\``)
          .join('\n')
        await this.send(
          `*Chats aguardando autorização:*\n${lista}\n\nResponda com o número para autorizar.`,
          chatId, threadId,
        )
        this.setReplyHandler(async (reply: string) => {
          const idx  = parseInt(reply.trim()) - 1
          const alvo = pendentes[idx]
          if (isNaN(idx) || !alvo) {
            await this.send('Seleção inválida.', chatId, threadId)
            return
          }
          await this.prisma.telegramChat.update({
            where: { chatId: alvo.chatId },
            data:  { authorized: true },
          })
          await this.send(
            `✅ Autorizado: *${alvo.title ?? alvo.chatId}*\n\nUse /projeto lá dentro para vincular o projeto.`,
            chatId, threadId,
          )
        }, chatId, threadId)
        break
      }

      case '/projeto': {
        const projects = await this.projectSvc.findAll()
        if (projects.length === 0) {
          await this.send('Nenhum projeto encontrado.', chatId, threadId)
          break
        }
        const list = projects.map((p, i) => `${i + 1}. ${p.name} — \`${p.id.slice(0, 8)}\``).join('\n')
        await this.send(`*Projetos disponíveis:*\n${list}\n\nResponda com o número para selecionar.`, chatId, threadId)
        this.setReplyHandler(async (reply: string) => {
          const idx = parseInt(reply.trim()) - 1
          if (!isNaN(idx) && projects[idx]) {
            await this.setProject(chatId, projects[idx].id, threadId)
            await this.send(`✅ Projeto ativo: *${projects[idx].name}*`, chatId, threadId)
          } else {
            await this.send('Seleção inválida.', chatId, threadId)
          }
        }, chatId, threadId)
        break
      }

      case '/status': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId, threadId); break }
        const state = await this.stateSvc.get(pid)
        if (!state) { await this.send('Estado não disponível para este projeto.', chatId, threadId); break }
        const blockers = (state.blockers ?? []) as Array<{ title?: string } | string>
        const blockerLines = blockers.map((b) =>
          typeof b === 'string' ? `\n🚧 ${b}` : `\n🚧 ${b.title ?? ''}`
        )
        const msg = [
          `*Estado — ${pid}*`,
          state.objective ? `\n📌 ${state.objective}` : '',
          state.stage     ? `\n🔖 Stage: ${state.stage}` : '',
          ...blockerLines,
        ].join('')
        await this.send(msg || 'Estado vazio.', chatId, threadId)
        break
      }

      case '/goal': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId, threadId); break }
        try {
          const data = await this.graphSvc.getGoalGraph(pid)
          if (!data.goal) { await this.send('Sem meta ativa.', chatId, threadId); break }
          const goal = data.goal as Record<string, unknown>
          const msg = [
            `*Meta: ${goal['title'] as string}*`,
            data.gapAnalysis?.nextBestAction ? `\n🎯 ${data.gapAnalysis.nextBestAction}` : '',
            data.gapAnalysis?.goalProgress !== undefined ? `\n📊 Progresso: ${data.gapAnalysis.goalProgress}%` : '',
          ].join('')
          await this.send(msg, chatId, threadId)
        } catch {
          await this.send('Erro ao buscar meta.', chatId, threadId)
        }
        break
      }

      case '/eventos': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId, threadId); break }
        const limit = Math.min(parseInt(args) || 10, 20)
        const events = await this.prisma.event.findMany({
          where: { projectId: pid },
          orderBy: { ts: 'desc' },
          take: limit,
        })
        const lines = events.map((e) =>
          `[${new Date(e.ts).toISOString().slice(11, 16)}] ${e.type}: ${String(e.content).slice(0, 80)}`
        )
        await this.send(`*Últimos ${limit} eventos:*\n\`\`\`\n${lines.join('\n')}\n\`\`\``, chatId, threadId)
        break
      }

      case '/checkpoint': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId, threadId); break }
        await this.send('⏳ Disparando checkpoint...', chatId, threadId)
        try {
          const reply = await this.orchestrate(
            'Faça um checkpoint completo desta sessão de trabalho.',
            await this.fioDaConversa(session),
            pid,
          )
          await this.send(`✅ Checkpoint concluído.\n${reply.slice(0, 400)}`, chatId, threadId)
        } catch {
          await this.send('Erro ao disparar checkpoint.', chatId, threadId)
        }
        break
      }

      default:
        await this.send(`Comando desconhecido: ${cmd}. Use /ajuda.`, chatId, threadId)
    }
  }

  // ─── Polling ─────────────────────────────────────────────────────────────────

  private startPolling() {
    const poll = async () => {
      try {
        const url = `${this.baseUrl}/getUpdates?offset=${this.offset}&timeout=20&allowed_updates=["message"]`
        const res  = await fetch(url)
        const data = await res.json() as { ok: boolean; result: TelegramUpdate[] }

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.offset = update.update_id + 1
            await this.processUpdate(update)
          }
        }
      } catch { /* network hiccup — keep polling */ }
      this.pollTimer = setTimeout(poll, 1000)
    }

    poll()
    this.logger.log('Telegram long-polling started')
  }

  private async processUpdate(update: TelegramUpdate) {
    const text   = update.message?.text?.trim()
    const fromId = String(update.message?.chat?.id ?? '')
    // Tópico de supergrupo. Ausente em conversa privada e em grupo simples — daí o '',
    // que é o mesmo valor que a coluna usa como default. Ver o comentário do schema
    // sobre por que não é nullable.
    const threadId = update.message?.message_thread_id != null
      ? String(update.message.message_thread_id)
      : ''

    if (!text || !fromId) return

    if (!(await this.chatAutorizado(fromId, update.message?.chat?.title))) return

    // 1. Seleção pendente DESTE chat/tópico (fluxos `/projeto`, `/autorizar`).
    const handler = this.replyHandlers.get(this.chaveDeOrigem(fromId, threadId))
    if (handler) {
      this.clearReplyHandler(fromId, threadId)
      handler(text)
      return
    }

    const session = await this.getOrCreateSession(fromId, threadId)

    // 2. Comando tem precedência sobre resposta de sessão: com o callback global, uma sessão
    //    aguardando aprovação engolia `/projeto` e `/autorizar`, e a escolha de um projeto
    //    podia virar a aprovação de uma etapa de código. Responder literalmente "/algo" a uma
    //    sessão deixa de ser possível — troca deliberada, e a barata das duas.
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(' ')
      await this.handleCommand(cmd.toLowerCase(), rest.join(' '), fromId, session, threadId)
      return
    }

    // 3. Sessão supervisionada aguardando resposta humana. Consulta o BANCO, não um callback em
    //    memória: a pendência sobrevive a restart, e duas sessões não se sobrescrevem.
    const destino = await this.pendingReply.resolver(text)
    if (destino.tipo === 'ambigua') {
      await this.send(this.pendingReply.textoDeDesambiguacao(destino.sessoes), fromId, threadId)
      return
    }
    if (destino.tipo === 'unica') {
      const gravou = await this.pendingReply.responder(destino.sessionId, destino.reply)
      // `false` = a sessão saiu de `waiting` entre a consulta e a escrita (respondida pela web,
      // ou concluída). Cai no fluxo normal em vez de engolir a mensagem em silêncio.
      if (gravou) {
        await this.send(`✅ Resposta registrada na sessão \`${destino.sessionId.slice(0, 8)}\`.`, fromId, threadId)
        return
      }
    }

    try {
      await this.send('💭 Processando...', fromId, threadId)
      const reply = await this.orchestrate(text, await this.fioDaConversa(session), session.projectId ?? undefined)
      await this.send(this.comAvisoDeProjeto(reply, session.projectId), fromId, threadId)
    } catch (e) {
      this.logger.error('Orchestrate error', e)
      await this.send('Erro ao processar mensagem. Tente novamente.', fromId, threadId)
    }
  }
}

interface TelegramUpdate {
  update_id: number
  message?: {
    text?: string
    /** `message_thread_id` so vem em supergrupo com topicos ativos. */
    message_thread_id?: number
    chat?: { id: number; title?: string; type?: string }
  }
}
