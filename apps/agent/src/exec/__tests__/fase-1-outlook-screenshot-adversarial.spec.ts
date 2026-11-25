/**
 * SENTINELA — nenhum teste desta área pode iniciar processo real. Mesma regra de
 * `fase-1a-adversarial.spec.ts`: um teste de segurança que executa o comando que investiga
 * é um teste que causa o defeito em vez de provar a ausência dele.
 */
const sentinela = (nome: string) => (...args: unknown[]) => {
  throw new Error(`SENTINELA: ${nome} foi chamado num teste — nenhum processo real pode subir aqui. Args: ${JSON.stringify(args).slice(0, 200)}`)
}
jest.mock('child_process', () => ({
  execSync: sentinela('execSync'), execFileSync: sentinela('execFileSync'),
  spawnSync: sentinela('spawnSync'), spawn: sentinela('spawn'),
  exec: sentinela('exec'), execFile: sentinela('execFile'),
}))

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { readEmails, sendEmail } from '../../actions/outlook'
import { getCalendar } from '../../actions/outlook-calendar'
import { takeScreenshot } from '../../actions/screenshot'
import { caminhoDoHelper, type ExecutorDeHelper } from '../executar-helper'

/**
 * Fase 1 — o achado real: `outlook.ts sendEmail` gerava `$mail.To = "${to}"` dentro de
 * aspas DUPLAS do PowerShell. `to` é endereço de destinatário, validado só com
 * `.includes('@')` — `to: 'x$(calc.exe)@evil.com'` produzia um script contendo
 * `.To = "x$(calc.exe)@evil.com"`, e `$( )` dentro de aspas duplas é subexpressão: o
 * PowerShell executaria `calc.exe` ao simplesmente ATRIBUIR a propriedade, antes de
 * qualquer `.Send()`. Nunca testado adversarialmente — a Fase 0 nem chegou a olhar este
 * arquivo. Todos os payloads abaixo mantêm `@` para passar da validação de formato e
 * chegar ao ponto que importa.
 */
const ADVERSARIAIS_COM_ARROBA: Array<[string, string]> = [
  ['subexpressão em aspas duplas', 'x$(calc.exe)@evil.com'],
  ['aspa dupla fechando o -Command antigo', 'x"; Write-Output PWNED; "@evil.com'],
  ['crase', 'x`whoami`@evil.com'],
  ['here-string breakout (linha começando com \'@)', "x\n'@\nWrite-Output PWNED\n$x = @'\n@evil.com"],
  ['ponto e vírgula', 'x; Write-Output PWNED@evil.com'],
  ['expansão de variável de ambiente', 'x$env:AGENT_TOKEN@evil.com'],
]

const ADVERSARIAIS_TEXTO: Array<[string, string]> = [
  ['subexpressão', '$(calc.exe)'],
  ['aspa dupla', 'x"; Write-Output PWNED; "'],
  ['crase', '`whoami`'],
  ['here-string breakout', "x\n'@\nWrite-Output PWNED"],
]

function espiao() {
  const chamadas: Array<{ programa: string; args: string[]; entrada: string }> = []
  const executor: ExecutorDeHelper = (programa, args, entrada) => {
    chamadas.push({ programa, args, entrada })
    return '[]'
  }
  return { chamadas, executor }
}

describe('outlook sendEmail — payload adversarial vira dado JSON, nunca comando', () => {
  it.each(ADVERSARIAIS_COM_ARROBA)('%s', async (_nome, to) => {
    const { chamadas, executor } = espiao()

    await sendEmail({ to, subject: 'assunto', body: 'corpo', dryRun: false }, executor)

    expect(chamadas).toHaveLength(1)
    const [c] = chamadas
    const dados = JSON.parse(c.entrada) as { to: string; subject: string; body: string }
    // Chega LITERAL — nem um caractere reinterpretado, muito menos executado.
    expect(dados.to).toBe(to)
    expect(c.args.join(' ')).not.toContain(to)
    expect(c.args).toContain('-File')
    expect(c.args).not.toContain('-Command')
  })

  it.each(ADVERSARIAIS_TEXTO)('subject/body adversarial: %s', async (_nome, texto) => {
    const { chamadas, executor } = espiao()

    await sendEmail({ to: 'x@evil.com', subject: texto, body: texto, dryRun: false }, executor)

    const dados = JSON.parse(chamadas[0].entrada) as { subject: string; body: string }
    expect(dados.subject).toBe(texto)
    expect(dados.body).toBe(texto)
  })

  it('dryRun não chega a chamar o helper — nem sequer resolve o executor', async () => {
    const { chamadas, executor } = espiao()
    const r = await sendEmail({ to: 'x$(calc.exe)@evil.com', subject: 's', body: 'b', dryRun: true }, executor)
    expect(chamadas).toHaveLength(0)
    expect(r.sent).toBe(false)
  })

  it('endereço sem @ é rejeitado antes de qualquer coisa', async () => {
    const { chamadas, executor } = espiao()
    await expect(sendEmail({ to: 'sem-arroba', subject: 's', body: 'b', dryRun: false }, executor))
      .rejects.toThrow(/Endereço inválido/)
    expect(chamadas).toHaveLength(0)
  })
})

