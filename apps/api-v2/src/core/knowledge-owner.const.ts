import type { AuthPrincipal } from './auth.guard'

/**
 * Quem promove conhecimento — uma pessoa, e a mesma pessoa em todo caminho.
 *
 * A Fase 3 acrescentou um segundo lugar que precisa da pergunta (incluir candidato num
 * ContextPack), e um segundo lugar é exatamente onde as regras desta casa divergiram
 * antes. A definição mora aqui para que "somente Marcelo promove" não vire duas
 * definições de Marcelo.
 *
 * `kind: 'human'` é metade da regra, e a metade que já falhou: em 23/09 o `AGENT_TOKEN`
 * de produção também era um JWT válido e chegava como humano `admin`. O guard passou a
 * dar precedência à identidade configurada; aqui a exigência fica explícita de novo,
 * porque defesa que depende de um só ponto é defesa que some quando esse ponto muda.
 */
export function ehDonoDoConhecimento(principal: AuthPrincipal): boolean {
  const dono = process.env.KNOWLEDGE_OWNER_SUBJECT ?? 'admin'
  return principal.kind === 'human' && principal.subject === dono
}
