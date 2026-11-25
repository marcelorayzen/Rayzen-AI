import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CANAL_DE_AVISO, linkDoFio, type CanalDeAviso } from './canal-de-aviso'
import { ExecutionService } from '../execution/execution.service'
import { OPCAO_NAO_PUBLICAR, PendingReplyService } from './pending-reply.service'

export interface MetricasDaSessao {
  costUsd?: number
  numTurns?: number
  modelSessionId?: string
  papel?: string
  provedor?: string
  modelo?: string
  testVerification?: VerificacaoIndependenteDaSessao
}

// G7.1: o link para o fio mora em `canal-de-aviso.ts` desde o G6.5; reexportado para quem já o
// importava daqui.
export { linkDoFio }

export interface VerificacaoIndependenteDaSessao {
  status: 'passou' | 'falhou' | 'timeout' | 'não verificado'
  comando: string
  codigo: number | null
  duracaoMs: number
  ultimasLinhas: string[]
}

/** Quem "recusou" quando o portão de publicação venceu sem resposta. */
export const PUBLICACAO_RECUSADA_POR_PRAZO = 'ninguém (o prazo do portão venceu sem resposta)'

/** `vscode://vscode-remote/ssh-remote+<alvo>/<caminho>`, sem espaço nem aspas. */
export const LINK_DO_VSCODE = /^vscode:\/\/vscode-remote\/ssh-remote\+[\w.@-]+\/[\w./@-]+$/

