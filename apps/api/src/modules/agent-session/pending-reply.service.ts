import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * ── A06 da auditoria de 13/09: para qual pendência vai a resposta? ────────────
 *
 * Até aqui a resposta do Telegram era roteada por **um callback global** em `TelegramService`
 * (`private replyHandler`), sobrescrito por quem perguntasse por último. Quatro consequências,
 * e a primeira é a mais grave porque não tem nada a ver com sessões:
 *
 *  1. `processUpdate` consultava o handler ANTES de qualquer roteamento, então com uma sessão
 *     aguardando aprovação **toda mensagem de todo chat autorizado** virava resposta dela —
 *     inclusive conversa normal com o orquestrador, em outro projeto ou outro tópico.
 *  2. `/projeto` e `/autorizar` usam o mesmo campo: escolher um projeto podia virar a aprovação
 *     de uma etapa de código.
 *  3. Duas sessões: a segunda sobrescrevia a primeira, que ficava `waiting` para sempre.
 *  4. Callback é memória: um restart perdia a pendência, e a sessão nunca mais recebia resposta.
 *
 * Isto era latente enquanto a sessão supervisionada **não chegava ao executor** (A03). Com A03
 * corrigido, passou a ser um caminho vivo.
 *
 * A correção não inventa estado: a pendência **já é persistida** — `AgentSession.status` vira
 * `waiting` e `pendingQuestion` guarda a pergunta. Basta perguntar ao banco em vez de a um
 * callback em memória, o que resolve (3) e (4) de graça e sobrevive a restart.
 *
 * Serviço próprio, dependendo só do Prisma, para ser usado pelos DOIS lados sem ciclo de
 * módulos: `TelegramService` precisa resolver a resposta, e `AgentSessionService` precisa
 * registrar/consumir a mesma pendência. Injetar um no outro criaria dependência circular — o
 * `TelegramService` já chama o orquestrador por HTTP exatamente para evitar isso.
 */

/** Quantos caracteres do id identificam uma sessão numa resposta com prefixo. */
const TAMANHO_ID_CURTO = 8

export interface SessaoPendente {
  readonly id: string
  readonly projectId: string
  readonly pendingQuestion: string | null
}

export type Destino =
  | { tipo: 'nenhuma' }
  | { tipo: 'unica'; sessionId: string; reply: string }
  | { tipo: 'ambigua'; sessoes: SessaoPendente[] }

@Injectable()
export class PendingReplyService {
  private readonly logger = new Logger(PendingReplyService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** Sessões aguardando resposta humana, mais antiga primeiro. */
  async pendentes(): Promise<SessaoPendente[]> {
    return this.prisma.agentSession.findMany({
      where: { status: 'waiting' },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, projectId: true, pendingQuestion: true },
    })
  }

  /**
   * Decide para qual pendência um texto vai — **sem adivinhar quando há mais de uma**.
   *
   * Com duas sessões esperando, escolher "a mais recente" mandaria a aprovação de uma etapa de
   * código para o trabalho errado. Ambiguidade devolve `ambigua` e quem chama pede
   * desambiguação; o prefixo `<id-curto>: resposta` resolve explicitamente e funciona sempre,
   * inclusive quando há só uma pendência.
   */
  async resolver(texto: string): Promise<Destino> {
    const sessoes = await this.pendentes()
    if (sessoes.length === 0) return { tipo: 'nenhuma' }

    const comPrefixo = this.separarPrefixo(texto, sessoes)
    if (comPrefixo) return comPrefixo

    if (sessoes.length > 1) return { tipo: 'ambigua', sessoes }

    return { tipo: 'unica', sessionId: sessoes[0].id, reply: texto }
  }

  /**
   * `<id-curto>: resposta` — o id vem antes do primeiro `:`. Só conta como prefixo se casar
   * com uma sessão pendente de verdade: uma resposta legítima que por acaso contenha `:`
   * ("faça assim: use cache") não pode ser confundida com endereçamento.
   */
  private separarPrefixo(texto: string, sessoes: SessaoPendente[]): Destino | null {
    const corte = texto.indexOf(':')
    if (corte <= 0) return null

    const possivelId = texto.slice(0, corte).trim().toLowerCase()
    if (!possivelId) return null

    const alvo = sessoes.find((s) => s.id.toLowerCase().startsWith(possivelId))
    if (!alvo) return null

    const reply = texto.slice(corte + 1).trim()
    if (!reply) return null

    return { tipo: 'unica', sessionId: alvo.id, reply }
  }

  /**
   * Grava a resposta. Só vale para sessão em `waiting` — responder a sessão já concluída, ou
   * responder duas vezes a mesma pergunta, não tem efeito: é o que impede que uma mensagem
   * repetida no celular aprove uma etapa que já passou.
   */
  async responder(sessionId: string, reply: string): Promise<boolean> {
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } })
    if (!session || session.status !== 'waiting') return false

    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        pendingReply: reply,
        pendingQuestion: null,
        status: 'active',
        pendingRequiresApproval: false,
        pendingApprovalOptions: undefined,
      },
    })
    return true
  }

  /** Texto para pedir desambiguação quando há mais de uma pendência. */
  textoDeDesambiguacao(sessoes: SessaoPendente[]): string {
    const lista = sessoes
      .map((s) => {
        const curto = s.id.slice(0, TAMANHO_ID_CURTO)
        const pergunta = (s.pendingQuestion ?? '').slice(0, 80)
        return `\`${curto}\` — ${pergunta || '(aguardando)'}`
      })
      .join('\n')

    return (
      `*${sessoes.length} sessões aguardando resposta.* Responda com o id na frente:\n\n` +
      `${lista}\n\n_Exemplo:_ \`${sessoes[0].id.slice(0, TAMANHO_ID_CURTO)}: pode continuar\``
    )
  }
}
