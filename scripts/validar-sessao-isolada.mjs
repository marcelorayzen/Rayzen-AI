// Validacao PONTA A PONTA da Fase 4-B, contra a conta RayzenExec real.
//
// Nao e teste unitario: os 31 testes de `sessao-isolada.spec.ts` protegem as decisoes, e
// nenhum deles inicia processo. Este aqui roda o caminho inteiro -- preparar, executar,
// entregar -- e confere o ESTADO dos dois lados no fim. Codigo de saida nao e evidencia.
//
//   node scripts/validar-sessao-isolada.mjs
//
// O que ele prova, e cada item ja falhou de alguma forma nesta casa:
//   1. a arvore da conta chega no MESMO commit do dono (o clone estava 9 atras em 11/09)
//   2. o prompt atravessa por arquivo e o Claude executa DENTRO da conta
//   3. o log e legivel ao vivo, do outro lado da fronteira de conta
//   4. o trabalho volta por bundle, verificavel contra o repositorio do dono
//   5. a arvore do DONO nao se move -- nem HEAD, nem working tree

import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const repo = dirname(dirname(fileURLToPath(import.meta.url)))

const iso = require(join(repo, 'apps/agent/dist/exec/sessao-isolada.js'))
const ss  = require(join(repo, 'apps/agent/dist/actions/supervised-session.js'))

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
const linha = (rotulo, ok, detalhe) =>
  console.log(`  ${ok ? 'OK     ' : 'FALHA  '} ${rotulo.padEnd(44)} ${detalhe ?? ''}`)

const sessionId = randomUUID()
const resultados = []
const registrar = (rotulo, ok, detalhe) => { resultados.push(ok); linha(rotulo, ok, detalhe) }

console.log(`validando a sessao isolada ponta a ponta (sessao ${sessionId.slice(0, 8)})\n`)

// ---- 0. Pre-requisitos ---------------------------------------------------------------
const problemas = iso.prerequisitos()
registrar('conta pronta', problemas.length === 0, problemas.join('; ') || iso.caminhoDoWorkspace())
if (problemas.length > 0) { console.log('\nnada foi enviado.'); process.exit(1) }

// ---- Estado do dono ANTES ------------------------------------------------------------
const headAntes  = git('rev-parse', 'HEAD')
const sujoAntes  = git('status', '--porcelain')

// ---- 1. Preparar ---------------------------------------------------------------------
console.log('\n1) preparando o workspace da conta...')
const { base, ramo } = await iso.prepararWorkspace(sessionId, repo)
registrar('a conta foi para a base do dono', base === headAntes, `${base.slice(0, 7)} · ramo ${ramo}`)

// ---- 2. Executar ---------------------------------------------------------------------
// Prompt com metacaractere DE PROPOSITO: se algum ponto do caminho o interpretasse, ele nao
// voltaria literal no arquivo escrito pela sessao.
const arquivo = 'docs/decisions/sessao-isolada-validacao.md'
const prompt = [
  '[PROTOCOLO RAYZEN - obrigatorio]',
  'Ao concluir a missao inteira, escreva em linha propria o marcador [[RAYZEN:DONE]].',
  '',
  `Tarefa: crie o arquivo ${arquivo} com exatamente estas tres linhas:`,
  '',
  '# Validacao da sessao isolada',
  `Escrito pela sessao supervisionada rodando na conta RayzenExec, sessao ${sessionId.slice(0, 8)}.`,
  'Literal que precisa sobreviver: ; && | $(whoami) `hostname`',
  '',
  'Depois rode `git add` e `git commit` com a mensagem',
  '"test(sessao): validacao da Fase 4-B pela propria sessao".',
  'Nao faca mais nada. Termine com o marcador.',
].join('\n')

console.log('\n2) a sessao esta rodando DENTRO da conta (log ao vivo abaixo)...\n')
let pedacos = 0
const t0 = Date.now()
const r = await iso.executarNaConta(
  sessionId, prompt, ss.FERRAMENTAS_PERMITIDAS, ss.FERRAMENTAS_NEGADAS,
  (chunk) => { pedacos++; process.stdout.write(chunk.split('\n').map((l) => `     | ${l}`).join('\n')) },
)
console.log('')
registrar('claude executou na conta', r.codigo === 0, `exit=${r.codigo} · ${r.campos.claude_ms} ms`)
// O que se pode afirmar aqui e que o log ATRAVESSOU a fronteira de conta. A capacidade de ler
// ao vivo foi medida a parte, pela sonda de 11/09 (10 tamanhos distintos com o arquivo sendo
// escrito, zero erro de compartilhamento) -- e precisou ser medida a parte por um motivo que
// vale registrar: `claude -p` NAO emite progressivamente. Ele devolve a resposta inteira num
// unico bloco, no fim, entao ha um pedaco so por iteracao. Vale igual para o modo local, cujo
// agrupamento de chunks a cada 800ms sempre agrupou uma rajada unica.
registrar('log atravessou a fronteira de conta', pedacos >= 1 && r.saida.length > 0,
  `${pedacos} leitura(s) · ${r.saida.length} chars`)
registrar('marcador do protocolo voltou', /\[\[RAYZEN:DONE\]\]/.test(r.saida), '')
registrar('diff veio da conta', r.diff.length > 0, r.diff.split('\n')[0] ?? '(vazio)')

// ---- 3. Entregar ---------------------------------------------------------------------
console.log('\n3) a conta empacota e entrega no outbox...')
const entrega = await iso.entregarTrabalho(sessionId, base)
registrar('bundle produzido', Boolean(entrega.bundle), `${entrega.commits} commit(s) · ${entrega.bundle ?? '-'}`)

// ---- 4. O dono recebe, SEM MESCLAR ---------------------------------------------------
if (entrega.bundle) {
  console.log('\n4) o dono verifica -- sem mesclar:')
  let verificou = true
  try { git('bundle', 'verify', entrega.bundle) } catch { verificou = false }
  registrar('bundle verify contra o repo do dono', verificou, '')

  const ref = `refs/rayzenexec/validacao-${sessionId.slice(0, 8)}`
  git('fetch', entrega.bundle, `HEAD:${ref}`)
  const stat = git('diff', '--stat', `${base}..${ref}`)
  registrar('o trabalho esta endereçavel', stat.length > 0, stat.split('\n')[0] ?? '')

  const conteudo = git('show', `${ref}:${arquivo}`)
  registrar('metacaractere sobreviveu literal',
    conteudo.includes('; && | $(whoami)'), 'o `; && | $(whoami)` voltou sem interpretacao')

  console.log('\n  conteudo entregue:')
  conteudo.split('\n').forEach((l) => console.log(`     | ${l}`))
  console.log(`\n  para descartar:  git update-ref -d ${ref}`)
}

// ---- 5. A arvore do dono NAO se moveu ------------------------------------------------
console.log('')
registrar('HEAD do dono intacto',        git('rev-parse', 'HEAD') === headAntes, headAntes.slice(0, 7))
registrar('working tree do dono intacto', git('status', '--porcelain') === sujoAntes, 'nenhum arquivo novo aqui')

const falhas = resultados.filter((ok) => !ok).length
console.log(`\nRESUMO: ${resultados.length - falhas} de ${resultados.length}` + (falhas ? `  -- ${falhas} FALHA(S)` : ''))
console.log(`tempo total: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(falhas > 0 ? 1 : 0)
