#!/usr/bin/env node
/**
 * Diagnostico da MAQUINA DE TRABALHO — o que os invariantes do servidor nao alcancam.
 *
 * Os invariantes de `apps/api-v2/src/invariants/` medem o estado do sistema no servidor e
 * rodam sozinhos a cada 30min. Nada mede a instalacao local: hooks, MCP, ACL dos segredos,
 * coerencia do `node_modules`. Foi por isso que o move do repositorio em 08/09 derrubou a
 * integracao inteira sem nada acusar — hooks e MCP apontando para `Desktop\Projects`, que
 * deixou de existir. O painel ficou verde, o contexto injetado simplesmente parou de vir, e
 * isso e indistinguivel de um projeto que nao tem contexto a dar.
 *
 * O criterio de entrada e o mesmo do catalogo de invariantes: **ja quebrou em silencio**.
 * Cada check abaixo corresponde a uma falha real, datada.
 *
 *   pnpm check:local           # diagnostica, exit 1 se houver falha
 *   pnpm check:local --fix     # aplica as correcoes seguras (hoje: reaplicar ACL dos segredos)
 *
 * NAO se chama `doctor`: `pnpm doctor` e um comando NATIVO do pnpm, e um script com esse nome
 * e silenciosamente ignorado — roda o built-in, imprime nada e sai 0. Foi o que aconteceu na
 * primeira tentativa de registrar isto, o que seria uma ironia cara: um sensor contra
 * "exit 0 sem trabalho feito" invisivel pelo mesmo motivo.
 *
 * TRES ESTADOS, NAO DOIS: ok / falha / inconclusivo. Um check que nao consegue medir NAO
 * pode devolver sucesso — foi assim que `Test-Path` fez alvo inexistente parecer isolamento
 * funcionando, na bateria do RayzenExec.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT   = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const FIX    = process.argv.includes('--fix')
const WIN    = process.platform === 'win32'

const OK = 'ok', FALHA = 'falha', INC = 'inconclusivo'
const checks = []
const reg = (nome, estado, detalhe) => checks.push({ nome, estado, detalhe })

/** Le JSON tolerando ausencia — arquivo que nao existe e inconclusivo, nunca sucesso. */
function lerJson (p) {
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined }
}

// ---------------------------------------------------------------------------
// 1. hooks e MCP apontam para ESTE repositorio
//
// Quebrou em 08/09: o move para fora do Desktop deixou 8 referencias mortas em
// ~/.claude/settings.json, .claude/settings.json, .mcp.json e .git/hooks/pre-push.
// Sintoma: nenhum. Os hooks falham com exit 1 e o Claude Code segue sem contexto.
// ---------------------------------------------------------------------------
function checkCaminhos () {
  const fontes = [
    ['~/.claude/settings.json', join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'settings.json')],
    ['.claude/settings.json',   join(ROOT, '.claude', 'settings.json')],
    ['.mcp.json',               join(ROOT, '.mcp.json')],
    ['.git/hooks/pre-push',     join(ROOT, '.git', 'hooks', 'pre-push')],
  ]

  const mortos = []
  let examinados = 0

  for (const [rotulo, caminho] of fontes) {
    if (!existsSync(caminho)) continue
    const bruto = readFileSync(caminho, 'utf8')
    // Extrai qualquer caminho absoluto para .mjs, com barra normal ou invertida.
    const refs = bruto.match(/[A-Za-z]:[\\/][^"'\s]+?\.mjs/g) || []
    for (const r of refs) {
      examinados++
      const normal = r.replace(/\\\\/g, '\\')
      if (!existsSync(normal)) mortos.push(`${rotulo} -> ${normal}`)
    }
  }

  if (examinados === 0) return reg('hooks_e_mcp_apontam_para_este_repo', INC, 'nenhuma referencia .mjs encontrada nas configuracoes')
  if (mortos.length > 0) return reg('hooks_e_mcp_apontam_para_este_repo', FALHA, `${mortos.length} de ${examinados} referencia(s) morta(s):\n      ` + mortos.join('\n      '))
  reg('hooks_e_mcp_apontam_para_este_repo', OK, `${examinados} referencia(s), todas existem`)
}

// ---------------------------------------------------------------------------
// 2. segredos fechados para outras contas locais  (Windows)
//
// Quebrou desde sempre, descoberto em 09/09: a conta RayzenExec LIA o .env do repo.
// Arquivo de segredo NOVO nasce herdando a ACL permissiva do pai, entao isto nao e um
// conserto de uma vez — e um check recorrente.
// ---------------------------------------------------------------------------
const PADROES_SEGREDO = [/^\.env$/, /^\.env\.local$/, /^\.env\..*\.local$/, /^\.env\.agent\.local$/,
                         /^hook\.config\.mjs$/, /\.pem$/, /\.pfx$/, /\.key$/, /^credentials\.json$/]

function acharSegredos (dir, achados = [], profundidade = 0) {
  if (profundidade > 6) return achados
  let entradas
  try { entradas = readdirSync(dir, { withFileTypes: true }) } catch { return achados }
  for (const e of entradas) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) acharSegredos(p, achados, profundidade + 1)
    else if (!e.name.endsWith('.example') && PADROES_SEGREDO.some(r => r.test(e.name))) achados.push(p)
  }
  return achados
}

