import { aboveThreshold } from '../embedding-match.util'

describe('aboveThreshold', () => {
  it('mantém só as linhas com score >= limiar', () => {
    const rows = [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.3 }, { id: 'c', score: 0.5 }]
    expect(aboveThreshold(rows, 0.5)).toEqual([{ id: 'a', score: 0.8 }, { id: 'c', score: 0.5 }])
  })

  it('lista vazia quando nada bate o limiar — mesma semântica de "zero hits" do substring', () => {
    const rows = [{ id: 'a', score: 0.1 }, { id: 'b', score: 0.2 }]
    expect(aboveThreshold(rows, 0.5)).toEqual([])
  })

  it('aceita score como string (Postgres numeric via $queryRaw às vezes vem como string)', () => {
    const rows = [{ id: 'a', score: '0.6' }]
    expect(aboveThreshold(rows, 0.5)).toEqual([{ id: 'a', score: '0.6' }])
  })
})
