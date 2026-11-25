import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Aprovação humana para execução de risco alto — Fase 5-A.
 *
 * Até 2026-09-08 bastava `force: true` no payload para executar risco `high`. Quem montava o
 * payload concedia a própria aprovação — e quem monta payload, num sistema com specialist loop,
 * é o LLM. Não havia aprovação; havia um campo com nome de aprovação.
 */

/** Validade padrão. Curta de propósito: aprovação é para agora, não para depois. */
export const VALIDADE_PADRAO_MS = 10 * 60 * 1000

/** Teto — nem quem aprova pode emitir uma aprovação eterna. */
export const VALIDADE_MAXIMA_MS = 60 * 60 * 1000

export interface AlvoDaAprovacao {
  actionKey: string
  actor:     string
  resource?: string | null
  args:      Record<string, unknown>
}

/**
 * Hash canônico do alvo.
 *
 * **Chaves ordenadas e serialização estável**: `{a:1,b:2}` e `{b:2,a:1}` são o mesmo pedido, e
 * um hash que discordasse disso recusaria execuções legítimas — o tipo de falso negativo que
 * faz alguém desligar a checagem.
 *
 * `resource` entra no hash porque aprovar um comando num repositório **não** aprova o mesmo
 * comando em outro. E `actor` entra porque aprovar para o desktop não aprova para o servidor.
 */
export function hashDoAlvo(alvo: AlvoDaAprovacao): string {
  const canonico = JSON.stringify({
    actionKey: alvo.actionKey,
    actor:     alvo.actor,
    resource:  alvo.resource ?? null,
    args:      ordenar(alvo.args),
  })
  return createHash('sha256').update(canonico).digest('hex')
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar)
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>
    return Object.keys(src).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = ordenar(src[k])
      return acc
    }, {})
  }
  return v
}

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria a aprovação. A rota que chama isto exige `APPROVAL_TOKEN` — credencial que o agent
   * **não possui**. É o que torna autoaprovação impossível por construção, e não por promessa:
   * o `AGENT_TOKEN` alcança a rota de consumo e não alcança esta.
   */
  async criar(alvo: AlvoDaAprovacao, principal: { id: string; type: string }, validadeMs?: number) {
    if (!alvo.actionKey || !alvo.actor) {
      throw new BadRequestException('actionKey e actor são obrigatórios')
    }
    const ms = Math.min(validadeMs ?? VALIDADE_PADRAO_MS, VALIDADE_MAXIMA_MS)
    const registro = await this.prisma.executionApproval.create({
      data: {
        actionKey: alvo.actionKey,
        argsHash:  hashDoAlvo(alvo),
        actor:     alvo.actor,
        resource:  alvo.resource ?? null,
        createdBy:     principal.id,
        createdByType: principal.type,
        expiresAt: new Date(Date.now() + ms),
      },
    })
    this.logger.log(`aprovação ${registro.id.slice(0, 8)} para ${alvo.actionKey} por ${principal.id}, expira em ${ms / 60000}min`)
    return { id: registro.id, expiresAt: registro.expiresAt, argsHash: registro.argsHash }
  }

  /**
   * Consome UMA aprovação que case exatamente com o alvo.
   *
   * O consumo é um `updateMany` condicional em `consumedAt: null` — atômico no banco. Ler,
   * decidir e depois gravar abriria janela para dois consumos da mesma aprovação em corrida,
   * que é precisamente o replay que este método existe para impedir.
   */
  async consumir(alvo: AlvoDaAprovacao, taskId?: string): Promise<{ ok: boolean; motivo?: string; id?: string; createdBy?: string }> {
    const argsHash = hashDoAlvo(alvo)

    const candidata = await this.prisma.executionApproval.findFirst({
      where: {
        actionKey:  alvo.actionKey,
        argsHash,
        consumedAt: null,
        expiresAt:  { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!candidata) {
      // Motivo genérico de propósito: distinguir "não existe" de "expirou" de "já usada"
      // ensinaria um chamador hostil a enumerar aprovações válidas.
      this.logger.warn(`consumo negado: ${alvo.actionKey} sem aprovação válida`)
      return { ok: false, motivo: 'sem aprovação válida para esta ação e estes argumentos' }
    }

    const efetivado = await this.prisma.executionApproval.updateMany({
      where: { id: candidata.id, consumedAt: null },
      data:  { consumedAt: new Date(), consumedByTask: taskId ?? null },
    })

    if (efetivado.count !== 1) {
      // Perdeu a corrida — outro consumo levou a mesma aprovação.
      return { ok: false, motivo: 'aprovação já consumida' }
    }

    this.logger.log(`aprovação ${candidata.id.slice(0, 8)} consumida por ${alvo.actionKey}`)
    // Fase 7, caso 4 do plano de execução tipada: `id`/`createdBy` já estavam buscados em
    // `candidata` — a lacuna era não devolvê-los, não precisar de outra query. Isso é o que
    // permite a auditoria (hoje em `decidir()`, `apps/agent`) registrar QUEM aprovou, não só
    // que uma aprovação existiu.
    return { ok: true, id: candidata.id, createdBy: candidata.createdBy }
  }

  async listarPendentes(actionKey?: string) {
    return this.prisma.executionApproval.findMany({
      where: {
        consumedAt: null,
        expiresAt:  { gt: new Date() },
        ...(actionKey ? { actionKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, actionKey: true, actor: true, resource: true, createdBy: true, expiresAt: true },
    })
  }
}
