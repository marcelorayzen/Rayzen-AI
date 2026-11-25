import axios from 'axios'
import { ambientePadrao, executarPrograma, type OpcoesDeExecucao, type ResultadoDeExecucao } from './executar-programa'
import type { Executor } from './publicar-entrega'

/**
 * Regime `sandbox` da sessão supervisionada (S3, 16/11/2026) — a sessão roda no SERVIDOR, num
 * container da sandbox, em vez do PC.
 *
 * ── A peça inteira é um Executor ─────────────────────────────────────────────
 * A prévia e a publicação já recebiam um executor injetável (`(programa, args, {cwd})`). Este
 * roda o MESMO comando dentro de um `docker run` descartável. A lógica de etapas, o portão do
 * diff e a publicação continuam sendo uma só para os três regimes — duplicá-las seria o jeito
 * de um regime um dia publicar sem perguntar.
 *
 * ── Onde o trabalho mora (item 2, 16/11) ─────────────────────────────────────
 * Em `~/workspaces/<repo>/sessao-<id>/` no servidor — uma pasta do dono, que ele abre no VS Code
 * pelo Remote-SSH para ver e assumir o que o Rayzen fez. Antes era um volume do Docker, que só o
 * root do host alcança. O container monta SÓ a pasta do projeto (`/work`); o clone de cada sessão
 * é uma subpasta, então sessões do mesmo projeto não se atropelam.
 *
 * ── A fronteira é a de `infra/sandbox/rodar-na-sandbox.sh` ───────────────────
 * Sem docker.sock, uid 1000 (o mesmo do dono, para a pasta ser editável por ele), sem
 * capabilities, no-new-privileges, rede `internal` com saída só pelo proxy de lista. O único
 * bind é a pasta do projeto em ~/workspaces. `verificar-sandbox.sh` prova cada item; as flags
 * aqui precisam ficar iguais às do script (o teste compara).
 *
 * ── Credenciais ──────────────────────────────────────────────────────────────
 * As da SANDBOX (`SANDBOX_CLAUDE_OAUTH_TOKEN`, `SANDBOX_GH_TOKEN`), passadas por NOME ao
 * `docker run` (`-e GH_TOKEN`), com o valor só no ambiente do cliente docker — nunca no argv,
 * que `ps` mostraria. Nunca as do agent.
 */

export const IMAGEM_DA_SANDBOX = 'rayzen-sandbox'
export const REDE_DA_SANDBOX = 'rayzen-sandbox-interna'
const PROXY = 'http://proxy:8888'
const TIMEOUT_MODELO_MS = 30 * 60 * 1000
const UID = '1000:1000'

export interface MetricasDoClaude {
  custoUsd?: number
  turnos?: number
  sessaoId?: string
  duracaoMs?: number
  erro?: string
  modelo?: string
}

export interface ResultadoDoClaude extends MetricasDoClaude {
  texto: string
}

export interface EventoDeProgressoDoClaude {
  linhas: string[]
  resultado?: ResultadoDoClaude
}

function registro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Converte uma linha NDJSON em progresso legível, sem deixar evento inválido interromper a sessão. */
export function linhaDeProgresso(json: string): EventoDeProgressoDoClaude | null {
  let evento: unknown
  try {
    evento = JSON.parse(json) as unknown
  } catch {
    return null
  }
  if (!registro(evento)) return null
  if (evento.type === 'result') {
    return { linhas: [], resultado: lerResultadoDoClaude(json) }
  }
  if (evento.type !== 'assistant' || !registro(evento.message) || !Array.isArray(evento.message.content)) {
    return null
  }

  const linhas: string[] = []
  for (const bruto of evento.message.content) {
    if (!registro(bruto)) continue
    if (bruto.type === 'text' && typeof bruto.text === 'string') {
      const texto = bruto.text.replace(/\s+/g, ' ').trim()
      if (texto) linhas.push(`💬 ${texto.slice(0, 120)}`)
    } else if (bruto.type === 'tool_use' && typeof bruto.name === 'string') {
      const input = registro(bruto.input) ? bruto.input : {}
      const caminho = [input.file_path, input.path].find((valor): valor is string => typeof valor === 'string')
      linhas.push(`🔧 ${bruto.name}${caminho ? ` ${caminho}` : ''}`)
    }
  }
  return linhas.length ? { linhas } : null
}

