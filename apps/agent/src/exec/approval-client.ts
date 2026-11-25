import { createHash } from 'crypto'

/**
 * Cliente de aprovação do agent — Fase 5-A de `docs/plano-execucao-tipada.md`.
 *
 * O agent **pede** aprovação; ele não a concede. A criação exige `APPROVAL_TOKEN`, que este
 * processo deliberadamente não possui — se possuísse, `force: true` teria apenas mudado de nome.
 *
 * Falha de rede é **negação**, nunca liberação. Aprovação que "vale quando o servidor não
 * responde" é o oposto de aprovação, e é o modo de falha clássico de gate: cai aberto justo
 * quando ninguém está olhando.
 */

export interface AlvoDeExecucao {
  actionKey: string
  actor:     string
  resource?: string | null
  args:      Record<string, unknown>
}

/**
 * Mesmo canônico do servidor. Duplicado aqui **de propósito** — o agent não importa código da
 * API — e travado por teste de vetor compartilhado: os dois lados hasheiam o mesmo alvo e
 * precisam chegar ao mesmo hex. Sem isso o drift apareceria como "aprovação nunca casa", que é
 * um sintoma que leva a desligar a checagem.
 */
export function hashDoAlvo(alvo: AlvoDeExecucao): string {
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

export interface ResultadoDeAprovacao {
  ok:      boolean
  motivo?: string
  /** Fase 7, caso 4 do plano de execução tipada: quem criou a aprovação consumida — só
   * presente quando `ok === true`. `apps/api`'s `consumir()` passou a devolver isso em
   * 12/09; antes o agent nunca tinha como saber quem aprovou, só QUE alguém aprovou. */
  id?:        string
  createdBy?: string
}

/**
 * Consome uma aprovação no servidor. Só o servidor decide — aqui não há cache, nem "lembrar que
 * já aprovou", nem retry: consumo é de uso único, e repetir seria o replay que o servidor existe
 * para recusar.
 */
export async function consumirAprovacao(
  alvo: AlvoDeExecucao,
  opts: { taskId?: string; apiUrl?: string; token?: string; timeoutMs?: number } = {},
): Promise<ResultadoDeAprovacao> {
  const base  = (opts.apiUrl ?? process.env.AGENT_API_URL ?? 'http://localhost:3101').replace(/\/$/, '')
  const token = opts.token ?? process.env.AGENT_TOKEN ?? ''

  if (!token) return { ok: false, motivo: 'agent sem AGENT_TOKEN — não há como pedir aprovação' }

  try {
    const res = await fetch(`${base}/execution/approvals/consume`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({
        actionKey: alvo.actionKey,
        actor:     alvo.actor,
        resource:  alvo.resource ?? null,
        args:      alvo.args,
        taskId:    opts.taskId,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })

    if (!res.ok) return { ok: false, motivo: `servidor recusou (HTTP ${res.status})` }

    const corpo = (await res.json()) as ResultadoDeAprovacao
    // `=== true` explícito: corpo inesperado (proxy, página de erro, JSON de outra rota) não pode
    // virar autorização por coerção.
    const ok = corpo?.ok === true
    // Mesma disciplina para identidade: só repassa `id`/`createdBy` quando a aprovação já foi
    // concedida por um corpo com a forma esperada — nunca de um corpo inesperado forjando "quem
    // aprovou" (a mesma classe de ataque que `=== true` acima já nega para o `ok`).
    const identidade = ok && typeof corpo?.id === 'string' && typeof corpo?.createdBy === 'string'
      ? { id: corpo.id, createdBy: corpo.createdBy }
      : {}
    return { ok, motivo: corpo?.motivo, ...identidade }
  } catch (e) {
    return { ok: false, motivo: `sem resposta do servidor: ${e instanceof Error ? e.message : String(e)}` }
  }
}
