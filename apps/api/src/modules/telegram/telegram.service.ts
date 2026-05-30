import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ProjectService } from '../project/project.service'
import { ProjectStateService } from '../project-state/project-state.service'
import { GraphService } from '../graph/graph.service'

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name)
  private readonly token: string
  private readonly chatId: string
  private readonly baseUrl: string
  private readonly apiUrl: string
  private offset = 0
  private pollTimer: NodeJS.Timeout | null = null
  private replyHandler: ((text: string) => void) | null = null

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly projectSvc: ProjectService,
    private readonly stateSvc: ProjectStateService,
    private readonly graphSvc: GraphService,
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

  setReplyHandler(handler: (text: string) => void) { this.replyHandler = handler }
  clearReplyHandler() { this.replyHandler = null }

  // ─── Send ────────────────────────────────────────────────────────────────────

  async send(text: string, chatId?: string): Promise<void> {
    if (!this.token) return
    const target = chatId ?? this.chatId
    if (!target) return
    try {
      await fetch(`${this.baseUrl}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: target, text: text.slice(0, 4096), parse_mode: 'Markdown' }),
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

  private async getOrCreateSession(chatId: string) {
    return this.prisma.telegramSession.upsert({
      where:  { telegramChatId: chatId },
      create: { telegramChatId: chatId },
      update: {},
    })
  }

  private async setProject(chatId: string, projectId: string) {
    return this.prisma.telegramSession.update({
      where: { telegramChatId: chatId },
      data:  { projectId },
    })
  }

  // ─── Orchestrate via HTTP (avoids circular dep) ───────────────────────────────

  private async orchestrate(prompt: string, sessionId: string, projectId?: string): Promise<string> {
    const jwt = this.config.get<string>('TELEGRAM_API_TOKEN') ?? ''
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

  private async handleCommand(cmd: string, args: string, chatId: string, session: { sessionId: string; projectId: string | null }) {
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
          '/ajuda — esta mensagem',
          '',
          '_Qualquer outro texto vai para o Rayzen._',
        ].join('\n'), chatId)
        break

      case '/projeto': {
        const projects = await this.projectSvc.findAll()
        if (projects.length === 0) {
          await this.send('Nenhum projeto encontrado.', chatId)
          break
        }
        const list = projects.map((p, i) => `${i + 1}. ${p.name} — \`${p.id.slice(0, 8)}\``).join('\n')
        await this.send(`*Projetos disponíveis:*\n${list}\n\nResponda com o número para selecionar.`, chatId)
        this.replyHandler = async (reply: string) => {
          this.clearReplyHandler()
          const idx = parseInt(reply.trim()) - 1
          if (!isNaN(idx) && projects[idx]) {
            await this.setProject(chatId, projects[idx].id)
            await this.send(`✅ Projeto ativo: *${projects[idx].name}*`, chatId)
          } else {
            await this.send('Seleção inválida.', chatId)
          }
        }
        break
      }

      case '/status': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId); break }
        const state = await this.stateSvc.get(pid)
        if (!state) { await this.send('Estado não disponível para este projeto.', chatId); break }
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
        await this.send(msg || 'Estado vazio.', chatId)
        break
      }

      case '/goal': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId); break }
        try {
          const data = await this.graphSvc.getGoalGraph(pid)
          if (!data.goal) { await this.send('Sem meta ativa.', chatId); break }
          const goal = data.goal as Record<string, unknown>
          const msg = [
            `*Meta: ${goal['title'] as string}*`,
            data.gapAnalysis?.nextBestAction ? `\n🎯 ${data.gapAnalysis.nextBestAction}` : '',
            data.gapAnalysis?.goalProgress !== undefined ? `\n📊 Progresso: ${data.gapAnalysis.goalProgress}%` : '',
          ].join('')
          await this.send(msg, chatId)
        } catch {
          await this.send('Erro ao buscar meta.', chatId)
        }
        break
      }

      case '/eventos': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId); break }
        const limit = Math.min(parseInt(args) || 10, 20)
        const events = await this.prisma.event.findMany({
          where: { projectId: pid },
          orderBy: { ts: 'desc' },
          take: limit,
        })
        const lines = events.map((e) =>
          `[${new Date(e.ts).toISOString().slice(11, 16)}] ${e.type}: ${String(e.content).slice(0, 80)}`
        )
        await this.send(`*Últimos ${limit} eventos:*\n\`\`\`\n${lines.join('\n')}\n\`\`\``, chatId)
        break
      }

      case '/checkpoint': {
        if (!pid) { await this.send('Nenhum projeto selecionado. Use /projeto.', chatId); break }
        await this.send('⏳ Disparando checkpoint...', chatId)
        try {
          const reply = await this.orchestrate(
            'Faça um checkpoint completo desta sessão de trabalho.',
            session.sessionId,
            pid,
          )
          await this.send(`✅ Checkpoint concluído.\n${reply.slice(0, 400)}`, chatId)
        } catch {
          await this.send('Erro ao disparar checkpoint.', chatId)
        }
        break
      }

      default:
        await this.send(`Comando desconhecido: ${cmd}. Use /ajuda.`, chatId)
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

    if (!text || fromId !== this.chatId) return

    if (this.replyHandler) {
      this.replyHandler(text)
      return
    }

    const session = await this.getOrCreateSession(fromId)

    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(' ')
      await this.handleCommand(cmd.toLowerCase(), rest.join(' '), fromId, session)
      return
    }

    try {
      await this.send('💭 Processando...', fromId)
      const reply = await this.orchestrate(text, session.sessionId, session.projectId ?? undefined)
      await this.send(reply.slice(0, 4000), fromId)
    } catch (e) {
      this.logger.error('Orchestrate error', e)
      await this.send('Erro ao processar mensagem. Tente novamente.', fromId)
    }
  }
}

interface TelegramUpdate {
  update_id: number
  message?: { text?: string; chat?: { id: number } }
}