/** Interpreta a saída estruturada sem transformar campo ausente ou inválido em medida. */
export function lerResultadoDoClaude(stdout: string): ResultadoDoClaude {
  let payload: unknown
  try {
    payload = JSON.parse(stdout) as unknown
  } catch {
    return { texto: stdout }
  }
  if (!registro(payload) || typeof payload.result !== 'string') return { texto: stdout }

  const usage = registro(payload.modelUsage) ? payload.modelUsage : null
  const modelo = usage ? Object.keys(usage)[0] : undefined
  return {
    texto: payload.result,
    ...(typeof payload.total_cost_usd === 'number' && Number.isFinite(payload.total_cost_usd)
      ? { custoUsd: payload.total_cost_usd }
      : {}),
    ...(typeof payload.num_turns === 'number' && Number.isFinite(payload.num_turns)
      ? { turnos: payload.num_turns }
      : {}),
    ...(typeof payload.session_id === 'string' ? { sessaoId: payload.session_id } : {}),
    ...(typeof payload.duration_ms === 'number' && Number.isFinite(payload.duration_ms)
      ? { duracaoMs: payload.duration_ms }
      : {}),
    ...(payload.is_error === true && typeof payload.subtype === 'string' ? { erro: payload.subtype } : {}),
    ...(modelo ? { modelo } : {}),
  }
}

/** Ligado só no agent-server e só por decisão explícita. Desligado, nada muda. */
export function regimeSandboxLigado(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENT_ROLE === 'server' && env.AGENT_SESSAO_SANDBOX === 'true'
}

/** `dono/repo` do GitHub: só nomes simples, nada que vire opção ou caminho. */
const NOME_SIMPLES = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** A subpasta da sessão: `sessao-` + os 12 primeiros caracteres do id, só [a-z0-9]. */
export function pastaDaSessao(sessionId: string): string {
  const id = sessionId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  if (!id) throw new Error('sessionId vazio não nomeia pasta de sandbox')
  return `sessao-${id}`
}

export function nomeDoContainerDaSessao(sessionId: string): string {
  return `rayzen-sessao-${pastaDaSessao(sessionId).slice('sessao-'.length)}`
}

/** Raiz das pastas de trabalho NO HOST (o daemon do Docker resolve o bind por ela). */
export function raizDosWorkspaces(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SANDBOX_WORKSPACES_HOST || '/home/rayzen/workspaces').replace(/\/+$/, '')
}

export function pastaDoProjetoNoHost(repo: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!NOME_SIMPLES.test(repo)) throw new Error(`nome de repositório inválido para a sandbox: "${repo}"`)
  return `${raizDosWorkspaces(env)}/${repo}`
}

/** Onde o clone da sessão fica DENTRO do container. */
export function caminhoNoContainer(sessionId: string): string {
  return `/work/${pastaDaSessao(sessionId)}`
}

/**
 * Link que abre a pasta da sessão no VS Code pelo Remote-SSH. O alvo SSH é configuração
 * (`SANDBOX_SSH_ALVO`), não deduzido: é como o dono alcança o servidor da máquina dele.
 */
export function linkDoVscode(repo: string, sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  const alvo = env.SANDBOX_SSH_ALVO || 'rayzen@192.0.2.10'
  return `vscode://vscode-remote/ssh-remote+${alvo}${pastaDoProjetoNoHost(repo, env)}/${pastaDaSessao(sessionId)}`
}

