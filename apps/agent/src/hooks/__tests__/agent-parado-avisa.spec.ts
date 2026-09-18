import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * A ausência do agent desktop era completamente silenciosa.
 *
 * Em 2026-09-06 o `guardian` ficou **28h sem bater** — o PC reiniciou e ninguém
 * religou o agent — e nada disse nada. Os hooks do Claude Code continuam
 * funcionando (rodam do `src`, não dependem do agent), o painel continua verde, e
 * o contexto injetado sai com exatamente a mesma cara: os blocos do Guardian e dos
 * invariantes simplesmente não aparecem, que é o que também acontece quando está
 * tudo bem.
 *
 * Mesma família do estado velho do ProjectState — *ausente se percebe, velho não* —
 * com o agravante de que aqui a ausência do sinal era indistinguível de "não há
 * nada a reportar".
 *
 * Como `identidade-injetada.spec.ts` e `hook-signal-quality.spec.ts`, este teste lê
 * o `.mjs` como TEXTO: o hook roda direto pelo Claude Code, sem build, e não há
 * módulo para importar.
 */
describe('rayzen-context-hook — avisa quando o agent está parado', () => {
  const fonte = readFileSync(join(__dirname, '..', 'rayzen-context-hook.mjs'), 'utf8')

  it('lê o rastro de vida que o watcher escreve', () => {
    expect(fonte).toMatch(/function avisoAgentParado\(/)
    expect(fonte).toContain('rayzen-agent-vivo.json')
  })

  /**
   * Arquivo ausente é o caso do PC recém-ligado — justamente o que originou isto.
   * Tratar "não consegui ler" como "está tudo bem" reconstruiria o silêncio.
   */
  it('trata arquivo ausente como parado, não como ok', () => {
    const fn = fonte.slice(fonte.indexOf('function avisoAgentParado('))
    const corpo = fn.slice(0, fn.indexOf('\nfunction formatarIdade'))
    expect(corpo).toMatch(/catch\s*\{[^}]*\}/)
    // O `return null` (= calado) só pode acontecer DEPOIS de confirmar que a marca
    // é recente. Um `return null` dentro do catch seria o silêncio de volta.
    expect(corpo).toMatch(/Date\.now\(\)\s*-\s*em\s*<\s*VIVO_TOLERANCIA_MS\)\s*return null/)
  })

  /**
   * Calado abaixo da tolerância pelo mesmo motivo dos invariantes: um aviso em todo
   * prompt treina a ignorar o aviso. E a tolerância precisa ser maior que o tick do
   * watcher (30s), senão qualquer atraso de agendamento vira alarme.
   */
  it('a tolerância é folgada em relação ao tick de 30s do watcher', () => {
    const m = fonte.match(/const VIVO_TOLERANCIA_MS = (\d+) \* 60 \* 1000/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(2)
  })

  /**
   * Sai pela identidade, que é emitida nos DOIS caminhos de montagem (cache-hit e
   * busca fresca). Avisar só num deles faria o alerta aparecer de forma
   * intermitente — pior que não avisar, porque se aprende a não conferir.
   */
  it('sai pelo bloco de identidade, que roda nos dois caminhos', () => {
    const ident = fonte.slice(
      fonte.indexOf('function formatarIdentidade('),
      fonte.indexOf('const VIVO_TOLERANCIA_MS'),
    )
    expect(ident).toContain('avisoAgentParado()')
  })

  it('o aviso diz o que parou, não só que parou', () => {
    for (const termo of ['watcher', 'Guardian', 'invariantes', 'rayzen-start.bat']) {
      expect(fonte).toContain(termo)
    }
  })
})

/**
 * O rastro precisa ser escrito a cada tick, e independente do resultado do scan.
 *
 * Um scan que falha todo tick continua sendo um agent de pé — quem conta essa outra
 * história é o `beatGuardian({ ok:false })`. Amarrar os dois faria um watcher com
 * defeito parecer um watcher desligado, que é a ambiguidade que os dois sinais
 * existem para separar.
 */
describe('workspace-watcher — marca vida a cada tick', () => {
  const fonte = readFileSync(join(__dirname, '..', '..', 'workspace-watcher.ts'), 'utf8')

  it('chama marcarVivo fora do then/catch do scan', () => {
    const tick = fonte.slice(fonte.indexOf('const tick = ()'), fonte.indexOf('void tick()'))
    expect(tick).toContain('marcarVivo()')
    expect(tick.indexOf('marcarVivo()')).toBeLessThan(tick.indexOf('scanOnce()'))
  })
})
