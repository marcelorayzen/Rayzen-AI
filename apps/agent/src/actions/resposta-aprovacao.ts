/**
 * ── Como a resposta do humano vira decisão — A02 da auditoria de 13/09 ──────────────────────
 *
 * Isto era duas regexes inline dentro do loop de `supervised-session.ts`, e as duas estavam
 * erradas de formas que se somavam:
 *
 *   if (!reply || /\b(aprovad|continu|ok|sim|pode)\b/i.test(reply))   → APROVOU
 *
 *  1. `!reply` fazia o SILÊNCIO entrar no ramo de aprovação. Uma etapa que ninguém respondeu
 *     seguia adiante como se tivesse sido autorizada.
 *  2. `\bpode\b` casa dentro de "não pode" — a negação aprovava.
 *  3. As alternativas são PREFIXOS terminados em `\b`, que nunca fecha entre dois word chars:
 *     `aprovad\b` não casa "aprovado", `rejeit\b` não casa "Rejeitar". As três opções que o
 *     Telegram oferece (`agent-session.service.ts`) caíam todas em "instrução modificada", e a
 *     rejeição ficava inalcançável pelos próprios botões apresentados.
 *
 * Extraído para um arquivo próprio porque decisão de autorização precisa ser testável sozinha,
 * com tabela de casos — não verificada de passagem dentro de um loop de 100 linhas que fala com
 * a API, com o Claude e com o git.
 *
 * **`sem_resposta` é valor de primeira classe**, e é o ponto inteiro: enquanto o silêncio era a
 * ausência de um `else`, ele se comportava como a opção mais permissiva. Agora quem chama é
 * obrigado pelo tipo a dizer o que faz com ele.
 */

export type DecisaoDoUsuario = 'sem_resposta' | 'aprovado' | 'rejeitado' | 'instrucao'

/** Índice puro ("1", "2.", " 3 ") — a mensagem do Telegram numera as opções. */
const INDICE = /^([123])[.)\s]*$/

/**
 * Negação. Medida ANTES de qualquer afirmação: com um negador presente, o resultado nunca é
 * `aprovado`. A ambiguidade cai para o lado que não executa.
 */
const NEGADOR = /\b(nao|nunca|jamais|negativo|nenhum|nem)\b/

/**
 * `pare`/`parar` vão delimitados por `\b`; "para" (preposição) ficou de FORA de propósito —
 * "troque o nome da função para X" é instrução, não ordem de parar.
 */
const REJEICAO = /(rejeit|corrig|desfa|undo|refaz|refaca|errad|reprov|cancel|nunca|jamais|\bpare\b|\bparar\b|nega)/

/** Prefixos SEM `\b` no fim — foi exatamente isso que quebrou a versão anterior. */
const APROVACAO = /(aprovad|aprovo|continu|segue|siga|prossig|beleza|confirm|\bok\b|\bsim\b|\bpode\b|\bmanda\b|\bvai\b|\bisso\b|\bcerto\b)/

/**
 * Mensagem composta SÓ de negação — "não", "nao!", "nem", "no". Estreito de propósito: exige que
 * nada mais reste além de negadores e pontuação. "de jeito nenhum, não" continua caindo em
 * `instrucao` porque sobra texto; não aprova, e ampliar isso sem caso medido seria adivinhar.
 */
const SO_NEGACAO = /^((nao|nunca|jamais|negativo|nenhum|nem|no)[\s,.!]*)+$/

/** Minúsculas e sem acento: "instrução" e "instrucao" são a mesma resposta. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function classificarResposta(reply: string | null | undefined): DecisaoDoUsuario {
  if (reply === null || reply === undefined) return 'sem_resposta'

  const cru = reply.trim()
  if (cru.length === 0) return 'sem_resposta'

  const indice = INDICE.exec(cru)
  if (indice) {
    return indice[1] === '1' ? 'aprovado' : indice[1] === '2' ? 'rejeitado' : 'instrucao'
  }

  const texto = normalizar(cru)

  // Com negador, "aprovado" está fora da mesa. Negar um termo de aprovação ("não pode",
  // "não aprovado", "não continue") é rejeição; negar qualquer outra coisa ("não use cache,
  // use redis") é instrução — nos dois casos a etapa não segue sozinha.
  // Mensagem que é SÓ negação — "não", "nem", "no" — é recusa, não instrução modificada: ela não
  // modifica nada, só recusa. Sem isto um "não" seco caía em `instrucao`; não aprovava, que era o
  // ponto do A02, mas também não registrava a recusa, e quem chama tratava como pedido diferente.
  //
  // Vem ANTES do `NEGADOR` porque "no" não está na lista de negadores e não pode estar: como
  // preposição ele aparece em "faz no projeto X", e tratá-lo como negação ali impediria qualquer
  // aprovação que mencionasse um lugar. Aqui é seguro porque exige a mensagem INTEIRA.
  //
  // Achado em 15/09 escrevendo a tabela de casos do orquestrador, não em produção.
  if (SO_NEGACAO.test(texto)) return 'rejeitado'

  if (NEGADOR.test(texto)) {
    return REJEICAO.test(texto) || APROVACAO.test(texto) ? 'rejeitado' : 'instrucao'
  }

  if (REJEICAO.test(texto)) return 'rejeitado'
  if (APROVACAO.test(texto)) return 'aprovado'

  return 'instrucao'
}
