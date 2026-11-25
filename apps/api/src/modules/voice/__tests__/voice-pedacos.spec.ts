import { limparParaFala, pedacosParaFala, TETO_DO_PEDACO } from '../voice-pedacos'

/**
 * A resposta abaixo tem a forma real de uma resposta do Hub (22/11, projeto do desafio): parágrafos,
 * negrito, lista numerada, código inline, link e o tamanho da mediana (~1.100 caracteres). O teste
 * importante é o de conteúdo: quebrar não pode perder nem trocar a ordem de nenhuma palavra.
 */
const RESPOSTA_DO_HUB = `Entendido — o PDF é o **piso**, não a régua. Isso muda o que eu comparo: os oito entregáveis da seção 6 e o JSON exportado do \`n8n\` entram como mínimo obrigatório, não como cuidado extra.

O que nos faz entregar acima do básico já está no DoD do projeto:
1. fluxo ponta a ponta realmente rodando;
2. testes automatizados passando;
- a demonstração gravada, como pede a [seção 7](https://exemplo/secao-7).

O PDF não pede teste nenhum — isso é escolha nossa, e é o tipo de coisa que a banca nota. Fica uma pergunta em aberto que define o desenho antes de eu mexer em qualquer coisa: quem grava na planilha, a API ou o node Google Sheets do n8n? É ela que decide quantos nodes o fluxo tem e, portanto, quantos prints de configuração a seção 7 vai exigir. Se quiser, proponho este PDF para a memória do projeto — ele está justamente listado como lacuna de documentação, e guardar agora evita procurar o arquivo de novo na próxima conversa.`

const palavras = (s: string) => s.split(/\s+/).filter(Boolean)

describe('limparParaFala', () => {
  it('tira markdown, marcadores de lista, link e código, e mantém o texto', () => {
    const limpo = limparParaFala(RESPOSTA_DO_HUB)
    expect(limpo).not.toMatch(/\*\*|`|\]\(|^\s*\d+\.\s/m)
    expect(limpo).not.toMatch(/^\s*-\s/m)
    expect(limpo).toContain('o PDF é o piso, não a régua')
    expect(limpo).toContain('como pede a seção 7.')
    expect(limpo).toContain('fluxo ponta a ponta realmente rodando;')
  })

  it('tira os marcadores internos de pendência e o bloco de código', () => {
    const limpo = limparParaFala('Feito.\n[DOC_PENDING:YWJj]\n```ts\nconst x = 1\n```\nPronto.')
    expect(limpo).toBe('Feito.\n\nPronto.')
  })

  it('transforma tabela em texto corrido, sem a linha de traços', () => {
    const limpo = limparParaFala('| nome | valor |\n|---|---|\n| teto | 350 |')
    expect(limpo).not.toContain('---')
    expect(limpo).not.toContain('|')
    expect(limpo).toContain('teto')
  })
})

describe('pedacosParaFala', () => {
  it('nenhum pedaço passa do teto, e a resposta mediana vira mais de um pedaço', () => {
    const pedacos = pedacosParaFala(RESPOSTA_DO_HUB)
    expect(pedacos.length).toBeGreaterThan(2)
    for (const p of pedacos) expect(p.length).toBeLessThanOrEqual(TETO_DO_PEDACO)
  })

  it('não perde, não duplica e não reordena nenhuma palavra', () => {
    const pedacos = pedacosParaFala(RESPOSTA_DO_HUB)
    expect(palavras(pedacos.join(' '))).toEqual(palavras(limparParaFala(RESPOSTA_DO_HUB)))
  })

  it('corta em fim de frase: todo pedaço, menos talvez o último, termina em pontuação', () => {
    const pedacos = pedacosParaFala(RESPOSTA_DO_HUB)
    for (const p of pedacos.slice(0, -1)) expect(p).toMatch(/[.!?…;:]$/)
  })

  it('junta frases curtas no mesmo pedaço em vez de uma chamada por frase', () => {
    expect(pedacosParaFala('Sim. Pode ser. Faço agora.')).toEqual(['Sim. Pode ser. Faço agora.'])
  })

  it('frase sem ponto maior que o teto é partida em vírgula, sem cortar palavra', () => {
    const frase = Array.from({ length: 40 }, (_, i) => `item número ${i}`).join(', ')
    const pedacos = pedacosParaFala(frase)
    expect(pedacos.length).toBeGreaterThan(1)
    for (const p of pedacos) expect(p.length).toBeLessThanOrEqual(TETO_DO_PEDACO)
    expect(palavras(pedacos.join(' '))).toEqual(palavras(frase))
  })

  it('texto vazio ou só markdown não vira pedaço', () => {
    expect(pedacosParaFala('')).toEqual([])
    expect(pedacosParaFala('```\ncodigo\n```')).toEqual([])
  })
})
