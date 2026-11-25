import { ambientePadrao, executarPrograma, type ResultadoDeExecucao } from './executar-programa'
import { IMAGEM_DA_SANDBOX, REDE_DA_SANDBOX, pastaDaSessao, pastaDoProjetoNoHost, regimeSandboxLigado } from './sandbox'
import type { Executor } from './publicar-entrega'

/**
 * Prévia ao vivo do que o Rayzen construiu (item 3, 17/11/2026) — `preview.example.com`, atrás
 * do Cloudflare Access (decisão do Marcelo: o login é da Cloudflare, sem código de auth nosso).
 *
 * ── Duas etapas, dois níveis de confiança ────────────────────────────────────
 * 1. INSTALAR: `npm ci` na pasta da sessão, num container da sandbox (rede `internal`, saída só
 *    pelo proxy de lista, onde está o registry do npm) — e SEM credencial nenhuma. O `postinstall`
 *    de uma dependência é código de terceiro; com o GH_TOKEN no ambiente ele poderia empurrar
 *    para o GitHub, que está na lista do proxy.
 * 2. SERVIR: o servidor de desenvolvimento num container na rede `rayzen-previa` — `internal`,
 *    sem o proxy: **nenhuma saída**. Quem o alcança é só o Caddy, que entra nessa rede.
 *
 * ── Uma prévia por vez ───────────────────────────────────────────────────────
 * Nome fixo (`rayzen-previa`): o Caddy aponta para ele e a RAM do servidor (11 GB) é o limite
 * mais apertado. Ligar outra derruba a anterior. Desliga sozinha em 2 h (`pararPreviaVencida`,
 * na varredura horária).
 *
 * ── Mesma pasta que o dono abre no VS Code ───────────────────────────────────
 * O container monta a pasta da sessão; editar pelo Remote-SSH recarrega a prévia na hora.
 *
 * Por enquanto só Vite com npm, que é o que existe (`rayzen-marcenaria`). Outro servidor de
 * desenvolvimento não é adivinhado: a prévia diz por que não subiu.
 */

export const CONTAINER_DA_PREVIA = 'rayzen-previa'
export const REDE_DA_PREVIA = 'rayzen-previa'
export const PORTA_DA_PREVIA = 5173
export const VIDA_DA_PREVIA_MS = 2 * 60 * 60 * 1000
const ROTULO_INICIO = 'rayzen.previa.inicio'
const PROXY = 'http://proxy:8888'
const UID = '1000:1000'
const TIMEOUT_INSTALACAO_MS = 10 * 60 * 1000

export type Rodar = (programa: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<ResultadoDeExecucao>
const rodarNoHost: Rodar = (programa, args, opts) => executarPrograma('executavel', programa, args, opts)

/** Ligada só com a sandbox E com o endereço público configurado. Sem `PREVIA_URL`, nada muda. */
export function previaLigada(env: NodeJS.ProcessEnv = process.env): boolean {
  return regimeSandboxLigado(env) && /^https:\/\/[a-z0-9.-]+\/?$/i.test(env.PREVIA_URL ?? '')
}

export function urlDaPrevia(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PREVIA_URL ?? '').replace(/\/+$/, '')
}

/** Ambiente do cliente docker SEM as credenciais da sandbox — nem por nome elas atravessam. */
export function ambienteSemCredencial(fonte: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = ambientePadrao(fonte)
  for (const chave of ['HOME', 'DOCKER_HOST'] as const) if (fonte[chave]) env[chave] = fonte[chave]
  return env
}

export type Avaliacao = { ok: true } | { ok: false; motivo: string }

/** O projeto tem um servidor de desenvolvimento que sabemos servir? Decide pelo package.json. */
export function avaliarProjeto(packageJson: string | null, arquivos: { pnpm: boolean; yarn: boolean }): Avaliacao {
  if (packageJson === null) return { ok: false, motivo: 'o projeto não tem package.json' }
  if (arquivos.pnpm || arquivos.yarn) return { ok: false, motivo: 'a prévia por enquanto só instala com npm' }
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try { pkg = JSON.parse(packageJson) } catch { return { ok: false, motivo: 'package.json não é JSON válido' } }
  const dev = pkg.scripts?.dev
  if (!dev) return { ok: false, motivo: 'o package.json não tem script "dev"' }
  const temVite = Boolean(pkg.devDependencies?.vite || pkg.dependencies?.vite)
  if (!temVite || !/\bvite\b/.test(dev)) return { ok: false, motivo: `o script "dev" não é Vite (${dev.slice(0, 60)}) — outros servidores ainda não são suportados` }
  return { ok: true }
}

/** Fronteira comum: uid do dono, sem capabilities, sem escalada, só a pasta do projeto montada. */
function fronteira(pastaNoHost: string, cwd: string): string[] {
  return [
    '--user', UID,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--mount', `type=bind,src=${pastaNoHost},dst=/work`,
    '-w', cwd,
  ]
}

const SCRIPT_DE_INSTALACAO = 'if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund --no-package-lock; fi'

