/**
 * taskTypes do benchmark — lista canônica.
 *
 * Estava duplicada em QaScientistService e InvariantsService, que é o tipo de
 * divergência que só aparece quando já causou dano: o invariante validaria contra
 * uma lista e o experimento contra outra.
 *
 * Um taskType é um par (tipo de entrada, FORMATO de saída). Misturar formatos no
 * mesmo taskType torna o conjunto não-mensurável: nenhum prompt pontua bem nos dois
 * ao mesmo tempo, e o fitness passa a medir a incoerência do conjunto em vez da
 * qualidade do prompt. Foi o que aconteceu com `classify` até 2026-08-13, quando
 * ele misturava 11 rótulos simples com 7 objetos JSON.
 */
export const TASK_TYPES = [
  /** Atividade de sessão → categoria do trabalho ("refactor", "deploy", "testing"). */
  'classify',
  /** Evento cru do hook → schema de evento ({type, source, intent}). */
  'classify_event',
  /** Texto longo → resumo curto em PT-BR. */
  'summarize',
  /** Contexto do projeto → síntese estruturada. */
  'context_synthesis',
] as const

export type TaskType = typeof TASK_TYPES[number]

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v)
}
