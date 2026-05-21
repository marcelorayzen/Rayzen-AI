import { parseMarkdown } from '../parsers/blueprint-markdown.parser'

describe('parseMarkdown', () => {
  it('detecta seções H2 e H3', () => {
    const md = `
# Blueprint Title

## Arquitetura

Conteúdo da arquitetura aqui.

### Detalhe

Sub-detalhe.

## Implementação

Conteúdo da implementação.
`
    const result = parseMarkdown(md, 'Test Blueprint')
    expect(result.sections.map((s) => s.title)).toEqual(['Arquitetura', 'Detalhe', 'Implementação'])
    expect(result.sections[0].level).toBe(2)
    expect(result.sections[1].level).toBe(3)
  })

  it('extrai slugs válidos de títulos com acentos', () => {
    const md = `## Configuração do Banco\n\nConteúdo.`
    const result = parseMarkdown(md, 'T')
    expect(result.sections[0].slug).toBe('configuracao-do-banco')
  })

  it('detecta itens de ação como nextSteps', () => {
    const md = `
## Tarefas

- Implementar o módulo de autenticação
- Adicionar testes E2E
- Refatorar o serviço de usuários
`
    const result = parseMarkdown(md, 'T')
    expect(result.nextSteps.length).toBeGreaterThanOrEqual(2)
    expect(result.nextSteps.some((s) => s.toLowerCase().includes('implementar'))).toBe(true)
  })

  it('detecta decisões por padrão de texto', () => {
    const md = `
## Decisões

- Decidimos usar PostgreSQL para o banco principal
- Optamos pelo NestJS como framework
`
    const result = parseMarkdown(md, 'T')
    expect(result.decisions.length).toBeGreaterThanOrEqual(1)
  })

  it('detecta problemas por palavras-chave', () => {
    const md = `
## Blockers

- Blocker: autenticação OAuth não está funcionando
- Problema com a conexão ao Redis
`
    const result = parseMarkdown(md, 'T')
    expect(result.problems.length).toBeGreaterThanOrEqual(1)
  })

  it('retorna arrays vazios para conteúdo sem estrutura', () => {
    const md = `Texto simples sem headings ou listas.`
    const result = parseMarkdown(md, 'T')
    expect(result.sections).toHaveLength(0)
    expect(result.nextSteps).toHaveLength(0)
    expect(result.decisions).toHaveLength(0)
  })

  it('preserva o título passado por parâmetro', () => {
    const result = parseMarkdown('## Section\n\nConteúdo.', 'Meu Blueprint')
    expect(result.title).toBe('Meu Blueprint')
  })
})