export function argsDeContainerSemCredencial(pastaNoHost: string, cwd: string, comando: string): string[] {
  return [
    'run', '--rm',
    '--network', REDE_DA_SANDBOX,
    '-e', `HTTPS_PROXY=${PROXY}`, '-e', `HTTP_PROXY=${PROXY}`,
    '-e', `https_proxy=${PROXY}`, '-e', `http_proxy=${PROXY}`,
    '-e', 'NO_PROXY=localhost,127.0.0.1',
    '--memory', '2g', '--memory-swap', '2g', '--cpus', '2', '--pids-limit', '512',
    ...fronteira(pastaNoHost, cwd),
    IMAGEM_DA_SANDBOX, 'bash', '-c', comando,
  ]
}

export function argsDaInstalacao(pastaNoHost: string, cwd: string): string[] {
  return argsDeContainerSemCredencial(pastaNoHost, cwd, SCRIPT_DE_INSTALACAO)
}

export function argsDoServidor(pastaNoHost: string, cwd: string, agora: number): string[] {
  return [
    'run', '-d', '--rm',
    '--name', CONTAINER_DA_PREVIA,
    '--network', REDE_DA_PREVIA,
    '--label', `${ROTULO_INICIO}=${agora}`,
    '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '256',
    ...fronteira(pastaNoHost, cwd),
    IMAGEM_DA_SANDBOX,
    'npm', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', String(PORTA_DA_PREVIA), '--strictPort',
  ]
}

/** Lê o necessário para `avaliarProjeto` dentro do clone (pelo executor da sessão). */
export async function lerProjetoParaPrevia(executar: Executor, cwd: string): Promise<Avaliacao> {
  const script = 'if [ -f package.json ]; then echo TEM; cat package.json; else echo NAO; fi; [ -f pnpm-lock.yaml ] && echo "@@PNPM" >&2; [ -f yarn.lock ] && echo "@@YARN" >&2; true'
  const r = await executar('bash', ['-c', script], { cwd, env: {}, timeoutMs: 30_000 })
  if (r.code !== 0 || r.timedOut) return { ok: false, motivo: 'não consegui ler o package.json da sessão' }
  const [cabeca, ...resto] = r.stdout.split('\n')
  const pkg = cabeca.trim() === 'TEM' ? resto.join('\n') : null
  return avaliarProjeto(pkg, { pnpm: r.stderr.includes('@@PNPM'), yarn: r.stderr.includes('@@YARN') })
}

export type ResultadoDaPrevia = { ok: true; url: string } | { ok: false; erro: string }

/**
 * Instala e sobe a prévia da sessão. Derruba a anterior primeiro (uma por vez). Nunca lança.
 */
export async function iniciarPrevia(
  repo: string,
  sessionId: string,
  deps: { rodar?: Rodar; env?: NodeJS.ProcessEnv; agora?: () => number } = {},
): Promise<ResultadoDaPrevia> {
  const rodar = deps.rodar ?? rodarNoHost
  const env = deps.env ?? process.env
  try {
    const pasta = pastaDoProjetoNoHost(repo, env)
    const cwd = `/work/${pastaDaSessao(sessionId)}`
    const ambiente = ambienteSemCredencial(env)
    await pararPrevia(rodar, env)
    const inst = await rodar('docker', argsDaInstalacao(pasta, cwd), { cwd: '/', env: ambiente, timeoutMs: TIMEOUT_INSTALACAO_MS })
    if (inst.code !== 0 || inst.timedOut) {
      return { ok: false, erro: `a instalação das dependências falhou: ${(inst.timedOut ? 'tempo esgotado' : inst.stderr.trim()).slice(-300)}` }
    }
    const srv = await rodar('docker', argsDoServidor(pasta, cwd, (deps.agora ?? Date.now)()), { cwd: '/', env: ambiente, timeoutMs: 60_000 })
    if (srv.code !== 0 || srv.timedOut) {
      return { ok: false, erro: `o servidor da prévia não subiu: ${srv.stderr.trim().slice(-300)}` }
    }
    return { ok: true, url: urlDaPrevia(env) }
  } catch (err) {
    return { ok: false, erro: (err as Error).message }
  }
}

export async function pararPrevia(rodar: Rodar = rodarNoHost, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rodar('docker', ['rm', '-f', CONTAINER_DA_PREVIA], { cwd: '/', env: ambienteSemCredencial(env), timeoutMs: 60_000 }).catch(() => null)
}

/**
 * Desliga a prévia que passou de 2 h. Sem o rótulo de início legível, não decide (mantém):
 * "não sei a idade" não é "está velha".
 */
export async function pararPreviaVencida(
  rodar: Rodar = rodarNoHost,
  agora: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<'parada' | 'mantida' | 'nenhuma'> {
  const r = await rodar('docker', ['inspect', '-f', `{{index .Config.Labels "${ROTULO_INICIO}"}}`, CONTAINER_DA_PREVIA],
    { cwd: '/', env: ambienteSemCredencial(env), timeoutMs: 30_000 }).catch(() => null)
  if (!r || r.code !== 0) return 'nenhuma'
  const inicio = Number(r.stdout.trim())
  if (!Number.isFinite(inicio) || inicio <= 0) return 'mantida'
  if (agora - inicio < VIDA_DA_PREVIA_MS) return 'mantida'
  await pararPrevia(rodar, env)
  return 'parada'
}
