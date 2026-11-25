#!/usr/bin/env node
/**
 * Inventário dos pontos que executam processo — Fase 0 de `docs/plano-execucao-tipada.md`.
 *
 * Existe porque a superfície de execução era conhecida por leitura, e leitura envelhece. Em
 * 2026-09-07 a varredura manual achou 26 pontos no agent e 2 vetores de injeção além do
 * `run_command` — nenhum deles aparecia em documento nenhum.
 *
 * O que ele mede, e por que essa é a pergunta certa: **a chamada interpola valor numa string de
 * comando?** Não é "usa execSync" — `execSync('git status')` com string constante é inofensivo. O
 * risco nasce quando um `${}` entra na linha que alguém vai interpretar.
 *
 * Uso:
 *   node scripts/scan-exec-paths.mjs           # regrava docs/exec-paths.md
 *   node scripts/scan-exec-paths.mjs --check   # sai 1 se o arquivo estiver desatualizado
 *
 * O `--check` roda em teste (`exec-paths-drift.spec.ts`): ponto de execução novo que ninguém
 * declarou quebra a suíte. Sem isso este documento vira a próxima tabela mantida à mão que
 * discorda do código — a mesma falha de `whitelist.ts` ↔ `ExecutionService`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const SAIDA = join(RAIZ, 'docs', 'exec-paths.md')

/** Onde procurar. `node_modules` e `dist` ficam de fora: interessa o que NÓS escrevemos. */
const ALVOS = ['apps/agent/src', 'apps/api/src', 'apps/api-v2/src', 'scripts']
const EXTENSOES = new Set(['.ts', '.mjs', '.js'])
const IGNORAR_DIR = new Set(['node_modules', 'dist', '__tests__', '.next', 'coverage'])

/**
 * Formas que criam processo. `exec(` sozinho é ambíguo (casa `regex.exec`), então exige-se que a
 * linha também mencione um comando plausível — falso negativo aqui é pior que falso positivo, mas
 * um scanner que grita em todo `.exec()` de regex é um scanner que ninguém lê.
 */
const FORMAS = [
  { nome: 'execSync',     re: /\bexecSync\s*\(/ },
  { nome: 'execFileSync', re: /\bexecFileSync\s*\(/ },
  { nome: 'spawnSync',    re: /\bspawnSync\s*\(/ },
  { nome: 'spawn',        re: /(?<![.\w])spawn\s*\(/ },
  { nome: 'execFile',     re: /\bexecFile\s*\(/ },
  { nome: 'exec',         re: /(?<![.\w])exec\s*\(\s*['"`]/ },
]

/** Interpolação na string de comando — o que separa "constante" de "montada". */
const INTERPOLA = /\$\{/

function arquivos(dir) {
  const out = []
  let entradas
  try { entradas = readdirSync(dir) } catch { return out }
  for (const nome of entradas) {
    if (IGNORAR_DIR.has(nome)) continue
    const p = join(dir, nome)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...arquivos(p))
    else if (EXTENSOES.has(nome.slice(nome.lastIndexOf('.')))) out.push(p)
  }
  return out
}

/**
 * Só conta como execução de processo quem importa `child_process`.
 *
 * Sem este filtro o inventário mentia nas duas direções: contava o `spawn()` do
 * `specialist.controller.ts` da V2 (que cria um agente, não um processo) e contava este
 * próprio arquivo, cujas regexes mencionam as formas que ele procura. Inventário com
 * falso positivo é pior que inventário curto — ensina a ignorar a lista.
 */
const IMPORTA_CHILD_PROCESS = /from\s+['"]node:child_process['"]|from\s+['"]child_process['"]|require\(\s*['"](node:)?child_process['"]/

function varrer() {
  const achados = []
  const esteArquivo = relative(RAIZ, fileURLToPath(import.meta.url)).split(sep).join('/')
  for (const alvo of ALVOS) {
    for (const arquivo of arquivos(join(RAIZ, alvo))) {
      const rel = relative(RAIZ, arquivo).split(sep).join('/')
      if (rel === esteArquivo) continue
      const texto = readFileSync(arquivo, 'utf8')
      if (!IMPORTA_CHILD_PROCESS.test(texto)) continue
      const linhas = texto.split(/\r?\n/)
      linhas.forEach((linha, i) => {
        const forma = FORMAS.find((f) => f.re.test(linha))
        if (!forma) return
        achados.push({
          arquivo: rel,
          linha:   i + 1,
          forma:   forma.nome,
          montada: INTERPOLA.test(linha),
        })
      })
    }
  }
  return achados.sort((a, b) => a.arquivo.localeCompare(b.arquivo) || a.linha - b.linha)
}

function render(achados) {
  const montadas = achados.filter((a) => a.montada)
  const porArquivo = new Map()
  for (const a of achados) {
    if (!porArquivo.has(a.arquivo)) porArquivo.set(a.arquivo, [])
    porArquivo.get(a.arquivo).push(a)
  }

  const linhas = [
    '# Inventário de execução de processos',
    '',
    '> **GERADO** por `node scripts/scan-exec-paths.mjs`. Não edite à mão — `--check` roda em teste',
    '> e falha se este arquivo divergir do código.',
    '',
    'Fase 0 de [`plano-execucao-tipada.md`](plano-execucao-tipada.md). A coluna que importa é',
    '**montada**: a linha interpola `${}` na string de comando. Chamada com string constante',
    '(`execSync(\'git status\')`) não é risco; o risco nasce quando um valor entra na linha que',
    'alguém vai interpretar.',
    '',
    `**${achados.length} pontos de execução · ${montadas.length} com comando montado.**`,
    '',
    '| arquivo | linha | forma | montada |',
    '|---|---:|---|:---:|',
  ]
  for (const a of achados) {
    linhas.push(`| \`${a.arquivo}\` | ${a.linha} | \`${a.forma}\` | ${a.montada ? '**sim**' : '—'} |`)
  }
  linhas.push('', '## Por app', '')
  const porApp = new Map()
  for (const a of achados) {
    // `apps/agent`, mas `scripts` inteiro — senão cada script vira um "app".
    const partes = a.arquivo.split('/')
    const app = partes[0] === 'apps' ? partes.slice(0, 2).join('/') : partes[0]
    const cur = porApp.get(app) ?? { total: 0, montadas: 0 }
    cur.total++; if (a.montada) cur.montadas++
    porApp.set(app, cur)
  }
  linhas.push('| app | pontos | montados |', '|---|---:|---:|')
  for (const [app, v] of [...porApp].sort()) {
    linhas.push(`| \`${app}\` | ${v.total} | ${v.montadas} |`)
  }
  linhas.push('')
  return linhas.join('\n')
}

const conteudo = render(varrer())

if (process.argv.includes('--check')) {
  let atual = ''
  try { atual = readFileSync(SAIDA, 'utf8') } catch { /* ausente = desatualizado */ }
  if (atual.replace(/\r\n/g, '\n') !== conteudo) {
    console.error('docs/exec-paths.md desatualizado — rode `node scripts/scan-exec-paths.mjs`')
    process.exit(1)
  }
  console.log('docs/exec-paths.md em dia')
} else {
  writeFileSync(SAIDA, conteudo, 'utf8')
  console.log(`docs/exec-paths.md atualizado`)
}
