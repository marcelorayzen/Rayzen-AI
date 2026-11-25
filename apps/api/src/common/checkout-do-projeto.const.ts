/**
 * Onde o checkout de um projeto esta no disco — e por que isso precisa ser gravado.
 *
 * O gerador cria a pasta com o nome CRU ("Sistema de Controle Financeiro Pessoal") e registra
 * o projeto com o slug em kebab ("sistema-de-controle-financeiro-pessoal"). Sem guardar o
 * caminho, "qual pasta e deste projeto?" vira casamento de nome, e `repo-slug.mjs` compensa
 * devolvendo duas grafias. Medido em 24/09: **3 dos 6 projetos reais** tem pasta diferente do
 * slug — o casamento funciona por tolerancia, nao por construcao.
 *
 * ── Por que validar, e o que NAO validar ────────────────────────────────────
 * Caminho relativo nao serve de vinculo canonico: ele so significa alguma coisa junto com o
 * `cwd` de quem o escreveu, e esse `cwd` nao esta gravado em lugar nenhum. Aceitar um seria
 * guardar uma resposta que depende de uma pergunta perdida.
 *
 * Existencia **nao** e validada, de proposito. Quem grava e a maquina que materializou o
 * projeto; quem le pode ser o servidor, que nao enxerga aquele disco. Exigir `existsSync`
 * aqui recusaria o caminho certo por estar sendo lido do lugar errado — e a checagem util
 * (a pasta ainda esta la?) pertence a reconciliacao, na maquina, no momento de usar.
 */

/** Windows (`C:\x`, `\\servidor\share`) ou POSIX (`/x`). Nada de relativo. */
const ABSOLUTO = /^([a-zA-Z]:[\\/]|\\\\|\/)/

export function ehCaminhoDeCheckoutValido(caminho: string): boolean {
  return typeof caminho === 'string' && caminho.trim().length > 0 && ABSOLUTO.test(caminho)
}
