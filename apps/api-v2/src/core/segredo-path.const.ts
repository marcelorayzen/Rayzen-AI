/**
 * Caminho que aparenta carregar credencial. **Cópia deliberada da V1**, barrada contra
 * drift por `__tests__/segredo-path.spec.ts`.
 *
 * A regra nasce em `apps/api/src/modules/memory/indexable-path.const.ts`, onde impede que
 * o hook indexe o arquivo. Aqui ela responde a outra pergunta, para outro dono: o
 * invariante `segredo_nao_indexado` audita o acervo que **já existe** — inclusive o que
 * entrou antes de a regra da V1 passar a valer, que foi exatamente o caso dos dois
 * documentos apagados em 2026-09-10.
 *
 * Não dá para importar de `packages/types`: o pacote **não é compilado** e importar valor
 * de lá derruba o container. Mesma solução de `memory-ranking` e `event-derived-text` —
 * cujas cópias já discordaram em três dos cinco modos antes de existir o teste.
 *
 * O vazamento que originou tudo: o `hook.config.mjs` estava indexado e a busca semântica
 * o serviu **com o `AGENT_TOKEN` completo em texto claro** dentro do `memory_relevant` de
 * uma sessão real — um dia depois de o arquivo ter sido fechado por ACL. Proteger o objeto
 * não protege a cópia que já saiu dele.
 */

const SEGREDO = /(^|[\\/])(\.env($|\.)|.*\.env$|hook\.config\.mjs$|credentials?\.json$|\.credentials\.json$|.*\.pem$|.*\.pfx$|.*\.key$|id_[a-z0-9]+$|.*-senha\.txt$)/i

export function ehCaminhoDeSegredo(sourcePath: string | null | undefined): boolean {
  const p = typeof sourcePath === 'string' ? sourcePath.trim() : ''
  if (!p) return false
  if (/\.example($|\.)/i.test(p)) return false
  return SEGREDO.test(p)
}
