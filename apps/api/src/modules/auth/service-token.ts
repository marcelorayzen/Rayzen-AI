import { timingSafeEqual } from 'crypto'

function iguais(a: string, b: string): boolean {
  const tamanho = Math.max(a.length, b.length)
  const recebido = Buffer.alloc(tamanho, 0)
  const esperado = Buffer.alloc(tamanho, 0)
  Buffer.from(a).copy(recebido)
  Buffer.from(b).copy(esperado)
  return a.length === b.length && timingSafeEqual(recebido, esperado)
}

/**
 * Durante uma rotação, o servidor aceita a credencial atual e, temporariamente,
 * a anterior. Consumidores recebem somente AGENT_TOKEN; AGENT_TOKEN_PREVIOUS
 * existe apenas nos servidores e deve ser removido depois da comprovação.
 */
export function matchesServiceToken(token: string): boolean {
  return [process.env.AGENT_TOKEN, process.env.AGENT_TOKEN_PREVIOUS]
    .filter((value): value is string => Boolean(value))
    .some((value) => iguais(token, value))
}
