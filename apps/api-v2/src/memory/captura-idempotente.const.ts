import { createHash } from 'crypto'
import type { CreateKnowledgeProposalDto } from './dto/knowledge.dto'

/**
 * O payload normalizado de uma captura — e o que "normalizar" pode e não pode fazer.
 *
 * A chave de idempotência sozinha não basta: ela diz "é a mesma captura", e o sistema
 * precisa saber se é a mesma captura com o MESMO conteúdo. Daí o hash. Ele existe para
 * responder uma pergunta só: duas requisições com a mesma chave estão pedindo a mesma
 * coisa?
 *
 * ── O risco da normalização é assimétrico ──────────────────────────────────────
 * Normalizar de menos produz conflito falso: o produtor manda `2026-09-24T00:00:00Z` na
 * primeira tentativa e `2026-09-24T00:00:00.000Z` na segunda, o mesmo instante recebe
 * hashes diferentes, e uma retentativa legítima toma HTTP 409. Irritante, visível,
 * corrigível.
 *
 * Normalizar DEMAIS produz o oposto, e o oposto é o perigoso: dois payloads diferentes
 * viram o mesmo hash, a segunda captura é reconhecida como replay e o conteúdo novo
 * **nunca entra** — com HTTP 200 e um id válido na resposta. Ninguém procura o que
 * respondeu sucesso.
 *
 * Por isso normaliza-se só o que é representação, nunca o que é conteúdo: ordem de chave
 * (que JSON não promete), e instante (que tem mais de uma grafia para o mesmo ponto no
 * tempo). `content` não é aparado nem colapsado — espaço dentro de conteúdo É conteúdo.
 *
 * ── Por que a lista é explícita ────────────────────────────────────────────────
 * Serializar o DTO inteiro seria mais curto e erraria calado na direção contrária: um
 * campo novo passaria a compor o hash sem ninguém decidir isso, e um campo renomeado
 * mudaria todos os hashes existentes de uma vez. A lista é conferida por teste que muta
 * campo a campo — se um campo do DTO não altera o hash, o teste reprova.
 */
const CAMPOS_DA_CAPTURA = [
  'scopeType', 'projectId', 'logicalKey', 'content', 'knowledgeType',
  'sourceType', 'sourceIdentity', 'sourceContent', 'producer', 'producerVersion',
  'sensitivity', 'retentionPolicy', 'retainUntil', 'validFrom', 'validUntil',
  'metadata',
] as const satisfies ReadonlyArray<Exclude<keyof CreateKnowledgeProposalDto, 'idempotencyKey'>>

const CAMPOS_DE_INSTANTE = new Set<string>(['retainUntil', 'validFrom', 'validUntil'])

export function normalizarPayloadDeCaptura(dto: CreateKnowledgeProposalDto): string {
  const normalizado: Record<string, unknown> = {}
  for (const campo of CAMPOS_DA_CAPTURA) {
    const valor = dto[campo]
    // Ausente e `undefined` são a mesma coisa para quem escreveu o payload, então os dois
    // saem do hash. `null` fica: mandar `null` é uma escolha, e apagar a diferença entre
    // "não mandei" e "mandei vazio" seria normalizar conteúdo.
    if (valor === undefined) continue
    normalizado[campo] = CAMPOS_DE_INSTANTE.has(campo) && typeof valor === 'string'
      ? instanteCanonico(valor)
      : valor
  }
  // `ordenar` no objeto inteiro, e não um replacer de chaves no `stringify`: o replacer em
  // forma de array filtra chaves em TODO nível, então as chaves de `metadata` sumiriam do
  // hash por não constarem da lista de campos do topo — um payload alterado só no metadata
  // passaria como replay.
  return JSON.stringify(ordenar(normalizado))
}

export function hashDoPayloadDeCaptura(dto: CreateKnowledgeProposalDto): string {
  return createHash('sha256').update(normalizarPayloadDeCaptura(dto), 'utf8').digest('hex')
}

/**
 * O namespace vem da autenticação, nunca do corpo.
 *
 * Se o produtor pudesse declará-lo, a chave de idempotência de um consumidor colidiria com
 * a de outro — e colisão aqui não é erro visível: é uma captura respondendo com a proposta
 * de terceiro, como replay legítimo. O principal já está resolvido pelo guard; usá-lo é de
 * graça e fecha a porta.
 */
export function namespaceDoPrincipal(principal: { kind: string; subject: string }): string {
  return `${principal.kind}:${principal.subject}`
}

/** Mesmo instante, uma grafia só. Data inválida fica como veio — quem valida é o DTO. */
function instanteCanonico(valor: string): string | number {
  const instante = Date.parse(valor)
  return Number.isNaN(instante) ? valor : instante
}

/** Ordem de chave é representação, não conteúdo: `{a,b}` e `{b,a}` são o mesmo payload. */
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
