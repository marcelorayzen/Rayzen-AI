/**
 * Quando uma versão canônica ainda vale — a regra, num lugar só.
 *
 * Ela nasceu embutida na busca (`memory.service.ts`), como condição inline dentro do
 * laço que monta as projeções. O ContextPack precisa da MESMA pergunta para decidir o
 * que entra num pacote autorizado, e copiá-la para lá seria repetir a família de defeito
 * que esta casa já documentou três vezes: `ehTextoDerivadoDeEvento` valendo na escrita e
 * não na leitura, `trecho-de-terceiro` valendo num caminho do Brain e não no outro, as
 * quatro `SAFE_ROOTS` divergentes. Regra aplicada num lugar só é regra que já divergiu,
 * só ainda não se sabe.
 *
 * O que o vizinho acrescenta continua sendo do vizinho: a busca exige, ALÉM disto, que a
 * projeção vetorial esteja `ready`. Vigência é sobre o conhecimento; `ready` é sobre a
 * cópia dele no índice — e o pacote não passa pelo índice.
 */

export type MotivoDeNaoVigencia = 'superseded' | 'not_yet_valid' | 'expired'

export interface ConhecimentoDatado {
  status: string
  validFrom: Date | null
  validUntil: Date | null
}

/**
 * `null` quando vale agora; caso contrário, POR QUE não vale.
 *
 * Devolve o motivo em vez de um booleano porque quem verifica um pacote precisa dizer ao
 * leitor o que mudou desde que o pacote foi servido — "não reproduz" sem causa é a mesma
 * ausência de informação que faz alguém concluir errado. O booleano fica derivado logo
 * abaixo, para quem só precisa filtrar.
 */
export function motivoDeNaoVigencia(
  conhecimento: ConhecimentoDatado,
  agora: Date = new Date(),
): MotivoDeNaoVigencia | null {
  if (conhecimento.status !== 'active') return 'superseded'

  const instante = agora.getTime()
  if (conhecimento.validFrom && conhecimento.validFrom.getTime() > instante) return 'not_yet_valid'
  // Estritamente maior: o instante exato de `validUntil` é o primeiro em que o
  // conhecimento já não vale. A busca sempre usou essa borda; mudá-la aqui faria o
  // pacote e a busca discordarem por um milissegundo — a divergência mais difícil de ver.
  if (conhecimento.validUntil && conhecimento.validUntil.getTime() <= instante) return 'expired'

  return null
}

export function conhecimentoVigente(
  conhecimento: ConhecimentoDatado,
  agora: Date = new Date(),
): boolean {
  return motivoDeNaoVigencia(conhecimento, agora) === null
}
