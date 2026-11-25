/**
 * ── "Sem mecanismo ativo para lembrar, monitorar ou agir depois, digo isso" ───
 *
 * A frase é do SOUL. Até 15/09 não havia mecanismo nenhum atrás dela — e o sistema fazia pior que
 * ficar calado: o prompt do classificador listava, entre os exemplos de jarvis,
 *
 *     "me notifica daqui 10 min"
 *
 * `jarvis:notify` recebe `{ title, message }`. **Não tem atraso.** Não existe agendador, lembrete
 * ou follow-up em lugar nenhum da API — `ProactiveService` calcula recomendações sob demanda, é
 * pull, não push. Então o pedido era aceito, roteado, e o toast disparava NA HORA, com a resposta
 * dando a entender que ficou agendado.
 *
 * É a mesma lição já registrada quando se tirou do SOUL o *"apresentar resultado em formato
 * operacional: decisão, plano, checklist"*: **proibição abstrata perde para instrução concreta.**
 * Lá a instrução concreta estava na personality; aqui estava no prompt do classificador.
 *
 * Tirar o exemplo faz o sistema parar de convidar o pedido. Esta função é a outra metade: quando o
 * pedido vier mesmo assim, ele é recusado com o motivo, em vez de executado agora e reportado como
 * se tivesse sido agendado.
 *
 * ── Por que só expressões explícitas de futuro ──────────────────────────────
 *
 * O falso-positivo aqui é caro: recusaria uma ação que funciona. "mostra os logs das últimas 2
 * horas" fala de tempo e é PASSADO — fica de fora porque a âncora é o marcador de futuro
 * (`daqui`, `em N`, `amanhã`, `toda`), nunca a unidade de tempo sozinha.
 */

/** Unidades aceitas depois de um marcador de futuro. */
const UNIDADE = '(?:min|mins|minuto|minutos|h|hora|horas|dia|dias|semana|semanas|mes|meses)'

const MARCADORES: RegExp[] = [
  // "daqui 10 min", "daqui a 2 horas"
  new RegExp(`\\bdaqui\\s+(?:a\\s+)?\\d+\\s*${UNIDADE}\\b`),
  // "em 10 minutos" — exige número + unidade, então "em produção" não casa
  new RegExp(`\\bem\\s+\\d+\\s*${UNIDADE}\\b`),
  // "depois de 30 min", "após 1 hora"
  new RegExp(`\\b(?:depois de|apos|após)\\s+\\d+\\s*${UNIDADE}\\b`),
  // datas e horários futuros
  /\bamanh[ãa]\b/,
  /\b(?:semana|mes|mês)\s+que\s+vem\b/,
  /\b[àa]s\s+\d{1,2}(?:[:h]\d{0,2})?\b/,
  // recorrência: "todo dia", "toda segunda", "a cada 30 min"
  /\btod[oa]s?\s+(?:o\s+|a\s+)?(?:dia|semana|mes|mês|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/,
  new RegExp(`\\ba cada\\s+\\d+\\s*${UNIDADE}\\b`),
]

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Trecho que pede ação no futuro, ou `null`. Devolve o TRECHO e não um booleano porque a recusa
 * precisa citar o que entendeu — "não consigo agendar" sem dizer o quê é indistinguível de uma
 * recusa genérica, e o usuário não descobre se o problema foi a ação ou o horário.
 */
export function pedeAcaoNoFuturo(prompt: string): string | null {
  const texto = normalizar(prompt)
  for (const marcador of MARCADORES) {
    const achado = marcador.exec(texto)
    if (achado) return achado[0]
  }
  return null
}

// `respostaSemAgendador` foi removida em 17/09. Ela dizia "não tenho mecanismo para agir depois",
// e isso deixou de ser verdade no instante em que a fila passou a respeitar `delay`. Texto morto
// que afirma algo falso é a mesma categoria do sufixo `jarvis` removido ontem: ninguém o corrige
// porque ninguém o vê falhar. Quem recusa agora é `respostaSemAgendadorAbsoluto`, e ela recusa a
// HORA — não a capacidade.

/** Teto de agendamento: 7 dias. Além disso o `delay` do Bull vira aposta sobre o processo viver. */
const ATRASO_MAXIMO_MS = 7 * 24 * 60 * 60 * 1000

const EM_MS: Record<string, number> = {
  min: 60_000, mins: 60_000, minuto: 60_000, minutos: 60_000,
  h: 3_600_000, hora: 3_600_000, horas: 3_600_000,
  dia: 86_400_000, dias: 86_400_000,
  semana: 604_800_000, semanas: 604_800_000,
}

/** Formas RELATIVAS, as únicas sem ambiguidade de fuso: "daqui 10 min", "em 2 horas". */
const RELATIVO = new RegExp(
  `\\b(?:daqui\\s+(?:a\\s+)?|em\\s+|depois\\s+de\\s+|apos\\s+)(\\d{1,4})\\s*(${Object.keys(EM_MS).join('|')})\\b`,
)

/**
 * ── O que dá para agendar sem inventar, e o que não dá ───────────────────────
 *
 * `pedeAcaoNoFuturo` acima detecta QUALQUER marcador de futuro, e por muito tempo a resposta a
 * todos eles foi a mesma: recusar dizendo que não havia mecanismo. Agora há — a fila do Bull
 * aceita `delay`, e `jaEstaNaHora()` no claim faz o atraso ser respeitado.
 *
 * Mas só as formas **relativas** entram. "amanhã às 9h" e "toda segunda" continuam recusadas, e o
 * motivo não é preguiça:
 *
 *  - **Fuso.** O servidor roda em UTC; Marcelo está em BRT. "às 9h" precisaria de um fuso do
 *    usuário que não existe em lugar nenhum do modelo de dados. Chutar erraria por três horas, e
 *    um lembrete que chega na hora errada é pior que um lembrete recusado.
 *  - **Recorrência.** `delay` agenda UMA vez. `repeat` do Bull existe, mas job repetível sem tela
 *    para listar, pausar e remover vira lixo que ninguém sabe desligar — e esta casa já tem a
 *    lição das 6 missões `pending` de junho.
 *
 * Recusar dizendo qual das duas faltou é honesto; agendar errado não é.
 */
export function atrasoDoPedido(prompt: string): { ms: number; trecho: string } | null {
  const texto = normalizar(prompt)
  const m = RELATIVO.exec(texto)
  if (!m) return null

  const quantidade = Number(m[1])
  const unidade    = EM_MS[m[2]]
  if (!quantidade || !unidade) return null

  const ms = quantidade * unidade
  if (ms <= 0 || ms > ATRASO_MAXIMO_MS) return null

  return { ms, trecho: m[0] }
}

/** Quando entendeu o pedido mas não a hora — diz qual das duas faltou. */
export function respostaSemAgendadorAbsoluto(trecho: string): string {
  return [
    `Entendi "${trecho}", mas só consigo agendar por tempo relativo — "daqui 30 min", "em 2 horas".`,
    '',
    'Horário do relógio eu não agendo porque não tenho seu fuso registrado, e errar por três horas',
    'é pior que recusar. Recorrência ("toda segunda") também não, porque não há onde listar e',
    'desligar um job repetido depois.',
  ].join('\n')
}
