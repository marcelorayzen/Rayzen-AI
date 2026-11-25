import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ehSondaDeSensor, FORA_AS_SONDAS, PREFIXO_SONDA, SESSAO_SONDA_EMBEDDINGS,
} from '../sonda-de-sensor.const'

/**
 * ── O defeito de 19/08, recriado em 17/09 por quem já sabia a lição ─────────
 *
 * O invariante `embeddings_respondem` sonda `POST /memory/search`, e essa rota **persiste toda
 * busca** como par `user`/`assistant`. Sem `sessionId`, cada sonda criava uma sessão: 55 num dia,
 * e **20 de 20 entradas do histórico** viraram "sonda de embeddings".
 *
 * Pior: o invariante que existe para pegar isso (`historico_serve_conversa`) ficou **verde**,
 * porque procurava o título genérico "Conversa" — a string do defeito anterior.
 */

describe('ehSondaDeSensor', () => {
  it('reconhece a sonda pelo prefixo declarado', () => {
    expect(ehSondaDeSensor(SESSAO_SONDA_EMBEDDINGS)).toBe(true)
    expect(ehSondaDeSensor(`${PREFIXO_SONDA}qualquer-outra`)).toBe(true)
  })

  it('conversa de verdade não é sonda', () => {
    expect(ehSondaDeSensor('92847a8c-6a8f-44e7-a0b1-ad5177f6e5fd')).toBe(false)
    expect(ehSondaDeSensor('brain-123')).toBe(false)
  })

  it('ausente não é sonda', () => {
    expect(ehSondaDeSensor(null)).toBe(false)
    expect(ehSondaDeSensor(undefined)).toBe(false)
  })

  /** O prefixo literal aparece em dois lugares; divergir é como um filtro deixa de filtrar. */
  it('o filtro do Prisma usa o mesmo prefixo da função', () => {
    expect(FORA_AS_SONDAS.sessionId.not.startsWith).toBe(PREFIXO_SONDA)
  })
})

/**
 * ── Anti-drift entre apps: a sonda vive na V2, o prefixo na V1 ──────────────
 *
 * A sonda declara o id em `apps/api-v2`; quem o interpreta é `apps/api`. Não há import possível
 * entre as duas (`@rayzen/types` não é compilado), então o acordo é textual — e sem este teste ele
 * é acordo de cavalheiros: mudar o prefixo de um lado deixaria o outro filtrando nada, **em
 * silêncio**, que é exatamente como o defeito nasceu.
 */
describe('a sonda da V2 usa o prefixo que a V1 reconhece', () => {
  const invariants = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'api-v2', 'src', 'invariants', 'invariants.service.ts'),
    'utf8',
  )

  it('a sonda de embeddings manda um sessionId fixo e com o prefixo', () => {
    expect(invariants).toMatch(/sessionId:\s*'sonda:embeddings'/)
  })

  it('e esse id é exatamente o que a V1 declara', () => {
    expect(SESSAO_SONDA_EMBEDDINGS).toBe('sonda:embeddings')
    expect(ehSondaDeSensor('sonda:embeddings')).toBe(true)
  })
})

/**
 * ── O sensor precisa medir a PROPRIEDADE, não a string de ontem ────────────
 *
 * `historico_serve_conversa` contava títulos iguais a "Conversa". Com vinte linhas "sonda de
 * embeddings" ele respondeu "20 das 20 são conversa real". O que define telemetria não é o texto,
 * é a repetição.
 */
describe('o invariante do histórico mede variedade de título', () => {
  const invariants = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'api-v2', 'src', 'invariants', 'invariants.service.ts'),
    'utf8',
  )

  it('conta títulos distintos, não só o fallback', () => {
    expect(invariants).toMatch(/const distintos = new Set\(titulos\)\.size/)
    expect(invariants).toMatch(/distintos === 1 && servidas\.length > 2/)
  })

  /** Histórico curto com um título só é instalação nova, não defeito. */
  it('exige mais de duas entradas antes de reprovar por título único', () => {
    expect(invariants).toMatch(/servidas\.length > 2/)
  })
})
