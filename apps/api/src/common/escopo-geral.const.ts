/**
 * ── "Sem projeto" deixa de ser ausência e passa a ser um lugar ──────────────
 *
 * Em 17/09 ficou decidido que conversa sem projeto é o **contexto geral**, deliberado. O que se
 * construiu então foi comportamento (declarar a procedência); o dado continuou sendo `projectId
 * NULL` — ou seja, **ausência**. E ausência não distingue nada:
 *
 *  - `registro_sem_projeto` precisou de uma lista de canais (`chat`, `hub`) para separar "geral
 *    deliberado" de "perdeu o dono". Lista que cresce a cada canal novo;
 *  - `Document` não tem `source`, então lá a distinção nem existia;
 *  - e não cabe **mais de um** geral: pessoal e trabalho seriam o mesmo balde.
 *
 * Agora o geral é um `Project` de verdade. O registro tem dono, o invariante fica correto por
 * construção, e o dia em que fizer sentido separar "Geral — pessoal" de "Geral — trabalho" é uma
 * linha a mais, não um redesenho.
 *
 * ── A separação que faz isto funcionar: ESCREVER nele, BUSCAR fora dele ─────
 *
 * O valor do contexto geral é justamente **alcançar o acervo inteiro**. Se o `projectId` do Geral
 * fosse usado também na busca, `memory.search(prompt, 4, GERAL)` traria só o que foi dito no
 * próprio Geral — quase nada — e o contexto geral ficaria pior do que era como ausência.
 *
 * Daí as duas funções serem separadas e o nome dizer qual é qual: `ehEscopoGeral` responde "este
 * pedido é geral?", `escopoDeBusca` responde "com que escopo eu consulto?" — e para o geral a
 * resposta é `undefined`, o mesmo que antes.
 *
 * ── Status próprio, e não `active` ──────────────────────────────────────────
 *
 * `SmartCheckpointService` e o sync do catálogo varrem `status: 'active'`. Com o Geral ativo, ele
 * ganharia checkpoint por LLM a cada 10 minutos (sintetizando um "objetivo" a partir de conversa
 * solta) e 19 invariantes a cada 30 — máquina inteira girando sobre um balde de contexto.
 * `status: 'geral'` fica fora dos dois e continua aparecendo em `GET /projects`, que não filtra.
 */

/**
 * Id fixo, não sorteado: o código precisa reconhecer o Geral sem consultar o banco, e uma busca
 * por nome quebraria no dia em que alguém o renomeasse. Nasce na migração `..._projeto_geral`.
 *
 * Forma de UUID mas obviamente sintético — a coluna é `text`, então o valor é livre; parecer um
 * uuid evita que alguém o trate como dado corrompido ao ver no banco.
 */
export const PROJETO_GERAL_ID = '00000000-0000-4000-8000-000000000001'

export const PROJETO_GERAL_NOME   = 'Geral'
export const PROJETO_GERAL_STATUS = 'geral'

/** O pedido é do contexto geral? `null`/ausente e o próprio Geral são a mesma coisa. */
export function ehEscopoGeral(projectId: string | null | undefined): boolean {
  return !projectId || projectId === PROJETO_GERAL_ID
}

/**
 * Com que escopo consultar memória e contexto.
 *
 * `undefined` para o geral — **de propósito e por valor**: é o que faz a busca varrer o acervo
 * inteiro, que é a razão de o contexto geral existir.
 */
export function escopoDeBusca(projectId: string | null | undefined): string | undefined {
  // `?? undefined` e nao um cast: `null` e `undefined` chegam dos dois lados (Prisma devolve
  // `null`, o HTTP devolve `undefined`) e quem consome espera `string | undefined`.
  return ehEscopoGeral(projectId) ? undefined : (projectId ?? undefined)
}

/**
 * Onde REGISTRAR. O inverso do de cima: escrita sem projeto passa a ter dono.
 *
 * É isto que tira `registro_sem_projeto` da lista de canais — o geral deixa de ser indistinguível
 * de um evento que perdeu o dono, porque ele passa a ter um.
 */
export function escopoDeRegistro(projectId: string | null | undefined): string {
  return projectId && projectId !== PROJETO_GERAL_ID ? projectId : PROJETO_GERAL_ID
}
