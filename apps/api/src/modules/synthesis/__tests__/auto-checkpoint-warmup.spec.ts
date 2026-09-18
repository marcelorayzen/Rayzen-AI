import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * ── Alerta que grita à toa é como o alerta deixa de ser lido ────────────────
 *
 * Achado no teste controlado de queda da V1 (18/09): junto com o alerta legítimo da api chegou um
 * de `auto-checkpoint`, um ciclo que estava perfeitamente vivo.
 *
 * A causa é aritmética. Este ciclo usava `setInterval` **sem execução imediata**, então o primeiro
 * batimento depois de um restart só saía 10 minutos depois. O `panorama` considera o ciclo
 * atrasado com `beatEveryMs + graceMs` = 20 min contados do ÚLTIMO batimento — e um restart no fim
 * da janela de 10 min joga o próximo para além do limite.
 *
 * **Todo deploy recria este container.** Sem o warmup seriam duas mensagens espúrias por deploy
 * (a falsa quebra e a falsa recuperação), poluindo o canal que existe para avisar de queda real.
 *
 * O teste lê o arquivo como texto, como `hook-signal-quality.spec.ts` e `notificar-transicao`:
 * instanciar o service dispararia os timers de verdade dentro da suíte.
 */
describe('o auto-checkpoint reporta que está vivo logo após subir', () => {
  const fonte = readFileSync(join(__dirname, '..', 'smart-checkpoint.service.ts'), 'utf8')

  it('roda uma vez no warmup, além do intervalo', () => {
    expect(fonte).toMatch(/setTimeout\(\(\) => void this\.checkAll\(\)/)
    expect(fonte).toMatch(/setInterval\(\(\) => this\.checkAll\(\)/)
  })

  /**
   * O warmup tem de ser bem menor que a folga do componente no catálogo da V2
   * (`beatEveryMs + graceMs` = 20 min), senão ele não resolve nada.
   */
  it('o warmup é curto o bastante para caber com folga no limite de atraso', () => {
    const m = fonte.match(/const WARMUP_MS = ([\d_]+)/)
    expect(m).not.toBeNull()
    const warmupMs = Number(m![1].replace(/_/g, ''))
    expect(warmupMs).toBeLessThan(5 * 60_000)
  })

  /** Continua desligável por env — a regra vale para todo ciclo desta casa. */
  it('segue desligável por env', () => {
    expect(fonte).toMatch(/SMART_CHECKPOINT_ENABLED === 'false'/)
  })
})