function checkSegredos () {
  if (!WIN) return reg('segredos_fechados_para_outras_contas', INC, 'so mede em Windows (ACL)')

  const segredos = acharSegredos(ROOT)
  if (segredos.length === 0) return reg('segredos_fechados_para_outras_contas', INC, 'nenhum arquivo de segredo encontrado — confira os padroes')

  const abertos = []
  for (const s of segredos) {
    let acl
    // execFileSync, nunca via shell: o Git Bash converte `/reset` e afins em caminho
    // Windows e o comando sai 0 sem fazer nada — medido em 09/09.
    try { acl = execFileSync('icacls', [s], { encoding: 'latin1' }) } catch { continue }

    // O icacls imprime a PRIMEIRA ACE na mesma linha do caminho:
    //   C:\...\.env DESKTOP-JTHSVUI\CodexSandboxUsers:(I)(RX)
    // Pular a primeira linha (o obvio, para nao casar o caminho) descarta justamente a
    // permissao mais provavel de estar errada. Medido: com `.slice(1)` este check ficava
    // VERDE com um `.env` legivel pelo Codex na frente dele. Remover o caminho literal e
    // analisar tudo e o unico jeito de nao ter ponto cego.
    const semCaminho = acl.replace(s, '')

    // "Outra conta" = qualquer principal que nao seja voce, SYSTEM ou Administradores.
    const suspeito = /Usu.rios:|BUILTIN\\Users:/.test(semCaminho) ||
                     /CodexSandbox/.test(semCaminho) ||
                     /S-1-5-21-\S+:/.test(semCaminho)
    if (suspeito) abertos.push(s.slice(ROOT.length + 1))
  }

  if (abertos.length === 0) return reg('segredos_fechados_para_outras_contas', OK, `${segredos.length} arquivo(s), nenhum concede acesso a outra conta`)

  if (FIX) {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                                      join(ROOT, 'scripts', 'proteger-segredos-locais.ps1')], { stdio: 'inherit' })
      return reg('segredos_fechados_para_outras_contas', OK, `${abertos.length} arquivo(s) reabertos foram fechados por --fix`)
    } catch {
      return reg('segredos_fechados_para_outras_contas', FALHA, `--fix falhou; abertos: ${abertos.join(', ')}`)
    }
  }
  reg('segredos_fechados_para_outras_contas', FALHA,
      `${abertos.length} aberto(s) a outra conta local:\n      ` + abertos.join('\n      ') +
      '\n      corrija com: pnpm check:local --fix')
}

