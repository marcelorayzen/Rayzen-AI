/**
 * O que NÃO deve entrar no Brain quando o hook indexa um arquivo automaticamente.
 *
 * O hook manda `fileContent` em todo `Edit`/`Write`, e até 2026-08-18 tudo era
 * indexado sem olhar o caminho. Medido no Rayzen AI: **65 documentos de scratchpad**
 * (scripts de análise descartáveis desta própria sessão), 6 lockfiles e 7 artefatos
 * de build — num acervo de 1.715.
 *
 * Não é volume que incomoda, é **ocupar slot**. A seção `memory_relevant` é a maior
 * do contexto injetado (30-50%) e entrega 5 trechos. Medido no banco-imob: dois dos
 * cinco eram `pnpm-lock.yaml`, para a consulta "implementar cache de sessão no módulo
 * de autenticação". E numa busca no Rayzen AI em `debugging`, dois dos cinco eram
 * scripts temporários meus.
 *
 * O critério é **conteúdo sem intenção autoral**: gerado por ferramenta (lockfile,
 * build), descartável por natureza (scratchpad) ou ilegível para humano (minificado).
 * Código-fonte de verdade continua entrando — ele é o trabalho.
 *
 * Só vale para a indexação AUTOMÁTICA do hook. `indexFile`/`indexNotion`/`indexUrl`
 * são ações explícitas de quem chama: se alguém mandar indexar um lockfile de
 * propósito, o pedido é atendido — mesma lógica do `replaceBySourcePath`, que é
 * opt-in no chamador e nunca inferido.
 */

/** Dependências resolvidas por ferramenta — texto enorme, autoria zero. */
const LOCKFILE = /(^|[\\/])(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock)$/i

/**
 * Saída de build e dependência instalada.
 *
 * O `(^|[\\/])` cobre o caminho relativo que começa na própria pasta
 * (`graphify-out/graph.json`) — só `[\\/]` exigia separador à esquerda e deixava
 * passar exatamente esse caso. O separador à direita continua obrigatório, senão
 * `distribuicao.service.ts` e `outbox/handler.ts` seriam barrados por conterem
 * `dist` e `out`.
 */
const GERADO = /(^|[\\/])(node_modules|dist|build|out|coverage|\.next|\.turbo|\.nuxt|graphify-out|__snapshots__)[\\/]/i

/**
 * Scratchpad e temporário — arquivo desta sessão, não artefato do projeto.
 * O mesmo padrão já é usado para classificar EVENTO em `ProjectStateService`; aqui
 * ele impede que o arquivo entre no acervo.
 */
const TEMPORARIO = /AppData[\\/]+Local[\\/]+Temp|[\\/]tmp[\\/]|[\\/]scratchpad[\\/]|\.tmp$/i

/** Ilegível para humano — não há o que um trecho disso ensine. */
const ILEGIVEL = /\.(min\.(js|css)|map|snap)$/i

/** Binário e mídia: o Brain é textual. */
const BINARIO = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tar|gz|woff2?|ttf|eot|mp4|mp3|wav)$/i

/**
 * Arquivo que carrega credencial. **Esta categoria não segue o critério das outras.**
 *
 * As cinco acima barram "conteúdo sem intenção autoral" — o `.env` tem intenção autoral
 * de sobra, e é exatamente por isso que ele não pode entrar: o que ele diz é segredo.
 *
 * Custou um vazamento medido em 2026-09-10. O `hook.config.mjs` — que guarda o
 * `AGENT_TOKEN` — estava indexado, e a busca semântica o serviu **com o JWT completo em
 * texto claro** dentro do `memory_relevant` de uma sessão real. O arquivo tinha sido
 * fechado por ACL no dia anterior; a proteção do sistema de arquivos não alcança a cópia
 * que já saiu dele.
 *
 * `.example` fica **de fora de propósito**: `hook.config.example.mjs` é template
 * versionado, sem segredo, e é o que ensina o formato a quem chega. Os dois documentos
 * apagados do Brain eram o arquivo real; os dois `.example` ficaram.
 */
const SEGREDO = /(^|[\\/])(\.env($|\.)|.*\.env$|hook\.config\.mjs$|credentials?\.json$|\.credentials\.json$|.*\.pem$|.*\.pfx$|.*\.key$|id_[a-z0-9]+$|.*-senha\.txt$)/i

export const PADROES_NAO_INDEXAVEIS = [LOCKFILE, GERADO, TEMPORARIO, ILEGIVEL, BINARIO, SEGREDO]

/**
 * `true` quando o caminho aparenta carregar credencial.
 *
 * Separado de `podeIndexarAutomaticamente` porque responde outra pergunta e tem outro
 * público: aquela decide o que o **hook** indexa sozinho; esta é para quem precisa
 * AUDITAR o acervo, inclusive o que entrou antes desta regra existir.
 */
export function ehCaminhoDeSegredo(sourcePath: string | null | undefined): boolean {
  const p = typeof sourcePath === 'string' ? sourcePath.trim() : ''
  if (!p) return false
  if (/\.example($|\.)/i.test(p)) return false
  return SEGREDO.test(p)
}

/**
 * `true` quando o arquivo pode entrar no Brain pela indexação automática.
 *
 * Caminho vazio devolve `false`: sem caminho não dá para julgar, e o custo de deixar
 * entrar lixo é maior que o de perder um caso raro — a indexação automática dispara
 * dezenas de vezes por sessão.
 */
export function podeIndexarAutomaticamente(sourcePath: string | null | undefined): boolean {
  const p = typeof sourcePath === 'string' ? sourcePath.trim() : ''
  if (!p) return false
  return !PADROES_NAO_INDEXAVEIS.some((re) => re.test(p))
}
