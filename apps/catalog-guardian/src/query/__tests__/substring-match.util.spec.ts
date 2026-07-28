import { tokenizeQuestion, topMatchesBySubstring } from '../substring-match.util'

describe('tokenizeQuestion', () => {
  it('remove acentos, pontuação colada e palavras curtas', () => {
    expect(tokenizeQuestion('Quem é o owner da tabela de pedidos?')).toEqual(['quem', 'owner', 'tabela', 'pedidos'])
  })

  it('funciona sem acentos (pergunta pode vir sem eles)', () => {
    expect(tokenizeQuestion('qual a diferenca entre cliente_ativo e cliente_vigente?')).toEqual(
      expect.arrayContaining(['diferenca', 'entre', 'cliente_ativo', 'cliente_vigente']),
    )
  })

  it('retorna vazio quando não há palavra com mais de 3 letras', () => {
    expect(tokenizeQuestion('e ai tu')).toEqual([])
  })

  it('com minLength menor, mantém siglas de 3 letras (PMR, CPF...)', () => {
    expect(tokenizeQuestion('o que quer dizer PMR nas tabelas de crédito?', 3)).toEqual(
      expect.arrayContaining(['pmr']),
    )
    expect(tokenizeQuestion('o que quer dizer PMR nas tabelas de crédito?')).not.toEqual(
      expect.arrayContaining(['pmr']),
    )
  })
})

describe('topMatchesBySubstring', () => {
  interface Item {
    name: string
    description: string
  }

  const items: Item[] = [
    { name: 'pedidos', description: 'Pedidos de venda consolidados' },
    { name: 'estoque', description: 'Movimentacao de estoque por produto' },
    { name: 'clientes', description: 'Cadastro de clientes ativos' },
  ]

  it('retorna só os itens com pelo menos um hit, ordenados por relevância', () => {
    const words = tokenizeQuestion('quais tabelas tem informacao de clientes?')
    const result = topMatchesBySubstring(items, words, (i) => `${i.name} ${i.description}`)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('clientes')
  })

  it('retorna vazio quando nenhuma palavra bate', () => {
    const words = tokenizeQuestion('existe informacao sobre logistica?')
    const result = topMatchesBySubstring(items, words, (i) => `${i.name} ${i.description}`)
    expect(result).toEqual([])
  })

  it('respeita o limite informado', () => {
    const words = ['de']
    const result = topMatchesBySubstring(items, words, (i) => `${i.name} ${i.description}`, 2)
    expect(result.length).toBeLessThanOrEqual(2)
  })
})
