import { base32ParaBytes, hotp, verificarTotp } from '../totp'

/**
 * Vetores oficiais da RFC 6238 (apêndice B, SHA-1) — o segredo é o ASCII "12345678901234567890".
 * Se a implementação errar o truncamento ou a ordem de bytes, estes números denunciam.
 */
const SEGREDO = Buffer.from('12345678901234567890')
const SEGREDO_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('TOTP — RFC 6238', () => {
  it('base32 decodifica o segredo dos vetores', () => {
    expect(base32ParaBytes(SEGREDO_BASE32)).toEqual(SEGREDO)
  })

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('t=%i → %s (8 dígitos)', (t, esperado) => {
    expect(hotp(SEGREDO, Math.floor(t / 30), 8)).toBe(esperado)
  })

  it('aceita o código do passo atual e devolve o passo', () => {
    expect(verificarTotp(SEGREDO_BASE32, '287082', 59_000)).toBe(1)
  })

  it('tolera um passo de relógio para cada lado, não dois', () => {
    const codigoDoPasso1 = '287082' // t=59 → passo 1
    expect(verificarTotp(SEGREDO_BASE32, codigoDoPasso1, 89_000)).toBe(1) // agora no passo 2
    expect(verificarTotp(SEGREDO_BASE32, codigoDoPasso1, 119_000)).toBeNull() // passo 3
  })

  it.each(['', '12345', '1234567', 'abcdef', '28708 '])('recusa forma inválida %p sem calcular nada', (codigo) => {
    expect(verificarTotp(SEGREDO_BASE32, codigo, 59_000)).toBeNull()
  })

  it('código errado é recusado', () => {
    expect(verificarTotp(SEGREDO_BASE32, '000000', 59_000)).toBeNull()
  })
})
