/**
 * ── A separação que o SOUL promete, finalmente no DADO ──────────────────────
 *
 * *"Respeito a separação entre vida pessoal, projetos e clientes"* — e até 18/09 isso era só uma
 * regra de atribuição no prompt. `AVISO_SEM_ESCOPO` mandava o modelo dizer de onde veio cada
 * coisa, mas o único sinal disponível era o `sourcePath`: um caminho de arquivo, do qual "isto é de
 * cliente" precisa ser **inferido** por quem lê.
 *
 * O `project_catalog` da V2 tem `tags` e `owner` — e estavam preenchidos em **1 de 10** projetos,
 * num schema que a V1 nem alcança. O lugar existia e estava vazio.
 *
 * ── Nulo é "não classificado", e isso não é o mesmo que "sem domínio" ───────
 *
 * A classificação é **curadoria humana**. Deduzir o domínio a partir do nome do projeto seria
 * inventar exatamente o fato que a separação existe para proteger — e esta casa já viu o que sai
 * de modelo preenchendo formulário.
 *
 * Então o não classificado se declara como tal. Um trecho de projeto sem domínio continua
 * chegando com o caminho, como antes; o que muda é que o classificado passa a chegar **dito**.
 */

export const DOMINIOS = ['pessoal', 'trabalho', 'cliente'] as const
export type Dominio = typeof DOMINIOS[number]

export function ehDominioValido(v: unknown): v is Dominio {
  return typeof v === 'string' && (DOMINIOS as readonly string[]).includes(v)
}

/**
 * Como o domínio aparece ao lado do trecho.
 *
 * Curto de propósito: ele entra em cada item do bloco de terceiros, e o bloco inteiro disputa
 * espaço com o resto do contexto. `null` para não classificado — quem não sabe não afirma.
 */
export function rotuloDeDominio(domain: string | null | undefined): string | null {
  return ehDominioValido(domain) ? domain : null
}

/** Trecho vindo da busca, antes de virar item do bloco. */
export interface TrechoComDono {
  content:    string
  sourcePath: string | null
  projectId:  string | null
}

/**
 * Anota cada trecho com o domínio declarado do projeto dono.
 *
 * A consulta entra como função em vez de o módulo importar Prisma: isto é `common/`, e quem sabe
 * consultar é quem tem o cliente. O que mora aqui é a REGRA — uma consulta só, nos projetos que de
 * fato apareceram, e não classificado sem marca.
 *
 * Existe porque dois caminhos servem trecho indexado ao modelo (o bloco do orquestrador e a síntese
 * do Brain), e uma segunda cópia desta lógica seria a família de drift que esta casa já pagou com
 * `SAFE_ROOTS`.
 *
 * Nunca lança: falha aqui degrada para "sem marca", que é o comportamento anterior.
 */
export async function anotarComDominio(
  trechos: TrechoComDono[],
  buscarDominios: (ids: string[]) => Promise<Array<{ id: string; domain: string | null }>>,
): Promise<Array<{ content: string; sourcePath: string | null; dominio: string | null }>> {
  const ids = [...new Set(trechos.map((t) => t.projectId).filter((x): x is string => !!x))]
  let porProjeto = new Map<string, string | null>()
  if (ids.length) {
    const donos = await buscarDominios(ids).catch(() => [] as Array<{ id: string; domain: string | null }>)
    porProjeto = new Map(donos.map((d) => [d.id, d.domain]))
  }
  return trechos.map((t) => ({
    content:    t.content,
    sourcePath: t.sourcePath,
    dominio:    rotuloDeDominio(t.projectId ? porProjeto.get(t.projectId) : null),
  }))
}
