'use client'

import { useEffect, useState } from 'react'
import { V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

interface PendingGate {
  id: string
  // O nível de risco NÃO vem no topo do payload — mora dentro de `context`, junto com
  // o score e o id do relatório. Ler `gate.riskLevel` compila (a resposta é convertida
  // com `as`) e devolve undefined em runtime, fazendo toda cor cair no default.
  context?: { riskLevel?: string; score?: number } | null
  expiresAt: string | null
}

export interface PendingGatesState {
  count: number
  /** Maior risco entre os pendentes — define a cor do aviso. */
  topRisk: 'medium' | 'high' | 'critical' | null
}

const POLL_MS = 60_000

const SEVERITY: Record<string, number> = { medium: 1, high: 2, critical: 3 }

/**
 * Contador de approval gates aguardando decisão, para o aviso no header.
 *
 * Existe porque um gate que ninguém vê expira sozinho e vira "rejeitado" no
 * histórico — registrando como recusado um trabalho que na verdade foi aceito.
 * Aconteceu com 108 de 127 gates até 2026-08-06. A tela de resolver já existe em
 * /guardian; o que faltava era saber que havia algo lá.
 *
 * Poll de 60s em vez de WebSocket: gate não é evento de segundo, e o custo de uma
 * requisição por minuto é menor que o de mais uma assinatura no gateway.
 */
const EMPTY: PendingGatesState = { count: 0, topRisk: null }

export function usePendingGates(projectId: string | null): PendingGatesState {
  // Guarda junto o projeto de origem: assim trocar de projeto zera na hora, em vez de
  // exibir a contagem do anterior até o próximo poll — e sem setState dentro do efeito.
  const [data, setData] = useState<{ pid: string; state: PendingGatesState } | null>(null)

  useEffect(() => {
    if (!projectId) return

    let alive = true

    const load = async () => {
      try {
        const res = await fetch(`${V2_URL}/approvals/pending?projectId=${projectId}`, { headers: authHeaders() })
        if (!res.ok) return
        const gates = await res.json() as PendingGate[]
        if (!alive) return

        const top = gates.reduce<PendingGatesState['topRisk']>((acc, g) => {
          const lvl = g.context?.riskLevel as PendingGatesState['topRisk']
          if (!lvl || !(lvl in SEVERITY)) return acc
          return !acc || SEVERITY[lvl] > SEVERITY[acc] ? lvl : acc
        }, null)

        setData({ pid: projectId, state: { count: gates.length, topRisk: top } })
      } catch { /* silencioso — o badge some, não quebra o header */ }
    }

    void load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [projectId])

  return projectId && data?.pid === projectId ? data.state : EMPTY
}