@Injectable()
export class AgentSessionService {
  private readonly logger = new Logger(AgentSessionService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CANAL_DE_AVISO) private readonly canal: CanalDeAviso,
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
      }, undefined, `agent-session:${session.id}`)
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
    await this.canal.enviar(`▶️ *Sessão supervisionada iniciada*\nID: \`${session.id}\`\n\n_Claude está trabalhando... você será notificado quando houver perguntas ou conclusões._${linkDoFio(session.projectId)}`)

    return this.incluirSuporteParada(session)
  }

  async get(id: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id } })
    if (!session) throw new NotFoundException(`AgentSession ${id} not found`)
    return this.incluirSuporteParada(session)
  }

  async solicitarParada(id: string) {
    const atualizada = await this.prisma.agentSession.updateMany({
      where: { id, status: 'active' },
      data: { status: 'stopping' },
    })
    if (atualizada.count > 0) return { id, status: 'stopping' }
    return this.get(id)
  }

  async marcarParada(id: string) {
    const atualizada = await this.prisma.agentSession.updateMany({
      where: { id, status: 'stopping' },
      data: { status: 'stopped', summary: 'Sessão interrompida pelo usuário.' },
    })
    return { ok: atualizada.count > 0 }
  }

  async registrarMetricas(id: string, metricas: MetricasDaSessao) {
    if (metricas.costUsd !== undefined && (!Number.isFinite(metricas.costUsd) || metricas.costUsd < 0)) {
      throw new BadRequestException('costUsd deve ser um número finito não negativo')
    }
    if (metricas.numTurns !== undefined && (!Number.isInteger(metricas.numTurns) || metricas.numTurns < 0)) {
      throw new BadRequestException('numTurns deve ser um inteiro não negativo')
    }

    const atual = await this.prisma.agentSession.findUnique({
      where: { id },
      select: { costUsd: true, numTurns: true },
    })
    if (!atual) throw new NotFoundException(`AgentSession ${id} not found`)

    return this.prisma.agentSession.update({
      where: { id },
      data: {
        ...(metricas.costUsd !== undefined ? { costUsd: (atual.costUsd ?? 0) + metricas.costUsd } : {}),
        ...(metricas.numTurns !== undefined ? { numTurns: (atual.numTurns ?? 0) + metricas.numTurns } : {}),
        ...(metricas.modelSessionId !== undefined ? { modelSessionId: metricas.modelSessionId } : {}),
        ...(metricas.papel !== undefined ? { papel: metricas.papel } : {}),
        ...(metricas.provedor !== undefined ? { provedor: metricas.provedor } : {}),
        ...(metricas.modelo !== undefined ? { modelo: metricas.modelo } : {}),
        ...(metricas.testVerification !== undefined ? { testVerification: {
          status: metricas.testVerification.status,
          comando: metricas.testVerification.comando,
          codigo: metricas.testVerification.codigo,
          duracaoMs: metricas.testVerification.duracaoMs,
          ultimasLinhas: metricas.testVerification.ultimasLinhas,
        } } : {}),
      },
    })
  }

  async postQuestion(id: string, question: string, requiresApproval = false, approvalOptions?: string[], previewUrl?: string) {
    const session = await this.prisma.agentSession.update({
      where: { id },
      data: {
        pendingQuestion: question,
        status: 'waiting',
        pendingRequiresApproval: requiresApproval,
        pendingApprovalOptions: approvalOptions ?? undefined,
        // HC6: a prévia chega com o portão, não só no `complete` — senão o botão só aparece
        // depois de decidir. Pergunta sem prévia não apaga a que já estava gravada.
        ...(previewUrl ? { previewUrl } : {}),
      },
    })

    const preview = question.length > 300 ? question.slice(-300) + '…' : question

    if (requiresApproval) {
      const opts = (approvalOptions ?? ['Aprovado, continue', 'Rejeitar e corrigir', 'Modificar instrução'])
        .map((o, i) => `${i + 1}. ${o}`)
        .join('\n')
      await this.canal.enviar(`⏸️ *Etapa concluída — aprovação necessária:*\n\n${preview}\n\n*Responda:*\n${opts}${linkDoFio(session?.projectId)}`)
    } else {
      await this.canal.enviar(`❓ *Claude pergunta:*\n\n${preview}${linkDoFio(session?.projectId)}`)
    }

    return session
  }

  /**
   * Resposta vinda da web (`POST /agent/session/:id/answer`). O Telegram usa o mesmo
   * `PendingReplyService` por outro caminho — fonte única para os dois, senão as duas entradas
   * divergiriam em silêncio sobre o que conta como pendência válida.
   */
  async submitReply(id: string, reply: string, quem?: string) {
    await this.pendingReply.responder(id, reply, quem)
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

  async complete(id: string, summary: string, previewUrl?: string, testVerification?: VerificacaoIndependenteDaSessao) {
    // G5.1 (23/11): a sessão que conclui AINDA esperando o portão de publicação teve o prazo
    // vencido sem resposta — e silêncio não publica. Gravar isso como recusa é o que deixa o
    // envelope fechar em `failed_safe` em vez de `effect_unknown`. A prova é o estado que a
    // API guardou (a pergunta nunca foi respondida), não o relato da sessão.
    const antes = await this.prisma.agentSession.findUnique({
      where: { id }, select: { status: true, pendingRequiresApproval: true, pendingApprovalOptions: true },
    })
    const prazoVenceu = antes?.status === 'waiting' && antes.pendingRequiresApproval
      && Array.isArray(antes.pendingApprovalOptions) && antes.pendingApprovalOptions.includes(OPCAO_NAO_PUBLICAR)
    const session = await this.prisma.agentSession.update({
      where: { id },
      data: {
        status: 'completed',
        summary,
        ...(prazoVenceu ? {
          publicacaoRecusadaEm: new Date(),
          publicacaoRecusadaPor: PUBLICACAO_RECUSADA_POR_PRAZO,
          pendingQuestion: null,
          pendingRequiresApproval: false,
        } : {}),
        previewUrl: previewUrl ?? null,
        ...(testVerification ? { testVerification: {
          status: testVerification.status,
          comando: testVerification.comando,
          codigo: testVerification.codigo,
          duracaoMs: testVerification.duracaoMs,
          ultimasLinhas: testVerification.ultimasLinhas,
        } } : {}),
      },
    })


    let msg = `✅ *Sessão concluída!*\n\n${summary}`
    if (previewUrl) msg += `\n\n🔗 Preview: ${previewUrl}`
    msg += linkDoFio(session?.projectId)
    await this.canal.enviar(msg)

    return { ok: true }
  }

  async appendLog(id: string, chunk: string, vscodeUrl?: string) {
    const sess = await this.prisma.agentSession.findUnique({ where: { id }, select: { liveLog: true } })
    if (!sess) return
    const combined = ((sess.liveLog ?? '') + chunk).slice(-6000)
    // G2.9: o Hub mostra o link como botão "Abrir no VS Code". Só o esquema do VS Code Remote
    // passa — um `javascript:` ou `https://` qualquer vindo do token do agent não vira botão.
    const link = vscodeUrl && LINK_DO_VSCODE.test(vscodeUrl) ? vscodeUrl : undefined
    await this.prisma.agentSession.update({ where: { id }, data: { liveLog: combined, ...(link ? { vscodeUrl: link } : {}) } })
  }

  async error(id: string, message: string) {
    const session = await this.prisma.agentSession.update({
      where: { id },
      data: { status: 'error', summary: message },
    })

    await this.canal.enviar(`❌ *Erro na sessão*\n\n${message.slice(0, 400)}${linkDoFio(session?.projectId)}`)

    return { ok: true }
  }

  private incluirSuporteParada<T extends object>(session: T) {
    return { ...session, stopSupported: process.env.SESSAO_NO_SERVIDOR === 'true' }
  }
}
