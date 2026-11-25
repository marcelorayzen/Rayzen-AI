import { PROJETO_GERAL_STATUS } from './escopo-geral.const'

/**
 * ── O ciclo de vida do projeto, definido por uma PESSOA ─────────────────────
 *
 * Até 20/09 havia um estado só: `active`, em **10 de 10** projetos. A única exceção era o Geral,
 * e ele tem `geral` porque nós o inventamos para outra coisa.
 *
 * O que isso afirmava, medido no mesmo dia:
 *
 *     Ray coach            conteúdo parado desde 11/05   ·  active
 *     Rayzen-PDV                                 12/05   ·  active
 *     Banco Imobiliário                          27/05   ·  active
 *     marcelorayzen-site                         28/06   ·  active
 *
 * Seis dos onze não tiveram **uma** chamada de LLM em 30 dias. Chamar isso de ativo é o sistema
 * afirmando o que não é — e a afirmação sai para fora: o painel diz "10 projetos ativos", o
 * invariante `projeto_ativo_no_catalogo` conta os dez e fica verde, e o seletor de projeto faz
 * rolar por seis mortos.
 *
 * ── Isto NÃO é economia, e a medição desmentiu a hipótese ───────────────────
 *
 * A pergunta que abriu o trabalho era quanto os projetos parados custam. Resposta: **quase nada**.
 * O `SmartCheckpointService` já exige ≥5 eventos na janela, então projeto parado não dispara LLM;
 * o ciclo de invariantes grava 10 relatórios em 48h por projeto, que é o batimento de 6h por
 * desenho. Forçar um argumento de custo aqui seria inventar justificativa.
 *
 * O que justifica é **verdade**: o mesmo motivo do `domain` em 18/09 — tirar do palpite e pôr no
 * dado. E há um segundo, dito pelo Marcelo: *"fiz, está pronto, mas posso reabrir"* é um estado de
 * ciclo de vida que não tinha onde morar.
 *
 * ── Por que não usar o `stage` que já existe ────────────────────────────────
 *
 * `ProjectState.stage` tem `paused` entre os valores válidos. Mas ele é **escolhido pelo LLM a
 * cada refresh** — o campo que oscilou **92 vezes em 84 dias** entre `building` e `stabilizing`
 * sem evento que justificasse, e que por isso ganhou âncora e validação em 17/08.
 *
 * Um estado que o modelo pode reverter sozinho não é uma decisão do dono. Daí este morar em
 * `Project.status`, escrito só por `PATCH /projects/:id`.
 */

/** `geral` fica fora: é escopo, não ciclo de vida, e ninguém deve poder atribuí-lo a um projeto. */
export const STATUS_DE_PROJETO = ['active', 'paused', 'done'] as const
export type StatusDeProjeto = typeof STATUS_DE_PROJETO[number]

export function ehStatusValido(v: unknown): v is StatusDeProjeto {
  return typeof v === 'string' && (STATUS_DE_PROJETO as readonly string[]).includes(v)
}

/**
 * Quais status os ciclos automáticos varrem.
 *
 * `paused` e `done` saem da varredura — é o efeito que o estado existe para produzir. `geral`
 * nunca entrou: ele ficou de fora em 18/09 justamente para não ganhar checkpoint por LLM sobre
 * conversa solta.
 *
 * Uma lista, e não `status !== 'paused'`: negação deixa passar qualquer valor novo por omissão, e
 * um status inventado no banco entraria na varredura sem ninguém decidir isso.
 */
export const STATUS_QUE_OS_CICLOS_VARREM: readonly string[] = ['active']

/**
 * Reabrir não perde nada, e é isso que torna `done` seguro de usar.
 *
 * Nada é apagado ao pausar ou concluir: eventos, documentos, estado e histórico continuam onde
 * estão, e a busca continua alcançando-os. O que muda é só quem os varre sozinho. Voltar é
 * `PATCH /projects/:id` com `active`.
 */
export function ehVarridoPorCiclos(status: string | null | undefined): boolean {
  return !!status && STATUS_QUE_OS_CICLOS_VARREM.includes(status)
}

/** O Geral continua tendo status próprio — declarado aqui para quem precise excluí-lo. */
export { PROJETO_GERAL_STATUS }