// ---------------------------------------------------------------------------
// 3. node_modules coerente com a raiz atual
//
// Quebrou em 08/09: o pnpm liga pacotes por junction ABSOLUTA e grava `virtualStoreDir`
// absoluto. Depois do move todos apontavam para o Desktop; `tsc` sumiu. E `pnpm install`
// NAO conserta sozinho — aborta com ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY e sai 0.
// ---------------------------------------------------------------------------
function checkNodeModules () {
  const modules = join(ROOT, 'node_modules', '.modules.yaml')
  if (!existsSync(modules)) return reg('node_modules_coerente_com_a_raiz', INC, 'node_modules/.modules.yaml ausente — rode pnpm install')

  const bruto = readFileSync(modules, 'utf8')
  // O pnpm 10 escreve a chave ENTRE ASPAS ("virtualStoreDir": "..."), apesar da extensao .yaml.
  // Um regex que assumia YAML puro devolvia INCONCLUSIVO em vez de medir — corrigido olhando o
  // arquivo real, nao o formato que o nome do arquivo sugere.
  const m = bruto.match(/"?virtualStoreDir"?:\s*"?([^"\n]+)"?/)
  if (!m) return reg('node_modules_coerente_com_a_raiz', INC, 'virtualStoreDir nao encontrado no .modules.yaml')

  const declarado = m[1].replace(/\\\\/g, '\\').replace(/",?$/, '').trim()
  const esperado  = join(ROOT, 'node_modules', '.pnpm')
  if (declarado.toLowerCase() !== esperado.toLowerCase()) {
    return reg('node_modules_coerente_com_a_raiz', FALHA,
      `aponta para outra raiz:\n      declarado: ${declarado}\n      esperado:  ${esperado}` +
      '\n      corrija com: CI=true pnpm install --frozen-lockfile   (a purga exige a variavel: sem TTY o pnpm aborta e sai 0)')
  }
  reg('node_modules_coerente_com_a_raiz', OK, declarado)
}

// ---------------------------------------------------------------------------
// 4. o dist do agent e mais novo que o src
//
// Quebrou por 20 dias ate 06/09: `rayzen-start.bat` compilava so `if not exist dist\index.js`.
// O agent rodava codigo de 17/08 com tudo parecendo saudavel.
// ---------------------------------------------------------------------------
function maisRecente (dir, limite = 0) {
  let entradas
  try { entradas = readdirSync(dir, { withFileTypes: true }) } catch { return limite }
  for (const e of entradas) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) limite = maisRecente(p, limite)
    else if (/\.(ts|mjs|js)$/.test(e.name)) {
      const t = statSync(p).mtimeMs
      if (t > limite) limite = t
    }
  }
  return limite
}

function checkDistAgent () {
  const dist = join(ROOT, 'apps', 'agent', 'dist', 'index.js')
  const src  = join(ROOT, 'apps', 'agent', 'src')
  if (!existsSync(dist)) return reg('dist_do_agent_mais_novo_que_o_src', FALHA, 'apps/agent/dist/index.js ausente — rode pnpm --filter agent build')
  if (!existsSync(src))  return reg('dist_do_agent_mais_novo_que_o_src', INC, 'apps/agent/src ausente')

  const tDist = statSync(dist).mtimeMs
  const tSrc  = maisRecente(src)
  const dias  = (tSrc - tDist) / 86400000

  if (tSrc > tDist) {
    return reg('dist_do_agent_mais_novo_que_o_src', FALHA,
      `src e ${dias.toFixed(1)} dia(s) mais novo que o dist — o agent roda codigo velho` +
      '\n      corrija com: pnpm --filter agent build')
  }
  reg('dist_do_agent_mais_novo_que_o_src', OK, `dist de ${new Date(tDist).toISOString().slice(0, 16).replace('T', ' ')}`)
}

