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

  /**
   * O parser afirmava que "não decidido" é uma decisão.
   *
   * `/\bdecidi(do|mos|u)\b/i` casa DENTRO de "não decidido", e o item virava um evento
   * `type: 'decision'` com o texto literal — afirmando que há decisão exatamente onde o
   * texto diz o contrário. Mesmo problema em `/\baprovado\b/i` com "não aprovado".
   *
   * Pego em 2026-08-18 ao importar `blueprints/025-hud-mission-control.md`, cujas duas
   * únicas linhas casadas eram negadas. Nada chegou ao banco, mas chegaria — e decisão
   * fantasma é permanente na timeline do projeto, com a mesma forma de uma real.
   */
  describe('negação — o oposto de uma decisão não é uma decisão', () => {
    const decisoesDe = (md: string) => parseMarkdown(md, 'T').decisions

    it.each([
      '- Biblioteca de estado no frontend — não decidido',
      '- Layout do painel expandido: centralizado ou ao lado — nao decidido',
      '- O mecanismo de auth ainda não foi decidido',
      '- O deploy não foi aprovado',
      '- Nunca decidimos qual fila usar',
      '- Sem ADR até hoje',
    ])('não trata como decisão: %s', (linha) => {
      expect(decisoesDe(`## Em aberto\n\n${linha}\n`)).toHaveLength(0)
    })

    it.each([
      '- Decidimos usar PostgreSQL para o banco principal',
      '- Optamos pelo NestJS como framework',
      '- Escolhemos Fastify em vez de Express',
      '- ADR-003 registra a troca do adapter',
    ])('continua detectando decisão real: %s', (linha) => {
      expect(decisoesDe(`## Decisões\n\n${linha}\n`)).toHaveLength(1)
    })

    /**
     * A negação só vale ANTES do verbo. Decisão de verdade frequentemente explica o que
     * NÃO deve acontecer — condenar a linha inteira perderia justamente as mais ricas.
     */
    it('negação DEPOIS do verbo não desqualifica — é justificativa, não negação', () => {
      const md = '## Decisões\n\n- Decidimos manter onDelete SetNull porque apagar projeto não deve apagar o registro\n'

      expect(decisoesDe(md)).toHaveLength(1)
    })

    it('negação distante não alcança o verbo', () => {
      // "não" a mais de 40 chars do padrão pertence a outra oração.
      const md = '## Decisões\n\n- O time não tinha visibilidade nenhuma sobre custo de LLM antes disso, e por causa disso adotamos o Langfuse\n'

      expect(decisoesDe(md)).toHaveLength(1)
    })

    it('não rouba o item da lista de problemas', () => {
      // `PROBLEM_PATTERNS` usa `/\bnão funciona\b/` de propósito — o guard de negação
      // não pode interferir na classificação de problema.
      const r = parseMarkdown('## Blockers\n\n- Blocker: autenticação OAuth não está funcionando\n', 'T')

      expect(r.problems).toHaveLength(1)
      expect(r.decisions).toHaveLength(0)
    })
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
