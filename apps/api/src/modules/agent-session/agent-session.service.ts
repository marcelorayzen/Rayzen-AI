import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { ExecutionService } from '../execution/execution.service'
import { PendingReplyService } from './pending-reply.service'

@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly execution: ExecutionService,
    private readonly pendingReply: PendingReplyService,
  ) {}

  /**
   * ── A03 da auditoria de 13/09 ────────────────────────────────────────────────
   *
   * Até aqui, este método criava a `AgentSession` e gravava uma linha em `task_logs` com
   * `module: 'agent'`, `action: 'jarvis:supervised_session'`. **Nunca enfileirava.** O executor
   * despacha por `${module}:${action}` — `jarvis:supervised_session` — enquanto aquela linha
   * produzia `agent:jarvis:supervised_session`. O pedido parecia aceito e não alcançava ninguém:
   * 5 linhas `pending` desde junho, e 4 sessões `active` paradas no mesmo período.
   *
   * `task_logs` saiu inteiro em vez de ser consertado: a tabela tinha **um escritor e nenhum
   * leitor** no monorepo. Não era uma fila divergente a conciliar, era um beco sem saída.
   *
   * `enqueue()` e não `dispatch()`: o segundo espera o resultado por até 30s, e uma sessão
   * supervisionada dura minutos a horas. A referência persistente do trabalho é a própria
   * `AgentSession`, consultável por `GET /agent/session/:id` — não a espera da requisição.
   */
  async create(projectId: string, claudePrompt: string) {
    const session = await this.prisma.agentSession.create({
      data: { projectId, claudePrompt },
    })

    // "Recebido" não pode significar "iniciado". Se o enfileiramento falha — o desktop está
    // offline, tipicamente — a sessão não pode ficar `active` esperando alguém que nunca virá,
    // que é exatamente o estado encontrado em produção.
    try {
      await this.execution.enqueue('supervised_session', {
        sessionId: session.id,
        prompt: claudePrompt,
        projectId,
      })
    } catch (err) {
      const motivo = (err as Error).message
      this.logger.error(`Sessão ${session.id} não pôde ser enfileirada: ${motivo}`)
      await this.prisma.agentSession.update({
        where: { id: session.id },
        data: { status: 'error', summary: `Não foi possível enfileirar a sessão: ${motivo}` },
      })
      throw err
    }

    // Só depois de a tarefa estar de fato na fila: anunciar antes seria prometer trabalho que
    // ninguém pegou.
    //
    // A06: não registra mais callback de resposta. O roteamento passou a sair do estado
    // persistido (`status: 'waiting'`), resolvido por `PendingReplyService` — um callback em
    // memória se perdia no restart, era sobrescrito pela sessão seguinte, e desviava toda
    // mensagem de todo chat enquanto estivesse armado.
    await this.telegram.send(`▶️ *Sessão supervisionada iniciada*\nID: \`${session.id}\`\n\n_Claude está trabalhando... você será notificado quando houver perguntas ou conclusões._`)

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

  /**
   * Resposta vinda da web (`POST /agent/session/:id/answer`). O Telegram usa o mesmo
   * `PendingReplyService` por outro caminho — fonte única para os dois, senão as duas entradas
   * divergiriam em silêncio sobre o que conta como pendência válida.
   */
  async submitReply(id: string, reply: string) {
    await this.pendingReply.responder(id, reply)
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

    await this.telegram.send(`❌ *Erro na sessão*\n\n${message.slice(0, 400)}`)

    return { ok: true }
  }
}
