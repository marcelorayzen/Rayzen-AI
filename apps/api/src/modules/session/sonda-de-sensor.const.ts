/**
 * ── Sensor que conversa para medir não é conversa ───────────────────────────
 *
 * O invariante `embeddings_respondem`, construído em 17/09, sonda `POST /memory/search` — que é o
 * caminho certo, porque testa embed + pgvector de ponta a ponta em vez de bater na Jina direto.
 * O efeito colateral não foi previsto: `MemoryService.saveBrainExchange()` **persiste toda busca**
 * como um par `user`/`assistant` em `conversation_messages`, e a sonda não mandava `sessionId`.
 *
 * Resultado medido em 18/09, um dia depois: **55 sessões novas**, uma a cada ~10 minutos, e
 * **20 de 20 entradas do histórico** eram a sonda. A conversa real tinha sumido da tela.
 *
 * É a repetição exata do defeito de 19/08 (*"o histórico exibia 20 linhas idênticas chamadas
 * 'Conversa'"*) — com outra string, criada por quem já conhecia a lição.
 *
 * ── Por que PREFIXO e não lista de módulo ───────────────────────────────────
 *
 * `getRecentSessions` já rejeitou a lista de módulos, e o comentário lá diz por quê: ela envelhece
 * a cada módulo novo, e `brain` **é conversa de verdade** quando quem busca é uma pessoa. O que
 * distingue a sonda não é o módulo — é não haver ninguém do outro lado.
 *
 * Então quem sonda **se declara**, na própria identidade do registro. Mesma disciplina do
 * `trace_name` no Langfuse: um chamador que não se identifica é indistinguível de um anônimo na
 * hora de perguntar "quem é isso?".
 *
 * O registro continua existindo — dá para auditar que a sonda rodou. Ele só deixa de se passar
 * por conversa.
 */

export const PREFIXO_SONDA = 'sonda:'

/** Id estável da sonda de embeddings. Estável de propósito: ela reusa UM fio em vez de criar um a cada 10 min. */
export const SESSAO_SONDA_EMBEDDINGS = `${PREFIXO_SONDA}embeddings`

export function ehSondaDeSensor(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith(PREFIXO_SONDA)
}

/**
 * Filtro Prisma para excluir sondas de uma consulta de conversa.
 *
 * Separado da função acima porque um é decisão em memória e o outro atravessa para o banco — e
 * repetir a string literal nos dois lugares é como eles divergem.
 */
export const FORA_AS_SONDAS = { sessionId: { not: { startsWith: PREFIXO_SONDA } } } as const
