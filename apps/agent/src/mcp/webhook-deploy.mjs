// G6, fatia 1 (21/11): o webhook de deploy confere DE QUAL repositório veio o push.
//
// Até aqui `/webhook/github-build` disparava o deploy do servidor para qualquer `push` em
// `refs/heads/main` com assinatura válida — sem olhar o repositório. A assinatura prova que quem
// mandou conhece o segredo, não que o push é deste repositório. O plano do G6 mandava configurar o
// webhook do `rayzen-marcenaria` com o mesmo segredo: com isso, todo push na `main` da marcenaria
// redeployaria o Rayzen. Defesa em profundidade: vale mesmo que ninguém configure errado.
//
// Módulo puro e separado do servidor de propósito: `rayzen-mcp-http.mjs` abre uma porta ao ser
// importado, então só dá para testar a regra de verdade se ela morar fora dele.

/** O único repositório cujo push em `main` publica este servidor. */
export const REPO_DO_DEPLOY = 'marcelorayzen/rayzen-ai-private'

/**
 * Decide se um evento do GitHub (assinatura JÁ conferida) dispara o deploy.
 * Devolve `{ deployar, motivo }` — o motivo vai para o log quando o evento é ignorado.
 */
export function decidirDeploy(evento, payload, repoDoDeploy = REPO_DO_DEPLOY) {
  if (evento !== 'push') return { deployar: false, motivo: `evento ${evento ?? 'ausente'} não é push` }
  if (payload?.ref !== 'refs/heads/main') return { deployar: false, motivo: `push em ${payload?.ref ?? 'ref ausente'}, não em main` }
  const repo = typeof payload?.repository?.full_name === 'string' ? payload.repository.full_name : ''
  // Comparação sem diferenciar maiúsculas: o GitHub trata dono/repositório assim, e um nome em outra
  // grafia não pode nem passar nem ser recusado por acaso.
  if (repo.toLowerCase() !== repoDoDeploy.toLowerCase()) {
    return { deployar: false, motivo: `push de ${repo || 'repositório ausente'}, não de ${repoDoDeploy}` }
  }
  return { deployar: true, motivo: 'push em main do repositório do deploy' }
}
