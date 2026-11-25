/**
 * G6 (21/11/2026) — regras das rotinas, num lugar só. Desenho em
 * docs/decisions/G6-rotinas-desenho.md, decisões do Marcelo em 21/11: limites de 5 min, 6 por hora
 * e uma proposta aberta por rotina; gatilho do GitHub só dos repositórios do próprio Marcelo.
 */

export const STATUS_DA_ROTINA = ['proposta', 'ativa', 'pausada'] as const
export type StatusDaRotina = typeof STATUS_DA_ROTINA[number]

export const EVENTOS_DO_GITHUB = ['pull_request.opened', 'workflow_run.failure'] as const
export type EventoDoGithub = typeof EVENTOS_DO_GITHUB[number]

export const RESULTADOS_DE_EXECUCAO = ['proposto', 'ignorado_duplicado', 'limite', 'proposta_aberta', 'falhou'] as const
export type ResultadoDeExecucao = typeof RESULTADOS_DE_EXECUCAO[number]

/** Do Grok: no mínimo 5 min entre disparos da mesma rotina. */
export const INTERVALO_MINIMO_MIN = 5
/** Teto por hora, por rotina. Acima disso o disparo grava `limite`. */
export const TETO_POR_HORA = 6
/** Uma semana: agenda mais espaçada que isso é engano de unidade, não rotina. */
export const INTERVALO_MAXIMO_MIN = 7 * 24 * 60
/** Histórico mantido por rotina; o resto é podado ao gravar. */
export const EXECUCOES_GUARDADAS = 20

export type Gatilho =
  | { tipo: 'agenda'; intervaloMin: number }
  | { tipo: 'github'; evento: EventoDoGithub }

export type ModeloDaRotina = {
  titulo: string
  objetivo: string
  restricoes: string
  criterioDePronto: string
  detalhes?: string
  aprovacao: 'por_entrega' | 'por_etapa'
}

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Valida e normaliza o gatilho; lança com todos os problemas de uma vez. */
export function validarGatilho(bruto: unknown): Gatilho {
  const g = (bruto ?? {}) as Record<string, unknown>
  if (g.tipo === 'agenda') {
    const n = g.intervaloMin
    if (typeof n !== 'number' || !Number.isInteger(n) || n < INTERVALO_MINIMO_MIN || n > INTERVALO_MAXIMO_MIN) {
      throw new Error(`gatilho de agenda precisa de intervaloMin inteiro entre ${INTERVALO_MINIMO_MIN} e ${INTERVALO_MAXIMO_MIN}`)
    }
    return { tipo: 'agenda', intervaloMin: n }
  }
  if (g.tipo === 'github') {
    if (!EVENTOS_DO_GITHUB.includes(g.evento as EventoDoGithub)) {
      throw new Error(`gatilho do GitHub aceita só ${EVENTOS_DO_GITHUB.join(' ou ')}`)
    }
    // O repositório não vem do gatilho: é o `repoSlug` do projeto da rotina. Assim um evento de
    // outro repositório nunca dispara rotina deste projeto.
    return { tipo: 'github', evento: g.evento as EventoDoGithub }
  }
  throw new Error("gatilho.tipo é 'agenda' ou 'github'")
}

/**
 * Valida o modelo do envelope. Os mesmos três campos obrigatórios da proposta de sessão do Hub
 * (G4.2): objetivo, restrições e critério de pronto — a rotina não pode propor menos do que uma
 * pessoa propondo pela conversa.
 */
export function validarModelo(bruto: unknown): ModeloDaRotina {
  const m = (bruto ?? {}) as Record<string, unknown>
  const titulo = texto(m.titulo)
  const objetivo = texto(m.objetivo)
  const restricoes = texto(m.restricoes)
  const criterioDePronto = texto(m.criterioDePronto)
  const detalhes = texto(m.detalhes)
  const aprovacaoBruta = m.aprovacao ?? 'por_entrega'

  const problemas: string[] = []
  if (!titulo || titulo.length > 120) problemas.push('titulo precisa ter de 1 a 120 caracteres')
  if (objetivo.length < 10) problemas.push('objetivo precisa dizer o que deve existir ao fim')
  if (restricoes.length < 3) problemas.push('restricoes precisa dizer o que não mexer e os limites')
  if (criterioDePronto.length < 10) problemas.push('criterioDePronto precisa dizer como verificar')
  if (aprovacaoBruta !== 'por_entrega' && aprovacaoBruta !== 'por_etapa') problemas.push('aprovacao é por_entrega ou por_etapa')
  if (problemas.length) throw new Error(`modelo recusado: ${problemas.join('; ')}`)
  const aprovacao = aprovacaoBruta as ModeloDaRotina['aprovacao']

  return { titulo, objetivo, restricoes, criterioDePronto, ...(detalhes ? { detalhes } : {}), aprovacao }
}
