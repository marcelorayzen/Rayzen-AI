// Copia de `apps/api/src/modules/execution/alvo-de-execucao.const.ts`, com teste anti-drift
// em `__tests__/alvo-de-execucao.spec.ts`. Os dois apps sao separados e `packages/types` nao
// e compilado — a duplicacao e consciente, e a divergencia nao daria erro: daria aprovacao
// emitida com um alvo e consumida com outro, que e recusa em voz alta mas recusa.

// ─── INICIO DA REGRA COMPARTILHADA (nao editar sem atualizar a copia do agent) ───
/**
 * De QUE alvo se fala quando uma execucao pede aprovacao.
 *
 * `hashDoAlvo()` cobre acao, ator, recurso E argumentos — e essa forca e o ponto: aprovar um
 * comando num repositorio nao aprova o mesmo comando em outro, e trocar o payload depois do
 * aceite invalida a autorizacao sozinho.
 *
 * O preco e que os dois lados precisam descrever o alvo do MESMO jeito. Quem emite a aprovacao
 * (o handoff, na API) e quem a consome (o gate do agent) estavam descrevendo alvos diferentes:
 * a API punha o payload inteiro em `args` e a raiz em `resource`, o agent punha `{ action }` e
 * `payload.path`. Os hashes nunca casariam, e um envelope que autorizasse um efeito `high`
 * seria recusado no despacho — em voz alta, mas recusado.
 *
 * Por isso a derivacao e UMA, copiada com teste anti-drift em vez de importada: `apps/api` e
 * `apps/agent` sao apps separados, sem dependencia entre eles, e `packages/types` nao e
 * compilado.
 */
export function recursoDaExecucao(payload: Record<string, unknown>): string | null {
  if (typeof payload.path === 'string') return payload.path
  if (typeof payload.root === 'string') return payload.root
  return null
}

export function alvoDaExecucao(
  actionKey: string,
  actor: string,
  payload: Record<string, unknown>,
): { actionKey: string; actor: string; resource: string | null; args: Record<string, unknown> } {
  return { actionKey, actor, resource: recursoDaExecucao(payload), args: payload }
}
// ─── FIM DA REGRA COMPARTILHADA ───