describe('outlook readEmails — limit vira dado, nunca interpolado no comando', () => {
  it('o limit chega como campo do JSON, clampado em 20', async () => {
    const { chamadas, executor } = espiao()
    await readEmails({ limit: 999 }, executor)
    const dados = JSON.parse(chamadas[0].entrada) as { limit: number }
    expect(dados.limit).toBe(20)
    expect(chamadas[0].args).toContain('-File')
    expect(chamadas[0].args).not.toContain('-Command')
  })
})

describe('outlook-calendar — days vira dado; datas são calculadas dentro do .ps1', () => {
  it('days chega como campo do JSON, clampado em 7', async () => {
    const { chamadas, executor } = espiao()
    await getCalendar({ days: 999 }, executor)
    const dados = JSON.parse(chamadas[0].entrada) as { days: number }
    expect(dados.days).toBe(7)
  })

  /** O TypeScript não manda mais data nenhuma — o .ps1 calcula com Get-Date. */
  it('nenhum campo de data sai do lado TypeScript', async () => {
    const { chamadas, executor } = espiao()
    await getCalendar({ days: 3 }, executor)
    const dados = JSON.parse(chamadas[0].entrada) as Record<string, unknown>
    expect(Object.keys(dados)).toEqual(['days'])
  })
})

describe('screenshot — project/filename já sanitizados chegam como dado', () => {
  it.each(['<script>', '../../evil', 'x"; Write-Output PWNED; "', 'x$(calc.exe)'])(
    'label adversarial "%s" é sanitizado ANTES de virar payload',
    async (label) => {
      const { chamadas, executor } = espiao()
      await takeScreenshot({ label }, executor)
      const dados = JSON.parse(chamadas[0].entrada) as { project: string; filename: string }
      // sanitize() já reduziu a [a-zA-Z0-9_-]; nada do payload original sobrevive.
      expect(dados.filename).toMatch(/^[a-zA-Z0-9_-]+\.png$/)
    },
  )
})

describe('helpers da Fase 1 — existem no disco e não reinterpretam o que leem', () => {
  const NOVOS = ['outlook-read', 'outlook-send', 'outlook-calendar', 'screenshot'] as const

  it.each(NOVOS)('%s.ps1 existe — ausência cairia de volta no caminho antigo', (nome) => {
    expect(existsSync(caminhoDoHelper(nome))).toBe(true)
  })

  it.each(NOVOS)('%s.ps1 não usa Invoke-Expression', (nome) => {
    const ps = readFileSync(caminhoDoHelper(nome), 'utf8')
    expect(ps).not.toMatch(/Invoke-Expression|\biex\b/i)
  })

  /**
   * O achado real: valor de payload nunca pode entrar dentro de uma string de aspas DUPLAS
   * do PowerShell (onde `$()` é subexpressão) nem de um here-string reaberto. Os três
   * campos de dado (`.to`, `.subject`, `.body`, `.project`, `.filename`) só podem aparecer
   * como ATRIBUIÇÃO/ARGUMENTO direto — nunca colados dentro de `"..."`.
   */
  it('outlook-send.ps1 atribui $dados.* direto, nunca dentro de string entre aspas', () => {
    const ps = readFileSync(caminhoDoHelper('outlook-send'), 'utf8')
    expect(ps).not.toMatch(/"\$\{?\$dados\./)
    expect(ps).not.toMatch(/"[^"\n]*\$dados\.(to|subject|body)[^"\n]*"/)
    expect(ps).toMatch(/\$mail\.To\s*=\s*\[string\]\$dados\.to\s*$/m)
  })

  it('screenshot.ps1 passa $dados.* como argumento de Join-Path, nunca dentro de string', () => {
    const ps = readFileSync(caminhoDoHelper('screenshot'), 'utf8')
    expect(ps).not.toMatch(/"[^"\n]*\$dados\.(project|filename)[^"\n]*"/)
  })
})

describe('anti-drift — nenhuma das quatro ações volta a montar comando por template', () => {
  const semComentarios = (arquivo: string) =>
    readFileSync(join(__dirname, '..', '..', 'actions', arquivo), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it.each(['outlook.ts', 'outlook-calendar.ts', 'screenshot.ts'])('%s não importa child_process', (arquivo) => {
    expect(semComentarios(arquivo)).not.toMatch(/from 'child_process'/)
  })

  it.each(['outlook.ts', 'outlook-calendar.ts', 'screenshot.ts'])('%s não monta -Command com template', (arquivo) => {
    // `${to}` dentro de uma mensagem de erro JS ("Endereço inválido: ${to}") é texto
    // exibido ao chamador, não comando — não é o defeito que este teste procura. O que
    // importa é a AUSÊNCIA de `-Command "..."` com valor dentro, que é onde a
    // reinterpretação pelo PowerShell de fato acontecia.
    expect(semComentarios(arquivo)).not.toMatch(/-Command\s*"/)
  })
})
