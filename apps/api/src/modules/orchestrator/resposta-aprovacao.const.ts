/**
 * ── A mesma decisão de autorização do A02, agora também no orquestrador ──────
 *
 * Cópia declarada de `apps/agent/src/actions/resposta-aprovacao.ts`, barrada por teste anti-drift
 * (`resposta-aprovacao.spec.ts` lê aquele arquivo como texto e falha se divergir) — mesmo arranjo
 * de `memory-ranking.const.ts` e `event-derived-text.const.ts`, e pelo mesmo motivo:
 * `@rayzen/types` não é compilado, então importar valor de lá derruba o container.
 *
 * ── O que existia aqui, e o que custou ──────────────────────────────────────
 *
 *     const CONFIRM_WORDS = /^(confirmar|confirma|sim|ok|pode|executar|executa|yes|run)$/i
 *     const CANCEL_WORDS  = /^(cancelar|cancela|n[aã]o|nao|no|cancel)$/i
 *
 * Lista fechada e **ancorada**: só a palavra inteira, sozinha. Medido em produção em 15/09, no
 * primeiro teste real da jornada pelo Telegram — o card diz *"Confirme para executar ou cancele
 * para abortar"* e o usuário respondeu:
 *
 *     Confirmo
 *
 * `^confirma$` não casa "confirmo". A resposta caiu na classificação normal, o registro mostra
 * `module: system` em vez de `jarvis`, e o modelo respondeu *"não consigo capturar ou enviar
 * imagens da tela"* — inventando uma incapacidade que ele tinha OFERECIDO uma mensagem antes.
 *
 * É o A02 outra vez, no caminho ao lado: **o bot oferecia uma opção que o próprio parser não
 * aceitava.** Lá eram "Aprovado, continue" e "Rejeitar e corrigir", as opções que ele mesmo
 * numerava; aqui é o verbo do próprio card, conjugado na primeira pessoa.
 *
 * A correção não é acrescentar "confirmo" à lista — isso deixaria "pode executar", "beleza" e
 * "aprovado" de fora, e a próxima conjugação seria o próximo defeito. É usar a decisão que já foi
 * construída, testada com tabela de casos e nascida exatamente deste problema.
 *
 * `sem_resposta` continua sendo valor de primeira classe: quem chama é obrigado pelo tipo a dizer
 * o que faz com o silêncio, em vez de ele se comportar como a opção mais permissiva.
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
