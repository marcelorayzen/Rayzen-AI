import { resolverWorkdir } from '../exec/workdir'

/**
 * ── Onde a sessão supervisionada vai rodar ───────────────────────────────────
 *
 * Terceira peça de A03: com a sessão enfileirada de verdade, o payload que chega ao executor
 * carrega `projectId`, não um caminho. Antes era `projectPath ?? process.cwd()`, e a ausência de
 * caminho fazia a sessão rodar contra o diretório de onde o agent foi iniciado — sem erro, sem
 * aviso, e com o relatório final falando de um repositório que ninguém pediu.
 *
 * A regra é a da Fase 3 do plano de execução tipada: **`projectId` que não resolve recusa a
 * chamada inteira**. Não cai em `process.cwd()` e não cai num `projectPath` residual que tenha
 * vindo junto — cair para um caminho arbitrário é o comportamento que a fase existe para
 * eliminar, e seria pior aqui do que num `run_command`, porque a sessão escreve código.
 *
 * `resolverWorkdir()` nunca lança: devolve `null` para projeto sem `repoSlug`, sem checkout nesta
 * máquina, ou com a API fora do ar. Quem chama decide, e a decisão aqui é recusar.
 *
 * Arquivo próprio para ser testável sozinho: `supervisedSession()` fala com a API, com o Claude e
 * com o git, e a escolha do diretório não deveria depender de nada disso para ser verificada.
 */
export async function resolverBaseDaSessao(payload: {
  projectId?: string
  projectPath?: string
}): Promise<{ base: string } | { erro: string }> {
  const { projectId, projectPath } = payload

  if (projectId) {
    const caminho = await resolverWorkdir(projectId)
    if (!caminho) {
      return {
        erro:
          `Não foi possível resolver o diretório do projeto ${projectId} nesta máquina ` +
          `(sem repoSlug cadastrado, sem checkout local, ou API indisponível). ` +
          `A sessão foi recusada em vez de rodar num diretório arbitrário.`,
      }
    }
    return { base: caminho }
  }

  // Caminho legado: chamada que já traz o diretório pronto.
  if (projectPath) return { base: projectPath }

  return { base: process.cwd() }
}
