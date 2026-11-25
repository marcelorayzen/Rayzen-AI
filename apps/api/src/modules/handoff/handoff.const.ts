import { createHash } from 'crypto'

/**
 * `ProjectHandoff` — o envelope durável que liga brief, versão, autorização e efeitos.
 *
 * ── Por que um envelope, e não "mais uma chamada de execução" ────────────────
 * O broker da Fase 1 já entrega intenção idempotente com lease e fencing, e o
 * `ExecutionApproval` já interpõe uma pessoa com alvo canonicalizado e consumo único. O que
 * nenhum dos dois responde é **o que foi aprovado, exatamente**: a aprovação vive minutos e
 * morre ao ser consumida; a tarefa carrega um payload sem procedência. Quando alguém perguntar
 * daqui a um mês "por que esta pasta existe e quem autorizou", a resposta precisa estar num
 * registro que não expirou junto com a autorização.
 *
 * É a mesma separação da Fase 3: autorização expira, evidência não.
 *
 * ── O conteúdo é versionado, e é por isso que ele é hasheado ────────────────
 * Aprovar um brief e materializar outro é o defeito que o hash existe para impedir — a mesma
 * razão pela qual `hashDoAlvo()` põe `resource` e `args` dentro da assinatura da aprovação.
 * Editar um rascunho **sobe a versão e invalida o que já foi aprovado**, porque autorização se
 * refere a um conteúdo, não a um id.
 */

export type EstadoDoHandoff =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'queued'
  | 'claimed'
  | 'executing'
  | 'reconciling'
  | 'completed'
  // ── saídas ──
  | 'rejected'
  | 'cancelled'
  | 'failed_safe'
  | 'effect_unknown'
  | 'compensated'

/** Estados a partir dos quais nada mais acontece. */
export const ESTADOS_FINAIS: readonly EstadoDoHandoff[] = [
  'completed', 'rejected', 'cancelled', 'failed_safe', 'compensated',
] as const

/**
 * `effect_unknown` **não** é final, e essa é a lição da Fase 1: o caminho de saída dele é
 * reconciliação humana, não o esquecimento. Tratá-lo como final devolveria o defeito que a
 * matriz de crash existe para provar que não acontece mais.
 */
export const TRANSICOES: Readonly<Record<EstadoDoHandoff, readonly EstadoDoHandoff[]>> = {
  draft:             ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'rejected', 'cancelled', 'draft'],
  approved:          ['queued', 'cancelled'],
  queued:            ['claimed', 'cancelled', 'failed_safe'],
  // `reconciling` direto de `claimed` NAO e atalho: acao rapida termina antes do primeiro
  // batimento (o agent renova posse a cada 20s), entao ela nunca passa por `executing`.
  // Sem esta aresta, todo envelope de efeito rapido ficaria preso em `claimed` para sempre.
  claimed:           ['executing', 'reconciling', 'effect_unknown', 'failed_safe'],
  executing:         ['reconciling', 'completed', 'effect_unknown', 'failed_safe'],
  reconciling:       ['completed', 'compensated', 'failed_safe', 'effect_unknown'],
  effect_unknown:    ['completed', 'compensated', 'failed_safe'],
  completed:         [],
  rejected:          [],
  cancelled:         [],
  failed_safe:       [],
  compensated:       [],
}

export function podeTransicionar(de: EstadoDoHandoff, para: EstadoDoHandoff): boolean {
  return TRANSICOES[de]?.includes(para) ?? false
}

export function ehFinal(estado: EstadoDoHandoff): boolean {
  return ESTADOS_FINAIS.includes(estado)
}

/**
 * O que o envelope autoriza. Efeito é declarado, nunca inferido do brief: quem aprova precisa
 * ver a ação e os argumentos exatos que vão rodar, que é a mesma disciplina do `argsHash` da
 * aprovação.
 */
export interface EfeitoDoHandoff {
  actionKey: string
  payload: Record<string, unknown>
}

export interface ConteudoDoHandoff {
  /** Escopo que pediu o trabalho; distinto do projeto que o efeito pode materializar. */
  sourceProjectId?: string
  name: string
  brief: string
  template: string
  root: string
  efeitos: EfeitoDoHandoff[]
  /**
   * DERIVADO do catálogo, nunca aceito do corpo — quem pede não escolhe a própria proteção.
   *
   * Entra no conteúdo para que o hash o cubra: a aprovação se refere a um efeito rodando sob
   * um isolamento específico, e trocar o isolamento depois do aceite mudaria o que foi
   * autorizado sem mudar o id.
   */
  isolamento?: string
}

/**
 * Hash do conteúdo versionado — cobre tudo que alguém leria antes de aprovar.
 *
 * Chaves ordenadas pelo mesmo motivo do `hashDoAlvo()`: `{a,b}` e `{b,a}` são o mesmo envelope,
 * e um hash que discordasse disso recusaria uma aprovação legítima.
 */
export function hashDoConteudo(c: ConteudoDoHandoff): string {
  const canonico = JSON.stringify({
    brief: c.brief,
    efeitos: c.efeitos.map((e) => ({ actionKey: e.actionKey, payload: ordenar(e.payload) })),
    // `?? null` e não omissão: um envelope sem isolamento derivado e outro com `'nenhum'` são
    // coisas diferentes, e colapsá-los faria os dois hashearem igual.
    isolamento: c.isolamento ?? null,
    name: c.name,
    root: c.root,
    template: c.template,
  })
  return createHash('sha256').update(canonico, 'utf8').digest('hex')
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar)
  if (valor && typeof valor === 'object') {
    const origem = valor as Record<string, unknown>
    const destino: Record<string, unknown> = {}
    for (const chave of Object.keys(origem).sort()) destino[chave] = ordenar(origem[chave])
    return destino
  }
  return valor
}

/**
 * A chave de idempotência do handoff deriva do id E da versão.
 *
 * Do id, para que reentregar o mesmo handoff não crie uma segunda pasta — é o "repetição não
 * duplica" que a fase pede. Da versão, porque um envelope editado é outro pedido: reaproveitar
 * a chave faria o broker devolver replay da execução ANTERIOR e a edição nunca aconteceria,
 * silenciosamente.
 */
export function chaveDeIdempotencia(handoffId: string, versao: number): string {
  return `handoff:${handoffId}:v${versao}`
}

/**
 * G6.6 (21/11) — ramo de onde a sessão supervisionada parte (`payload.baseRef`, fatia 4 do G6).
 * Cópia da `refDeBaseValida` de `apps/agent/src/exec/sandbox.ts`, com teste anti-drift que compara
 * as duas: o agent recusa de novo antes do `git`, mas o envelope não pode GRAVAR um ramo que o
 * agent depois recusaria — quem aprova veria uma coisa e a sessão falharia em outra.
 */
export function refDeBaseValida(ref: unknown): ref is string {
  return typeof ref === 'string'
    && /^[A-Za-z0-9._/-]{1,200}$/.test(ref)
    && !ref.startsWith('-') && !ref.startsWith('/') && !ref.endsWith('/')
    && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('.lock')
}
