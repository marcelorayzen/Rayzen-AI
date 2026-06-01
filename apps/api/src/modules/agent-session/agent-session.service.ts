import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'

@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  async create(projectId: string, claudePrompt: string) {
    const session = await this.prisma.agentSession.create({
      data: { projectId, claudePrompt },
    })

    await this.prisma.taskLog.create({
      data: {
        module: 'agent',
        action: 'jarvis:supervised_session',
        payload: {
          sessionId: session.id,
          prompt: claudePrompt,
          projectId,
        },
        status: 'pending',
      },
    })

    await this.telegram.send(`▶️ *Sessão supervisionada iniciada*\nID: \`${session.id}\`\n\n_Claude está trabalhando... você será notificado quando houver perguntas ou conclusões._`)

    this.telegram.setReplyHandler((text) => {
      this.submitReply(session.id, text).catch(() => null)
    })

    return session
  }

  async get(id: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id } })
    if (!session) throw new NotFoundException(`AgentSession ${id} not found`)
    return session
  }

  async postQuestion(id: string, question: string, requiresApproval = false, approvalOptions?: string[]) {
    const session = await this.prisma.agentSession.update({
      where: { id },
      data: {
        pendingQuestion: question,
        status: 'waiting',
        pendingRequiresApproval: requiresApproval,
        pendingApprovalOptions: approvalOptions ?? undefined,
      },
    })

    const preview = question.length > 300 ? question.slice(-300) + '…' : question

    if (requiresApproval) {
      const opts = (approvalOptions ?? ['Aprovado, continue', 'Rejeitar e corrigir', 'Modificar instrução'])
        .map((o, i) => `${i + 1}. ${o}`)
        .join('\n')
      await this.telegram.send(`⏸️ *Etapa concluída — aprovação necessária:*\n\n${preview}\n\n*Responda:*\n${opts}`)
    } else {
      await this.telegram.send(`❓ *Claude pergunta:*\n\n${preview}`)
    }

    return session
  }

  async submitReply(id: string, reply: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id } })
    if (!session || session.status !== 'waiting') return

    await this.prisma.agentSession.update({
      where: { id },
      data: {
        pendingReply: reply,
        pendingQuestion: null,
        status: 'active',
        pendingRequiresApproval: false,
        pendingApprovalOptions: undefined,
      },
    })
  }

  async pollReply(id: string): Promise<{ reply: string | null }> {
    const session = await this.prisma.agentSession.findUnique({ where: { id } })
    if (!session?.pendingReply) return { reply: null }

    await this.prisma.agentSession.update({
      where: { id },
      data: { pendingReply: null },
    })

    return { reply: session.pendingReply }
  }

  async complete(id: string, summary: string, previewUrl?: string) {
    await this.prisma.agentSession.update({
      where: { id },
      data: { status: 'completed', summary, previewUrl: previewUrl ?? null },
    })

    this.telegram.clearReplyHandler()

    let msg = `✅ *Sessão concluída!*\n\n${summary}`
    if (previewUrl) msg += `\n\n🔗 Preview: ${previewUrl}`
    await this.telegram.send(msg)

    return { ok: true }
  }

  async appendLog(id: string, chunk: string) {
    const sess = await this.prisma.agentSession.findUnique({ where: { id }, select: { liveLog: true } })
    if (!sess) return
    const combined = ((sess.liveLog ?? '') + chunk).slice(-6000)
    await this.prisma.agentSession.update({ where: { id }, data: { liveLog: combined } })
  }

  async error(id: string, message: string) {
    await this.prisma.agentSession.update({
      where: { id },
      data: { status: 'error', summary: message },
    })

    this.telegram.clearReplyHandler()
    await this.telegram.send(`❌ *Erro na sessão*\n\n${message.slice(0, 400)}`)

    return { ok: true }
  }
}
