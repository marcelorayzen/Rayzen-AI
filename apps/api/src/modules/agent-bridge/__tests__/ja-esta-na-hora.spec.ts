import { jaEstaNaHora } from '../agent-bridge.service'

/**
 * ── O filtro sem o qual "depois" vira "agora" ────────────────────────────────
 *
 * `claimTask` lê `getJobs(['waiting', 'delayed'])`. O `delayed` está lá desde que o claim foi
 * escrito, sem comentário explicando por quê — e ninguém notou porque **nada criava job com
 * atraso**: esta fila não tem worker Bull (`queue.process` não existe), então `attempts`/`backoff`
 * nunca entram em cena e o estado `delayed` simplesmente não acontecia.
 *
 * Medido em 17/09, contra o Redis real:
 *
 *     ja     estado=delayed  delay=2000    naHora=true    ← 4s depois: pronto
 *     longe  estado=delayed  delay=600000  naHora=false   ← ainda não
 *     sem    estado=waiting  delay=0       naHora=true
 *
 * ── E por que não basta tirar `delayed` da lista ─────────────────────────────
 *
 * Porque **sem worker o Bull não promove `delayed` → `waiting`**. Medido: job com 3s de atraso
 * seguia `delayed` sete segundos depois. Tirar da lista trocaria "executa antes da hora" por
 * "nunca executa" — a armadilha oposta, e mais silenciosa, porque um agendamento que não dispara
 * não deixa rastro nenhum.
 *
 * Quem acorda o job é o poller do agent a cada 3s, então a granularidade real do agendamento é o
 * intervalo de polling — não o milissegundo.
 */
describe('jaEstaNaHora', () => {
  const agora = Date.now()

  it('job sem atraso está sempre pronto', () => {
    expect(jaEstaNaHora({ timestamp: agora, opts: {} })).toBe(true)
    expect(jaEstaNaHora({ timestamp: agora })).toBe(true)
    expect(jaEstaNaHora({})).toBe(true)
  })

  it('job cujo atraso ainda não passou NÃO está pronto', () => {
    expect(jaEstaNaHora({ timestamp: agora, opts: { delay: 600_000 } })).toBe(false)
  })

  it('job cujo atraso já passou está pronto', () => {
    expect(jaEstaNaHora({ timestamp: agora - 10_000, opts: { delay: 2_000 } })).toBe(true)
  })

  /** A fronteira exata: no instante em que a hora chega, é reivindicável. */
  it('no instante exato do vencimento já conta como pronto', () => {
    expect(jaEstaNaHora({ timestamp: agora - 5_000, opts: { delay: 5_000 } })).toBe(true)
  })

  /**
   * Atraso zero ou ausente são o caso comum (toda tarefa imediata). Tratar `0` como "tem atraso"
   * faria a conta de vencimento rodar à toa em cada job da fila.
   */
  it('atraso zero é tratado como ausência de atraso', () => {
    expect(jaEstaNaHora({ timestamp: agora, opts: { delay: 0 } })).toBe(true)
  })
})
