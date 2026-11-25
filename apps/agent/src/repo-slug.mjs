/**
 * Como um diretório vira `repoSlug` — **fonte única** dos três pontos de entrada
 * `.mjs` do agent: `rayzen-hook.mjs`, `rayzen-context-hook.mjs` e `rayzen-mcp.mjs`.
 *
 * Os três resolviam por conta própria, com o mesmo código copiado, e o comentário
 * do MCP já dizia o motivo de terem que concordar: "senão hook e MCP resolvem
 * projetos diferentes no mesmo diretório". Concordavam por disciplina, e é assim
 * que a `whitelist.ts` e o `MODE_CLASS_BOOST` divergiram antes.
 *
 * Mora aqui, e não em `packages/types`, porque estes três arquivos rodam direto no
 * Node, sem build — ver a nota do `memory-ranking.const.ts` sobre importar valor de
 * um pacote que nunca é compilado.
 *
 * ─── Por que existem DUAS grafias ────────────────────────────────────────────
 *
 * `jarvis:create_project_folder` cria a pasta com o nome cru e registra o projeto
 * com o slug em kebab-case:
 *
 *     pasta:    "Sistema de Controle Financeiro Pessoal"
 *     repoSlug: "sistema-de-controle-financeiro-pessoal"
 *
 * Sem git remote, o fallback é o nome da pasta — que nunca casa com o registro.
 * Medido em 2026-08-16: dois projetos criados por essa ação, nenhuma das quatro
 * grafias resolvendo, e o `RAYZEN-SETUP.md` gerado afirmando o contrário ("o hook
 * detecta este projeto automaticamente pelo repoSlug").
 *
 * Slugificar sempre seria pior: o `Rayzen-PDV` tem `repoSlug` com maiúsculas,
 * literalmente `Rayzen-PDV`, e viraria `rayzen-pdv` — quebrando um projeto que
 * funciona hoje para consertar dois que não existem. Por isso é uma LISTA
 * ordenada, com o cru primeiro: quem já resolve continua resolvendo no primeiro
 * candidato, e só quem falha tenta o kebab.
 */

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Migrado na Fase 1 do plano de execução tipada: a versão anterior recebia `args` como
 * STRING (`git ` + args interpolado numa linha de comando via `execSync`) — mesmo com os
 * dois chamadores deste arquivo sempre passando texto constante (nunca payload externo),
 * era a mesma forma que este plano existe para eliminar em todo lugar, não só onde já dói.
 *
 * `execFileSync` com `args` como VETOR, sem shell. Não importa `executarPrograma()` de
 * propósito: este arquivo roda direto do `src`, sem build (ver o comentário do topo do
 * módulo) — depender do `.ts` compilado reintroduziria exatamente a fragilidade de
 * `dist` congelado que a casa já mediu (ver `docs/plano-execucao-tipada.md`, Fase 1).
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
  } catch {
    return ''
  }
}

/** Mesma regra do `toRepoSlug` em `actions/create-project-folder.ts`. */
export function paraSlug(nome) {
  return nome.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/**
 * Cache do nome do repositório, por diretório.
 *
 * O `PostToolUse` dispara em TODA ferramenta, e sem cache cada disparo gastava até dois
 * `execSync` de git. Medido em 2026-09-06 na máquina ociosa: 250–430 ms por chamada,
 * contra o timeout de 2000 ms — margem de ~5x, que evapora com três projetos Jest em
 * paralelo. Foi assim que o hook falhou com slug `"?"` duas vezes nesta sessão, e slug
 * vazio significa **evento nascendo órfão**.
 *
 * O remote de um diretório praticamente não muda, então a TTL é longa. E o mais
 * importante está no `catch` do leitor: quando o git falha, o valor vencido ainda serve —
 * nome levemente velho é infinitamente melhor que nenhum nome.
 */
const NOME_CACHE_FILE = join(tmpdir(), 'rayzen-repo-name-cache.json')
const NOME_CACHE_TTL  = 60 * 60 * 1000

function lerCacheDeNome(chave) {
  try {
    const c = JSON.parse(readFileSync(NOME_CACHE_FILE, 'utf8'))
    if (c[chave]) return { nome: c[chave].nome, fresco: Date.now() - c[chave].ts < NOME_CACHE_TTL }
  } catch { /* ignora */ }
  return null
}

function gravarCacheDeNome(chave, nome) {
  try {
    let c = {}
    try { c = JSON.parse(readFileSync(NOME_CACHE_FILE, 'utf8')) } catch { /* primeiro uso */ }
    c[chave] = { nome, ts: Date.now() }
    writeFileSync(NOME_CACHE_FILE, JSON.stringify(c), 'utf8')
  } catch { /* ignora */ }
}

/** Nome do repositório: basename do remote, ou da pasta raiz se não houver remote. */
export function nomeDoRepositorio(cwd) {
  const chave = cwd ?? process.cwd()
  const cache = lerCacheDeNome(chave)
  if (cache?.fresco) return cache.nome

  const remote = git(['remote', 'get-url', 'origin'], cwd)
  const m = remote.match(/\/([^/]+?)(?:\.git)?$/)
  if (m?.[1]) { gravarCacheDeNome(chave, m[1]); return m[1] }

  const root = git(['rev-parse', '--show-toplevel'], cwd)
  const nome = root ? (root.split(/[/\\]/).pop() ?? null) : null
  if (nome) { gravarCacheDeNome(chave, nome); return nome }

  // Git não respondeu — provavelmente lentidão, não mudança de repositório. Servir o
  // valor vencido evita que o evento nasça órfão por causa de 2 segundos.
  return cache?.nome ?? null
}

/**
 * Grafias a tentar contra `GET /projects?repoSlug=`, **em ordem**.
 *
 * O cru vem primeiro de propósito — ver a nota sobre o `Rayzen-PDV` acima.
 * Devolve lista vazia quando não é um repositório git.
 */
export function candidatosDeSlug(cwd) {
  const nome = nomeDoRepositorio(cwd)
  if (!nome) return []

  const slug = paraSlug(nome)
  return slug && slug !== nome ? [nome, slug] : [nome]
}
