import { rodarHelper, type ExecutorDeHelper } from '../exec/executar-helper'

/**
 * Notificação — Fase 1-A. Título e mensagem vão por **stdin como JSON**; nada é interpolado.
 *
 * ## O que havia antes
 *
 * O script era montado por template com `${title}` e `${message}` dentro, e o "sanitizador"
 * trocava apenas `"` por `'`. Provado em 07/09, montando a string sem executar: o payload
 * `$(Write-Output PWNED)` **sobrevive** — ele não tem aspas, e cai dentro de uma string de
 * aspas duplas do PowerShell, onde `$( )` é subexpressão e executa.
 *
 * O fallback de balloon tinha a mesma forma, interpolando os dois valores de novo.
 *
 * ## Por que JSON por stdin, e não escape
 *
 * `ConvertFrom-Json` trata o conteúdo como **dado**, e o `InnerText` do XmlDocument escapa o
 * que precisa ser escapado no XML — coisa que concatenação de string nunca fez. O argv contém
 * só o caminho do helper, que é constante.
 *
 * O truncamento continua: título 100, mensagem 250. Não é defesa — é limite de exibição do
 * toast. Tratá-lo como defesa foi parte do problema anterior.
 */
export async function notify(
  payload: { title: string; message: string },
  executor?: ExecutorDeHelper,
): Promise<{ notified: boolean }> {
  const entrada = JSON.stringify({
    titulo:   payload.title.slice(0, 100),
    mensagem: payload.message.slice(0, 250),
  })

  try {
    rodarHelper('notify', entrada, executor)
    return { notified: true }
  } catch {
    // Sem fallback que interpola. A notificação é conveniência: falhar calado aqui é melhor
    // que manter um segundo caminho com o mesmo defeito — que era exatamente o que o balloon
    // fazia, reintroduzindo a interpolação no `catch` do caminho "seguro".
    return { notified: false }
  }
}
