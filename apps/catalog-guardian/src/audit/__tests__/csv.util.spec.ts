import { toCsv } from '../csv.util'

describe('toCsv', () => {
  it('gera cabeçalho e linhas simples sem escaping', () => {
    const rows = [{ id: '1', name: 'pedidos' }]
    const csv = toCsv(rows, [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Nome' },
    ])
    expect(csv).toBe('ID,Nome\r\n1,pedidos')
  })

  it('escapa campo com vírgula entre aspas', () => {
    const rows = [{ text: 'a, b, c' }]
    const csv = toCsv(rows, [{ key: 'text', header: 'Texto' }])
    expect(csv).toBe('Texto\r\n"a, b, c"')
  })

  it('escapa aspas duplicando-as', () => {
    const rows = [{ text: 'ele disse "oi"' }]
    const csv = toCsv(rows, [{ key: 'text', header: 'Texto' }])
    expect(csv).toBe('Texto\r\n"ele disse ""oi"""')
  })

  it('escapa quebra de linha dentro do campo', () => {
    const rows = [{ text: 'linha 1\nlinha 2' }]
    const csv = toCsv(rows, [{ key: 'text', header: 'Texto' }])
    expect(csv).toBe('Texto\r\n"linha 1\nlinha 2"')
  })

  it('trata null/undefined como campo vazio', () => {
    const rows = [{ value: null as unknown as string }]
    const csv = toCsv(rows, [{ key: 'value', header: 'Valor' }])
    expect(csv).toBe('Valor\r\n')
  })

  it('aceita coluna derivada via função (join de flags, por exemplo)', () => {
    const rows = [{ id: '1', flags: [{ reason: 'a' }, { reason: 'b' }] }]
    const csv = toCsv(rows, [
      { key: 'id', header: 'ID' },
      { key: (r) => r.flags.map((f) => f.reason).join(';'), header: 'Flags' },
    ])
    expect(csv).toBe('ID,Flags\r\n1,a;b')
  })
})
