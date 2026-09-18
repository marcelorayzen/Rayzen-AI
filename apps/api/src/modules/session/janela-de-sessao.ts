/**
 * ── Uma conversa continua; três canais discordavam de quando ela acaba ──────
 *
 * `sessionId` nunca foi uma tabela: é uma string em `conversation_messages`, e a "sessão" é
 * derivada dela. Ou seja, **a identidade da conversa já era agnóstica de canal** — o que divergia
 * era a política de cada um, e as duas estavam erradas em direções opostas:
 *
 *   web       → `crypto.randomUUID()` em todo carregamento de página. Recarregar corta a conversa.
 *   Telegram  → um id por `(chatId, threadId)`, criado uma vez e **nunca rotacionado**: um chat é
 *               uma sessão eterna (a mais antiga é de 31/05).
 *
 * ── O estrago, medido em produção (18/09) ───────────────────────────────────
 *
 * | | |
 * |---|---:|
 * | sessões com interlocutor humano | 270 |
 * | **com UM único turno** | **254** |
 * | com 2 ou mais | 16 |
 * | maior sessão | 6 turnos |
 *
 * 94% de turno único parece "ele só faz perguntas soltas". O intervalo entre sessões diz outra
 * coisa: **57 começaram menos de 5 minutos depois da anterior terminar**, e 99 entre 5 e 30
 * minutos. Isso é conversa cortada, não conversa curta — o turno 2 virava sessão nova.
 *
 * ── O limiar é julgamento, e a medição diz isso explicitamente ──────────────
 *
 * A distribuição dos 267 intervalos **não tem vale**: p50 = 22 min, p75 = 84 min, e a curva é
 * suave (≤10min: 94 · ≤20min: 128 · ≤30min: 156 · ≤45min: 179). Não existe fronteira a descobrir,
 * então qualquer número é escolha — e fingir que 30 saiu do dado seria inventar precisão.
 *
 * 30 minutos funde 156 dos 267 limites. A troca aceita: o risco de juntar assuntos diferentes
 * contra o de continuar cortando. O primeiro é recuperável (o orquestrador injeta as últimas 20
 * mensagens, então contexto alheio degrada, não corrompe); o segundo apaga o fio da conversa.
 *
 * `SESSION_JANELA_MIN` no ambiente muda sem deploy de código.
 */

export const JANELA_PADRAO_MIN = 30

/** A sessão mais recente do mesmo escopo, se houver. */
export interface SessaoCandidata {
  sessionId:       string
  ultimaAtividade: Date
}

export interface DecisaoDeSessao {
  sessionId: string
  /** `true` quando atravessou — é isto que faz o Telegram continuar o que a web começou. */
  retomada:  boolean
  /** Idade da candidata em minutos; `null` quando não havia nenhuma. */
  idadeMin:  number | null
}

export function janelaConfigurada(env: NodeJS.ProcessEnv = process.env): number {
  const bruto = Number(env.SESSION_JANELA_MIN)
  // Zero é um valor legítimo com significado próprio ("nunca retome"), então só um número
  // inválido ou negativo cai no padrão. `Number('')` é 0, daí o teste de string vazia antes.
  if (!env.SESSION_JANELA_MIN || !Number.isFinite(bruto) || bruto < 0) return JANELA_PADRAO_MIN
  return bruto
}

/**
 * Retoma a conversa recente, ou começa uma.
 *
 * `novoId` entra como função em vez de a função cunhar o id: identidade é de quem persiste, e um
 * teste precisa poder prever o valor. Mesma razão pela qual o `ProjectStateService` parou de pedir
 * `id` ao LLM.
 */
export function decidirSessao(
  candidata: SessaoCandidata | null,
  novoId: () => string,
  agora: Date = new Date(),
  janelaMin: number = janelaConfigurada(),
): DecisaoDeSessao {
  if (!candidata) return { sessionId: novoId(), retomada: false, idadeMin: null }

  const idadeMin = (agora.getTime() - candidata.ultimaAtividade.getTime()) / 60_000

  // Futuro é relógio fora de sincronia, não conversa do futuro — e o servidor já derrapou 8h43m
  // uma vez. Tratar como recente seria retomar uma sessão por causa de um defeito de relógio;
  // arredondar para zero mantém a decisão dentro da janela sem inventar idade negativa.
  const idade = Math.max(0, idadeMin)

  if (idade <= janelaMin) {
    return { sessionId: candidata.sessionId, retomada: true, idadeMin: Number(idade.toFixed(1)) }
  }
  return { sessionId: novoId(), retomada: false, idadeMin: Number(idade.toFixed(1)) }
}
