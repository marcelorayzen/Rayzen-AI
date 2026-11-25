/**
 * Como cada modo de trabalho inclina a busca semântica — **fonte única**.
 *
 * Mora aqui, e não em `packages/types`, por uma restrição de runtime: aquele
 * pacote tem `main` apontando para `.ts` e nunca é compilado — funciona porque
 * todo import dele é de **tipo**, que o TypeScript apaga. Importar um valor
 * derruba o container (`Cannot find module .../src/index.ts`), e foi o que
 * aconteceu em 2026-08-16. A V1 mantém a própria declaração, e um teste
 * anti-drift compara as duas.
 *
 * Existia em dois lugares que se contradiziam: `memoryClassPriority` em
 * `apps/api/src/modules/orchestrator/work-modes.ts` (V1, lista ordenada) e
 * `MODE_CLASS_BOOST` em `apps/api-v2/src/memory/memory.service.ts` (V2, pesos).
 * Medido em 2026-08-16: **três dos cinco modos discordavam**. Em `implementation`
 * a V1 colocava `consolidated` em primeiro e a V2 dava a ele peso **zero** —
 * último lugar. Mesma classe de drift do `whitelist.ts` ↔ `ExecutionService`.
 *
 * Aqui a ordem é declarada uma vez; os dois lados derivam dela.
 */

export type MemoryClass = 'inbox' | 'working' | 'consolidated' | 'archive'
export type MemoryType  = 'decision' | 'lesson' | 'pattern' | 'constraint' | 'assumption'
export type WorkMode    = 'implementation' | 'debugging' | 'architecture' | 'study' | 'review'

export interface RankingDoModo {
  /** Ciclo de vida, em ordem de preferência. */
  classes: MemoryClass[]
  /**
   * Natureza do conteúdo, em ordem de preferência.
   *
   * Responde ao que o modo pede muito melhor que ciclo de vida: em arquitetura o
   * que importa é ser uma **decisão**, não há quanto tempo está consolidada.
   */
  tipos: MemoryType[]
}

export const RANKING_POR_MODO: Record<WorkMode, RankingDoModo> = {
  implementation: {
    classes: ['working', 'consolidated', 'inbox'],
    tipos:   ['pattern', 'lesson', 'constraint'],
  },
  debugging: {
    classes: ['working', 'consolidated', 'inbox'],
    tipos:   ['lesson', 'pattern', 'decision'],
  },
  architecture: {
    classes: ['consolidated', 'working', 'inbox'],
    tipos:   ['decision', 'constraint', 'pattern'],
  },
  study: {
    classes: ['consolidated', 'inbox', 'working'],
    tipos:   ['pattern', 'lesson', 'decision'],
  },
  review: {
    classes: ['consolidated', 'working', 'inbox'],
    tipos:   ['constraint', 'decision', 'pattern'],
  },
}

/**
 * Peso por posição na ordem de preferência.
 *
 * Calibrado contra a distribuição real do score, que é similaridade de cosseno
 * (`1 - distância`). Numa busca medida em 2026-08-15 os três primeiros vieram
 * `0.638 · 0.610 · 0.565` — espaçamento de **~0,07** entre o 1º e o 3º.
 *
 * O boost anterior era **+0.20**, quase 3x esse espaçamento: um documento a 0,45
 * marcado `consolidated` passava na frente de um a 0,63 altamente relevante. Isso
 * não é viés de modo, é substituição de relevância. Estes valores inclinam sem
 * atropelar — mesmo somando classe e tipo, o teto fica abaixo do espaçamento.
 */
export const PESO_POR_POSICAO = [0.030, 0.015, 0.005] as const

export function pesoDaPosicao(indice: number): number {
  return indice < 0 ? 0 : (PESO_POR_POSICAO[indice] ?? 0)
}

/**
 * Quanto somar ao score de similaridade.
 *
 * `modo` ausente devolve 0 — "modo livre" é ausência deliberada de viés, não um
 * modo com preferências próprias.
 *
 * ── Escopo: isto inclina CONHECIMENTO CURADO, não o acervo inteiro ──────────────
 * `memoryClass`/`memoryType` nulos também devolvem 0, e isso é declaração de
 * escopo, não descuido. Medido em 2026-08-18: **97,4% do acervo não tem etiqueta**
 * (45 de 1.715 documentos no Rayzen AI), e **nenhum documento de arquivo tem** —
 * nem poderia, porque `decision`, `lesson`, `pattern` e `constraint` descrevem
 * conhecimento curado. Não existe resposta certa para "qual o tipo do `page.tsx`".
 *
 * Então a pergunta "como preencher os 97%" não tem resposta boa: preencher seria
 * incoerente, e pedir a etiqueta ao LLM cairia na mesma família de defeito do
 * placeholder de schema virando valor. Para arquivo vale a similaridade de cosseno,
 * que é o que se pode medir nele.
 *
 * O que **não** pode acontecer é o sem-etiqueta ganhar peso por engano. Até 2026-08-18
 * a busca passava `memoryClass ?? 'inbox'`, e como `inbox` faz parte das listas de
 * preferência o não-classificado herdava a posição dele — em `study`, onde `inbox` é
 * o segundo, isso valia +0.015 contra os +0.005 do `working` curado.
 */
export function boostDoModo(
  modo: WorkMode | string | null | undefined,
  memoryClass: MemoryClass | null | undefined,
  memoryType: MemoryType | null | undefined,
): number {
  const ranking = modo ? RANKING_POR_MODO[modo as WorkMode] : undefined
  if (!ranking) return 0

  const porClasse = memoryClass ? pesoDaPosicao(ranking.classes.indexOf(memoryClass)) : 0
  const porTipo   = memoryType  ? pesoDaPosicao(ranking.tipos.indexOf(memoryType))    : 0
  return porClasse + porTipo
}