// ---------------------------------------------------------------------------
// 5. clients Prisma gerados
//
// Quebrou em 09/09, e a causa fui eu: `CI=true pnpm install --frozen-lockfile` purgou o
// node_modules para religar as junctions depois do move, e o postinstall do @prisma/client
// avisou `We could not find your Prisma schema in the default locations` — em meio a 20
// linhas de log, ignorado.
//
// O estrago some da vista: `tsc` do agent compila, o app sobe, e o que fica quebrado e o
// TYPECHECK e a SUITE. Medido em 10/09: 14 erros TS7006 (`implicitly has an 'any' type`) e
// os specs dos invariantes sem RODAR — 0 testes, falha na compilacao do arquivo inteiro.
// Pior, o HEAD falhava igual, entao comparar com o HEAD dizia "pre-existente" e mandava
// procurar defeito no lugar errado.
// ---------------------------------------------------------------------------
function checkPrisma () {
  // Os dois apps geram em lugares DIFERENTES, e presumir um padrao unico dava vermelho
  // permanente — medido ao validar este check, que acusou `apps/api` logo depois de o
  // client ter sido gerado com sucesso.
  //
  //   api-v2 -> declara `output = "../generated/prisma-client-v2"` no schema
  //   api    -> NAO declara output, entao cai no store do pnpm:
  //             node_modules/.pnpm/@prisma+client@<versao>/node_modules/.prisma/client
  //
  // Vermelho permanente e o que se aprende a ignorar; por isso os candidatos vem do
  // comportamento real de cada schema, nao de uma convencao imaginada.
  const temConteudo = (p) => existsSync(p) && readdirSync(p).length > 0

  const clientV1 = () => {
    const diretos = [
      join(ROOT, 'apps', 'api', 'node_modules', '.prisma', 'client'),
      join(ROOT, 'node_modules', '.prisma', 'client'),
    ]
    if (diretos.some(temConteudo)) return true

    const pnpmDir = join(ROOT, 'node_modules', '.pnpm')
    if (!existsSync(pnpmDir)) return false
    return readdirSync(pnpmDir)
      .filter((n) => n.startsWith('@prisma+client@'))
      .some((n) => temConteudo(join(pnpmDir, n, 'node_modules', '.prisma', 'client')))
  }

  const apps = [
    ['apps/api',    clientV1],
    ['apps/api-v2', () => temConteudo(join(ROOT, 'apps', 'api-v2', 'generated', 'prisma-client-v2'))],
  ]

  const faltando = []
  for (const [rotulo, existe] of apps) {
    if (!existe()) faltando.push(rotulo)
  }

  if (faltando.length > 0) {
    return reg('clients_prisma_gerados', FALHA,
      `${faltando.length} client nao gerado:\n      ` + faltando.join('\n      ') +
      '\n      corrija com: pnpm --filter api db:generate && pnpm --filter api-v2 db:generate')
  }
  reg('clients_prisma_gerados', OK, 'os dois clients existem')
}

checkCaminhos()
checkSegredos()
checkNodeModules()
checkDistAgent()
checkPrisma()

const simbolo = { [OK]: '  OK  ', [FALHA]: 'FALHA ', [INC]: ' ??   ' }
console.log('')
console.log(`Rayzen doctor — maquina de trabalho (${ROOT})`)
console.log('')
for (const c of checks) console.log(`${simbolo[c.estado]}| ${c.nome}\n      ${c.detalhe}\n`)

const falhas = checks.filter(c => c.estado === FALHA).length
const incs   = checks.filter(c => c.estado === INC).length
console.log(`${checks.length - falhas - incs} ok · ${falhas} falha(s) · ${incs} inconclusivo(s)`)
if (incs > 0 && falhas === 0) console.log('\nInconclusivo NAO e sucesso: o check nao conseguiu medir. Veja o detalhe.')
process.exit(falhas > 0 ? 1 : 0)