/** As flags da fronteira. Iguais às de `rodar-na-sandbox.sh` — o teste confere. */
export function argsDoDockerRun(pastaNoHost: string, cwd: string, nomeContainer?: string): string[] {
  return [
    'run', '--rm',
    ...(nomeContainer ? ['--name', nomeContainer] : []),
    '--network', REDE_DA_SANDBOX,
    '-e', `HTTPS_PROXY=${PROXY}`, '-e', `HTTP_PROXY=${PROXY}`,
    '-e', `https_proxy=${PROXY}`, '-e', `http_proxy=${PROXY}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1',
    '-e', 'GIT_TERMINAL_PROMPT=0',
    // Por NOME: o valor vem do ambiente do cliente docker (`ambienteDoDocker`), não do argv.
    '-e', 'GH_TOKEN', '-e', 'CLAUDE_CODE_OAUTH_TOKEN',
    '--user', UID,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--memory', '3g', '--memory-swap', '3g', '--cpus', '2', '--pids-limit', '512',
    '--mount', `type=bind,src=${pastaNoHost},dst=/work`,
    '-w', cwd,
    IMAGEM_DA_SANDBOX,
  ]
}

/** Ambiente do CLIENTE docker: o mínimo para ele achar o daemon, mais as credenciais da sandbox. */
function ambienteBaseDoDocker(fonte: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = ambientePadrao(fonte)
  for (const chave of ['HOME', 'DOCKER_HOST'] as const) if (fonte[chave]) env[chave] = fonte[chave]
  return env
}

export function ambienteDoDocker(fonte: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = ambienteBaseDoDocker(fonte)
  if (fonte.SANDBOX_GH_TOKEN) env.GH_TOKEN = fonte.SANDBOX_GH_TOKEN
  if (fonte.SANDBOX_CLAUDE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = fonte.SANDBOX_CLAUDE_OAUTH_TOKEN
  return env
}

type Rodar = (programa: string, args: readonly string[], opts: OpcoesDeExecucao) => Promise<ResultadoDeExecucao>
const rodarNoHost: Rodar = (programa, args, opts) => executarPrograma('executavel', programa, args, opts)

/**
 * O Executor da sandbox: `(programa, args, {cwd})` vira `docker run ... -w cwd imagem programa args`,
 * com a pasta do projeto montada em `/work`. O `env` pedido pelo chamador é ignorado de
 * propósito — dentro do container vale só o da fronteira.
 */
export function executorDaSandbox(
  pastaNoHost: string,
  rodar: Rodar = rodarNoHost,
  sessionId?: string,
): Executor {
  return (programa, args, opts) => rodar(
    'docker',
    [
      ...argsDoDockerRun(
        pastaNoHost,
        opts.cwd,
        programa === 'claude' && sessionId ? nomeDoContainerDaSessao(sessionId) : undefined,
      ),
      programa,
      ...args,
    ],
    { cwd: '/', env: ambienteDoDocker(), timeoutMs: opts.timeoutMs + 60_000, aoStdout: opts.aoStdout },
  )
}

export async function pararContainerDaSessao(sessionId: string, rodar: Rodar = rodarNoHost): Promise<void> {
  const nome = nomeDoContainerDaSessao(sessionId)
  for (let tentativa = 0; tentativa < 40; tentativa++) {
    const resultado = await rodar(
      'docker',
      ['stop', '-t', '10', nome],
      { cwd: process.cwd(), env: ambienteBaseDoDocker(process.env), timeoutMs: 20_000 },
    )
    if (!resultado.timedOut && resultado.code === 0) return

    const erro = resultado.stderr.trim() || resultado.stdout.trim()
    if (!/no such container/i.test(erro)) {
      throw new Error(`docker stop falhou: ${erro || resultado.code}`)
    }
    if (tentativa < 39) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`docker stop não confirmou a parada do container ${nome} após 40 tentativas`)
}

/**
 * Cria `~/workspaces/<repo>` com o dono certo antes do primeiro bind (o daemon não cria a origem
 * de um `--mount type=bind`, e se criasse seria como root). Container mínimo: sem rede, sem
 * credencial, só `mkdir` — a raiz dos workspaces é montada só aqui, e só para isso.
 */
export async function garantirPastaDoProjeto(
  repo: string,
  rodar: Rodar = rodarNoHost,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; pasta: string } | { ok: false; erro: string }> {
  if (!NOME_SIMPLES.test(repo)) return { ok: false, erro: `nome de repositório inválido para a sandbox: "${repo}"` }
  const raiz = raizDosWorkspaces(env)
  const r = await rodar('docker', [
    'run', '--rm', '--network', 'none', '--user', UID, '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--mount', `type=bind,src=${raiz},dst=/ws`,
    IMAGEM_DA_SANDBOX, 'mkdir', '-p', '--', `/ws/${repo}`,
  ], { cwd: '/', env: ambientePadrao(env), timeoutMs: 60_000 })
  if (r.code !== 0 || r.timedOut) {
    return { ok: false, erro: `não consegui preparar ${raiz}/${repo} (a raiz existe e é do dono?): ${(r.stderr || '').trim().slice(-200)}` }
  }
  return { ok: true, pasta: `${raiz}/${repo}` }
}

/**
 * Prepara o clone da sessão: clona em `/work/sessao-<id>` se ainda não existe, e grava NO
 * REPOSITÓRIO (não no home, que nasce vazio a cada `docker run`) a credencial do gh e a
 * identidade dos commits — "Rayzen" com o e-mail noreply do dono (decisão do Marcelo, 16/11).
 *
 * Os nomes viajam como argumentos posicionais do `bash -c`, nunca interpolados no script.
 */
export async function prepararCloneNaSandbox(
  executar: Executor,
  dono: string,
  repo: string,
  sessionId: string,
): Promise<{ ok: true; base: string } | { ok: false; erro: string }> {
  if (!NOME_SIMPLES.test(dono) || !NOME_SIMPLES.test(repo)) {
    return { ok: false, erro: `dono/repositório inválido para a sandbox: "${dono}/${repo}"` }
  }
  const pasta = pastaDaSessao(sessionId)
  const script = [
    'set -e', 'cd /work',
    '[ -d "$3/.git" ] || git clone -q "https://github.com/$1/$2.git" "$3"',
    'cd "$3"',
    'git config credential.helper "!gh auth git-credential"',
    'git config user.name Rayzen',
    'git config user.email "$1@users.noreply.github.com"',
    'git fetch -q origin',
  ].join('\n')
  const r = await executar('bash', ['-c', script, '_', dono, repo, pasta], { cwd: '/work', env: {}, timeoutMs: 180_000 })
  if (r.code !== 0 || r.timedOut) {
    return { ok: false, erro: `não consegui clonar ${dono}/${repo} na sandbox: ${(r.timedOut ? 'tempo esgotado' : r.stderr.trim()).slice(-300)}` }
  }
  return { ok: true, base: caminhoNoContainer(sessionId) }
}

/** `projectId` → `dono/repo`. O dono é da configuração (o token só alcança o que ele escolheu). */
export async function repositorioDoProjeto(
  projectId: string,
  buscar: (id: string) => Promise<{ repoSlug?: string | null } | null> = buscarProjeto,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ dono: string; repo: string } | { erro: string }> {
  const dono = env.SANDBOX_GH_OWNER || 'marcelorayzen'
  const projeto = await buscar(projectId).catch(() => null)
  const repo = projeto?.repoSlug?.trim()
  if (!repo) return { erro: `o projeto ${projectId} não tem repoSlug — a sandbox não sabe qual repositório clonar` }
  if (!NOME_SIMPLES.test(repo)) return { erro: `repoSlug "${repo}" não é um nome de repositório do GitHub` }
  return { dono, repo }
}

async function buscarProjeto(id: string): Promise<{ repoSlug?: string | null } | null> {
  const r = await axios.get(`${process.env.AGENT_API_URL}/projects/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` }, timeout: 10_000,
  })
  return r.data
}

/**
 * Uma etapa do modelo dentro da sandbox. O prompt vai como ARGUMENTO (argv do `docker run`,
 * sem shell): `claude -p` lê o stdin, e um roteiro chegando por stdin foi engolido inteiro no
 * primeiro teste real (16/11). Aqui o stdin do container fica fechado.
 */
export function modeloNaSandbox(
  executar: Executor,
  ferramentas: { permitidas: readonly string[]; negadas: readonly string[] },
): (
  prompt: string,
  cwd: string,
  aoMedir?: (m: MetricasDoClaude) => void,
  aoProgredir?: (linha: string) => void,
) => Promise<string> {
  return async (prompt, cwd, aoMedir, aoProgredir) => {
    let restante = ''
    let recebeuChunk = false
    let resultado: ResultadoDoClaude | undefined
    const processarLinha = (linha: string) => {
      if (!linha.trim()) return
      const evento = linhaDeProgresso(linha)
      if (!evento) return
      for (const progresso of evento.linhas) aoProgredir?.(progresso)
      if (evento.resultado) resultado = evento.resultado
    }
    const receberChunk = (pedaco: string) => {
      recebeuChunk = true
      const linhas = `${restante}${pedaco}`.split(/\r?\n/)
      restante = linhas.pop() ?? ''
      for (const linha of linhas) processarLinha(linha)
    }
    const r = await executar('claude', [
      '-p', prompt,
      '--allowedTools', ...ferramentas.permitidas,
      '--disallowedTools', ...ferramentas.negadas,
      '--output-format', 'stream-json',
      '--verbose',
    ], { cwd, env: {}, timeoutMs: TIMEOUT_MODELO_MS, aoStdout: receberChunk })
    if (!recebeuChunk) {
      for (const linha of r.stdout.split(/\r?\n/)) processarLinha(linha)
    } else {
      processarLinha(restante)
    }
    const saida = `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`
    if (r.code !== 0 || r.timedOut) throw new Error(saida.slice(-500) || `claude saiu com código ${r.code}`)
    if (resultado) {
      const { texto: _texto, ...metricas } = resultado
      aoMedir?.(metricas)
    }
    return resultado?.texto ?? r.stdout
  }
}

/** HEAD no clone da sandbox (vazio se não der para ler). */
export async function headNaSandbox(executar: Executor, cwd: string): Promise<string> {
  const r = await executar('git', ['rev-parse', 'HEAD'], { cwd, env: {}, timeoutMs: 20_000 })
  return r.code === 0 ? r.stdout.trim() : ''
}

/** Diff para o portão: `--stat` desde `desde`, e `status --short` se só houver arquivo novo. */
export async function diffNaSandbox(executar: Executor, cwd: string, desde?: string): Promise<string> {
  const stat = await executar('git', ['diff', '--stat', desde || 'HEAD'], { cwd, env: {}, timeoutMs: 20_000 })
  if (stat.code === 0 && stat.stdout.trim()) return stat.stdout.trim()
  const st = await executar('git', ['status', '--short'], { cwd, env: {}, timeoutMs: 20_000 })
  return st.code === 0 ? st.stdout.trim() : ''
}

/**
 * Os caminhos que a sessão mudou desde `desde`, um por linha (`--name-only`, não o `--stat`,
 * que abrevia caminho longo com `...`). `null` quando não deu para medir: quem decide com isto
 * trata `null` como "não sei", nunca como "nada mudou".
 */
export async function arquivosAlteradosNaSandbox(executar: Executor, cwd: string, desde?: string): Promise<string[] | null> {
  const r = await executar('git', ['diff', '--name-only', desde || 'HEAD'], { cwd, env: {}, timeoutMs: 20_000 })
  if (r.code !== 0) return null
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
}

/** Extensões de texto que nenhum app serve: a prévia ao vivo não mostraria a mudança. */
const EXTENSOES_DE_DOCUMENTACAO = /\.(md|mdx|markdown|txt|rst|adoc)$/i

/**
 * 24/11: a prévia sobe o APP da pasta da sessão. Uma mudança só no README abria o app igual ao
 * de antes, e a pessoa procurava a mudança onde ela não aparece. Só documentação quando há ao
 * menos um arquivo e TODOS são texto de documentação; lista vazia ou não medida não é.
 */
export function mudancaSoDeDocumentacao(arquivos: readonly string[] | null): boolean {
  return !!arquivos && arquivos.length > 0 && arquivos.every((a) => EXTENSOES_DE_DOCUMENTACAO.test(a))
}

/**
 * Antes do portão final: o que ficou sem commit vira um commit. No PC um worktree com trabalho
 * não commitado é preservado no disco; na sandbox o volume não é alcançável por ninguém, e o
 * trabalho sem commit seria perdido.
 */
export async function commitarSobrasNaSandbox(executar: Executor, cwd: string): Promise<void> {
  const script = 'set -e; git add -A; git diff --cached --quiet || git commit -q -m "rayzen: alterações finais da sessão"'
  await executar('bash', ['-c', script], { cwd, env: {}, timeoutMs: 30_000 })
}

/**
 * Depois da verificação independente: o que os testes escreveram (snapshot novo, cobertura,
 * relatório) volta ao HEAD. Seguro porque `commitarSobrasNaSandbox` acabou de commitar todo o
 * trabalho da sessão; sem isto, um arquivo rastreado tocado pelo `npm test` apareceria no diff
 * do portão sem estar no PR. `clean -fd` sem `-x` preserva o ignorado (`node_modules`).
 */
export async function restaurarArvoreNaSandbox(executar: Executor, cwd: string): Promise<void> {
  const script = 'set -e; git reset -q --hard HEAD; git clean -fdq'
  await executar('bash', ['-c', script], { cwd, env: {}, timeoutMs: 30_000 })
}

/**
 * G6, fatia 4 (21/11): nome de ramo aceito como base da sessão. Vem do envelope (e, nas rotinas, de
 * um evento do GitHub), então é validado aqui, onde vira argumento de git: sem `-` no começo (seria
 * lido como opção), sem `..`, `//`, `@{`, final `/` ou `.lock` (o git recusaria ou interpretaria),
 * só os caracteres de nome de ramo comum.
 */
export function refDeBaseValida(ref: unknown): ref is string {
  return typeof ref === 'string'
    && /^[A-Za-z0-9._/-]{1,200}$/.test(ref)
    && !ref.startsWith('-') && !ref.startsWith('/') && !ref.endsWith('/')
    && !ref.includes('..') && !ref.includes('//') && !ref.endsWith('.lock')
}

/** O id de uma sessão anterior, como chega no envelope de continuação (G3.2). */
export function idDeSessaoValido(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9]{8,40}$/i.test(id)
}

/**
 * G3.2 (24/11): conferência ANTES de entrar na pasta de uma sessão anterior. Roda em `/work`, e
 * não na pasta: o `docker run -w` cria o diretório de trabalho que não existe — vazio e como
 * root —, e uma pasta já limpa voltaria a existir sem nada dentro.
 */
export async function pastaDaSessaoExiste(executar: Executor, sessaoAntiga: string): Promise<boolean> {
  if (!idDeSessaoValido(sessaoAntiga)) return false
  const r = await executar('bash', ['-c', '[ -d "/work/$1/.git" ]', '_', pastaDaSessao(sessaoAntiga)], { cwd: '/work', env: {}, timeoutMs: 30_000 })
  return r.code === 0 && !r.timedOut
}

/**
 * G3.2 (24/11): prepara a CONTINUAÇÃO de uma sessão interrompida na pasta dela. O checkpoint é o
 * git: o que a sessão antiga commitou fica, e o que ficou sem commit vira um commit `wip`.
 *
 * O cuidado central: entrar no ramo existente com `git checkout`, **nunca `-B`**. É `-B` que
 * `criarRamoNaSandbox` usa, e na mesma pasta ele recriaria o ramo a partir do `main` — o trabalho
 * salvo sumiria sem erro nenhum.
 *
 * Recusa quando a pasta ou o ramo não existem, e quando o ramo já está no GitHub (publicar já
 * aconteceu: alguém precisa conferir, e retomar não é o caminho). Não ter conseguido consultar o
 * GitHub também recusa — sem medir, não se afirma que nada saiu.
 *
 * Devolve o `merge-base` com o ramo de base: o diff do portão mostra o trabalho inteiro, não só
 * o que veio depois da retomada.
 */
export async function prepararRetomadaNaSandbox(
  executar: Executor,
  sessaoAntiga: string,
  baseRef?: string,
): Promise<{ ok: true; base: string; ramo: string; headInicial: string } | { ok: false; erro: string }> {
  if (!idDeSessaoValido(sessaoAntiga)) return { ok: false, erro: `id de sessão inválido para retomar: "${String(sessaoAntiga).slice(0, 60)}"` }
  if (baseRef !== undefined && !refDeBaseValida(baseRef)) return { ok: false, erro: `ramo de base inválido: "${String(baseRef).slice(0, 60)}"` }
  if (!(await pastaDaSessaoExiste(executar, sessaoAntiga))) {
    return { ok: false, erro: `a pasta da sessão ${pastaDaSessao(sessaoAntiga)} não existe mais no servidor (já foi limpa): não há o que retomar` }
  }
  const ramo = `rayzen/sessao-${sessaoAntiga.slice(0, 8)}`
  const base = caminhoNoContainer(sessaoAntiga)
  const script = [
    'set -e',
    'git rev-parse --verify --quiet "refs/heads/$1" >/dev/null || { echo "o ramo $1 não existe na pasta da sessão" >&2; exit 4; }',
    'remoto="$(git ls-remote --heads origin "refs/heads/$1")" || { echo "não consegui consultar o GitHub" >&2; exit 6; }',
    '[ -z "$remoto" ] || { echo "o ramo $1 já está no GitHub: confira antes, retomar não é o caminho" >&2; exit 5; }',
    'git checkout -q "$1"',
    'git add -A',
    'git diff --cached --quiet || git commit -q -m "wip: trabalho de antes da interrupção"',
    'if [ -n "$2" ]; then git fetch -q origin "+refs/heads/$2:refs/remotes/origin/$2"; ref="refs/remotes/origin/$2";',
    'else ref="$(git symbolic-ref --quiet refs/remotes/origin/HEAD || echo refs/remotes/origin/main)"; fi',
    'git merge-base HEAD "$ref"',
  ].join('\n')
  const r = await executar('bash', ['-c', script, '_', ramo, baseRef ?? ''], { cwd: base, env: {}, timeoutMs: 120_000 })
  if (r.code !== 0 || r.timedOut) {
    return { ok: false, erro: `não consegui retomar a sessão ${pastaDaSessao(sessaoAntiga)}: ${(r.timedOut ? 'tempo esgotado' : r.stderr.trim()).slice(-300)}` }
  }
  const headInicial = r.stdout.trim().split(/\r?\n/).pop() ?? ''
  return { ok: true, base, ramo, headInicial }
}

/**
 * Cria o ramo da sessão a partir do topo do branch padrão do remoto ou, com `baseRef` (G6, fatia
 * 4), do topo de `origin/<baseRef>` — para a sessão corrigir um PR a partir do ramo dele. O `fetch`
 * do ramo vem antes porque o clone pode ser antigo (a pasta da sessão é reaproveitada).
 */
export async function criarRamoNaSandbox(executar: Executor, cwd: string, ramo: string, baseRef?: string): Promise<string> {
  if (baseRef !== undefined && !refDeBaseValida(baseRef)) {
    throw new Error(`ramo de base inválido: "${String(baseRef).slice(0, 60)}"`)
  }
  const script = baseRef
    ? [
      'set -e',
      'git fetch -q origin "+refs/heads/$2:refs/remotes/origin/$2"',
      'git checkout -q -B "$1" "refs/remotes/origin/$2"',
      'git rev-parse HEAD',
    ].join('\n')
    : [
      'set -e',
      'base="$(git symbolic-ref --quiet refs/remotes/origin/HEAD || echo refs/remotes/origin/main)"',
      'git checkout -q -B "$1" "$base"',
      'git rev-parse HEAD',
    ].join('\n')
  const args = baseRef ? ['-c', script, '_', ramo, baseRef] : ['-c', script, '_', ramo]
  const r = await executar('bash', args, { cwd, env: {}, timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(`não consegui criar o ramo ${ramo} na sandbox: ${r.stderr.trim().slice(-200)}`)
  return r.stdout.trim().split(/\r?\n/).pop() ?? ''
}
