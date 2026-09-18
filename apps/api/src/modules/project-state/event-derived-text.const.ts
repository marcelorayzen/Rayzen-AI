/**
 * Reconhece texto que só repete o que uma ferramenta fez.
 *
 * Vive num arquivo próprio porque a V2 precisa da MESMA regra: o
 * `ProjectStateService.serialize()` limpa na leitura, mas o `V1BridgeService` da V2 lê
 * a linha crua do Prisma e não passa por ele — então o mesmo ProjectState respondia
 * duas coisas diferentes conforme quem perguntava.
 *
 * A cópia é consciente, como a de `memory-ranking`: `packages/types` **não é
 * compilado**, e importar valor de lá derruba o container. O drift é barrado por
 * `event-derived-text.spec.ts` na api-v2, que lê ESTE arquivo como texto e falha se
 * divergir.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────────
 * Até 2026-08-17 o `isNoise` da síntese classificava evento por CAMPO (`type`/`intent`)
 * em vez de pela FORMA do conteúdo, então 292 ecos `Edit:`/`Write:` em 7 dias entravam
 * como sinal — 20 deles com `intent: 'decision'`, o peso máximo do pipeline. O prompt
 * perguntava o objetivo do projeto exibindo 80 linhas de caminho de arquivo, e o modelo
 * respondia ao que via: `Realizar alterações nos arquivos orders.ts, package.json e
 * schema.prisma` foi o objetivo do Rayzen Commerce por **75 dias**.
 */

/**
 * Fases válidas de um projeto.
 *
 * Até 2026-08-17 `derived.stage` ia **cru** do LLM para o banco, sem validação — mesma
 * família do `hipotese_com_tasktype_valido`, onde o modelo gravou
 * `"classify|summarize|context_synthesis|null"` (o placeholder do schema) como valor.
 */
export const STAGES_VALIDOS = ['discovery', 'building', 'stabilizing', 'maintaining', 'paused'] as const
export type Stage = typeof STAGES_VALIDOS[number]

export function ehStageValido(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES_VALIDOS as readonly string[]).includes(value)
}

/** Eco de ferramenta que ESCREVE — evidência de onde o trabalho tocou. */
export const ECO_ESCRITA = /^\s*(Edit|Write|MultiEdit|NotebookEdit|Workspace alterado)\b\s*:/i

/** Eco de ferramenta que só LÊ — não é evidência de nada, o contrato já manda ignorar. */
export const ECO_LEITURA = /^\s*(Read|Glob|Grep|LS|WebFetch|WebSearch|mcp__\w+__\w*(list|get|search|preview)\w*)\b\s*:?/i

/** Telemetria interna do hook. */
export const TELEMETRIA_HOOK = /^\s*hook-timing/i

/** Caminho de sistema de arquivos dentro de um texto. */
export const CAMINHO_ARQUIVO = /(^|\s)([a-zA-Z]:[\\/]|[\\/](?:home|Users|mnt|var|etc)[\\/])/

/** "editar o arquivo X", "alterações nos arquivos X, Y" — enuncia a ferramenta, não a intenção. */
export const PROSA_DE_ARQUIVO = /\b(edi(?:t(?:ar|ando)|ç(?:ão|ões))|alteraç(?:ão|ões)|modificaç(?:ão|ões)|mudanças?|ajustes?)\b[\s\S]{0,40}\barquivos?\b|\barquivos?\b[\s\S]{0,40}\b(edi(?:t(?:ar|ado|ados)|ç(?:ão|ões))|alterad[oa]s?|modificad[oa]s?)\b/i

/**
 * Token de nome de arquivo com extensão de código.
 *
 * O `\.?` inicial existe para os dotfiles: sem ele o `\b` começa a casar depois do
 * ponto e `.mcp.json` era contado como `mcp.json` — justamente a família de arquivos
 * de configuração que mais aparece nos ecos de workspace.
 */
export const TOKEN_ARQUIVO = /\.?\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|prisma|ya?ml|sql|css|html|sh|bat|py)\b/gi

/** A partir de quantos nomes de arquivo o texto vira "lista de arquivos". */
export const ARQUIVOS_ATE_VIRAR_LISTA = 3

/**
 * Deliberadamente conservador: um único nome de arquivo NÃO condena o texto, senão
 * `Migrar schema.prisma para multi-schema` — intenção legítima — seria descartado.
 * São necessários três, ou uma construção que enuncie a ferramenta em vez do porquê.
 */
export function ehTextoDerivadoDeEvento(value: unknown): boolean {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) return false

  if (ECO_ESCRITA.test(s) || ECO_LEITURA.test(s) || TELEMETRIA_HOOK.test(s)) return true
  if (CAMINHO_ARQUIVO.test(s)) return true
  if (PROSA_DE_ARQUIVO.test(s)) return true

  const arquivos = s.match(TOKEN_ARQUIVO) ?? []
  return new Set(arquivos.map((a) => a.toLowerCase())).size >= ARQUIVOS_ATE_VIRAR_LISTA
}

/** Texto que sobrevive ao cinto, ou vazio. */
export function textoLimpo(value: unknown): string {
  const s = typeof value === 'string' ? value.trim() : ''
  return s && !ehTextoDerivadoDeEvento(s) ? s : ''
}
