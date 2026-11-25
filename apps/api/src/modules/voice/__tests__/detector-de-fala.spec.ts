/**
 * Regra do detector de fala do microfone (web), testada aqui porque a web não tem suíte e o
 * `tsc` da api não aceita importar fora de `src`: o arquivo é lido como texto e transpilado.
 * Mesmo esquema de `conversa-ciclo.spec.ts`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as assert from 'node:assert/strict'
import * as ts from 'typescript'

interface Estado { piso: number | null; pico: number; falou: boolean }
interface Passo { estado: Estado; parar: boolean; medida: { piso: number; pico: number; limiarFala: number } }
interface Detector {
  novoDetector: (agora: number) => Estado
  amostrar: (estado: Estado, rms: number, agora: number) => Passo
  SILENCIO_MS: number
  ESPERA_INICIAL_MS: number
}

function carregar(): Detector {
  const caminho = join(__dirname, '..', '..', '..', '..', '..', 'web', 'app', 'hooks', 'detectorDeFala.ts')
  const js = ts.transpileModule(readFileSync(caminho, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const modulo = { exports: {} as Detector }
  new Function('module', 'exports', js)(modulo, modulo.exports)
  return modulo.exports
}

const d = carregar()

/** Toca uma sequência de quadros de 100 ms e devolve o último passo e o instante em que parou. */
function tocar(quadros: number[]): { ultimo: Passo; paradoEm: number | null } {
  let estado = d.novoDetector(0)
  let ultimo: Passo | null = null
  for (let i = 0; i < quadros.length; i++) {
    ultimo = d.amostrar(estado, quadros[i], i * 100)
    estado = ultimo.estado
    if (ultimo.parar) return { ultimo, paradoEm: i * 100 }
  }
  return { ultimo: ultimo as Passo, paradoEm: null }
}

describe('detector de fala (web/app/hooks/detectorDeFala.ts)', () => {
  it('reconhece a voz quando a abertura do microfone é mais alta que ela (23/11, mic de mesa)', () => {
    // Abertura medida em 0,076; sala depois em ~0,015; voz chegando a 0,071.
    const abertura = [0.09, 0.08, 0.076, 0.078]
    const sala = [0.03, 0.015, 0.016, 0.015]
    const voz = [0.05, 0.071, 0.065, 0.06, 0.07]
    const { ultimo } = tocar([...abertura, ...sala, ...voz])
    assert.equal(ultimo.estado.falou, true)
    assert.ok(ultimo.medida.limiarFala < 0.071, `limiar ${ultimo.medida.limiarFala} acima da voz`)
  })

  it('o piso não sobe com a fala: falar alto não desliga o reconhecimento', () => {
    const { ultimo } = tocar([0.01, 0.01, 0.01, 0.01, 0.01, 0.2, 0.3, 0.25])
    assert.equal(ultimo.medida.piso, 0.01)
    assert.equal(ultimo.estado.falou, true)
  })

  it('fecha a fala depois de 1,5 s de silêncio', () => {
    const silencio = Array(20).fill(0.01)
    const { paradoEm } = tocar([0.01, 0.01, 0.01, 0.01, 0.01, 0.1, 0.1, 0.1, ...silencio])
    // última fala em 700 ms; silêncio começa em 800; para quando completa 1.500 ms
    assert.equal(paradoEm, 800 + d.SILENCIO_MS)
  })

  it('sem fala nenhuma, fecha na espera inicial e não marca fala', () => {
    const { ultimo, paradoEm } = tocar(Array(100).fill(0.01))
    assert.equal(paradoEm, d.ESPERA_INICIAL_MS)
    assert.equal(ultimo.estado.falou, false)
  })

  it('ruído constante não vira fala', () => {
    const { ultimo } = tocar(Array(50).fill(0.04).map((v, i) => v + (i % 3) * 0.005))
    assert.equal(ultimo.estado.falou, false)
  })

  it('silêncio digital absoluto usa o limiar mínimo, e não zero', () => {
    const { ultimo } = tocar([0, 0, 0, 0, 0, 0.005])
    assert.equal(ultimo.estado.falou, false)
    assert.equal(ultimo.medida.limiarFala, 0.02)
  })
})
