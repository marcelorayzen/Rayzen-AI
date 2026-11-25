import { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { EstadoDoHandoff } from './handoff.const'
import { SinalDaTarefa, proximoEstadoDoHandoff } from './handoff-sincronizacao'

const logger = new Logger('HandoffTarefa')

/**
 * Leva o ciclo de vida da tarefa até o envelope que a originou.
 *
 * ── Nunca lança, e isso é decisão ──────────────────────────────────────────
 * Quem chama é o caminho de claim/heartbeat/conclusão da tarefa. Derrubar a conclusão de uma
 * execução porque a linha do envelope não pôde ser escrita trocaria um registro incompleto por
 * um **efeito sem conclusão registrada** — que é exatamente o estado incerto que a Fase 1
 * existe para não produzir.
 *
 * Mas também não falha calado: o `catch` avisa. Foi engolir `EBUSY` num `catch` vazio que
 * deixou 12 diretórios de teste abandonados sem ninguém ver.
 *
 * ── Tarefa sem envelope é o caminho comum ──────────────────────────────────
 * A maioria das tarefas não vem de um handoff. Não achar linha nenhuma não é erro, é ausência
 * — e por isso a função sai calada nesse caso.
 */
export async function sincronizarHandoffComTarefa(
  prisma: PrismaService,
  taskId: string,
  sinal: SinalDaTarefa,
): Promise<EstadoDoHandoff | null> {
  try {
    const handoff = await prisma.projectHandoff.findFirst({
      where: { taskId },
      select: { id: true, status: true, effects: true },
    })
    if (!handoff) return null

    const proximo = proximoEstadoDoHandoff(handoff.status as EstadoDoHandoff, sinal)
    if (!proximo) return null

    await prisma.projectHandoff.update({
      where: { id: handoff.id },
      data: { status: proximo },
    })
    logger.log(`handoff ${handoff.id.slice(0, 8)}: ${handoff.status} para ${proximo} (tarefa ${taskId})`)
    if (proximo === 'effect_unknown') await marcarSessaoInterrompida(prisma, handoff.id, handoff.effects)
    return proximo
  } catch (e) {
    logger.warn(`não consegui sincronizar o handoff da tarefa ${taskId}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/** Estados de uma sessão que ainda tem alguém (o agent) responsável por ela. */
const SESSAO_EM_CURSO = ['active', 'waiting', 'stopping']

/** O `sessionId` cunhado pelo servidor, se o envelope é de sessão de código. */
export function sessaoDoEnvelope(effects: unknown): string | null {
  if (!Array.isArray(effects)) return null
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue
    const efeito = e as { actionKey?: unknown; payload?: { sessionId?: unknown } }
    if (efeito.actionKey === 'jarvis:supervised_session' && typeof efeito.payload?.sessionId === 'string') {
      return efeito.payload.sessionId
    }
  }
  return null
}

/**
 * G3.2a (24/11): o envelope ficou incerto, e a sessão dele não tem mais quem a conduza. Sem isto
 * ela ficava `active` para sempre (medido no ensaio G3.1): o processo que chamaria `complete` ou
 * `error` morreu junto com o container. Só muda sessão ainda em curso — a que já concluiu, falhou
 * ou parou diz a verdade e não é tocada.
 */
async function marcarSessaoInterrompida(prisma: PrismaService, handoffId: string, effects: unknown): Promise<void> {
  const sessionId = sessaoDoEnvelope(effects)
  if (!sessionId) return
  // O envelope já mudou: uma falha aqui não pode desfazer isso nem apagar o retorno.
  try {
    const r = await prisma.agentSession.updateMany({
      where: { id: sessionId, status: { in: SESSAO_EM_CURSO } },
      data: {
        status: 'interrupted',
        summary: 'Sessão interrompida: o executor parou no meio do trabalho. O que já foi feito ficou na pasta da sessão.',
        pendingQuestion: null,
        pendingRequiresApproval: false,
      },
    })
    if (r.count > 0) logger.log(`handoff ${handoffId.slice(0, 8)}: sessão ${sessionId.slice(0, 8)} marcada como interrompida`)
  } catch (e) {
    logger.warn(`handoff ${handoffId.slice(0, 8)}: não consegui marcar a sessão como interrompida: ${e instanceof Error ? e.message : String(e)}`)
  }
}
