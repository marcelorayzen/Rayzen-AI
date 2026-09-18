import { ProjectStateService } from '../project-state.service'

/**
 * Síntese que não parseia NÃO é síntese vazia — é ausência de síntese.
 *
 * O `catch` deste parse era silencioso e substituía TUDO por vazio: `objective: ''`,
 * `nextSteps: []`, `milestones: []`, `backlog: []`. Como `normalizePlanningNodes([])`
 * devolve `[]` (a âncora `previous` só recunha id, não preserva item), o vazio descia
 * intacto até o `upsert` e apagava o planejamento inteiro.
 *
 * ── Como isso foi descoberto ────────────────────────────────────────────────────
 *
 * Em 2026-09-06, às 00:36, o ProjectState do Rayzen AI tinha `nextSteps`, `backlog`,
 * `milestones` e `blockers` **todos zerados** — no meio de uma sessão inteira de
 * arquitetura. A reconstrução pelo banco:
 *
 *   23/08 00:15 — último refresh do período, `nextSteps` com 4 itens
 *   23/08 → 05/09 — NENHUM refresh deste projeto (os do intervalo eram do VB Ferragens)
 *   05/09 — 7 refreshes, e as 7 sínteses gravadas mostram itens
 *   06/09 00:36 — quatro campos zerados
 *
 * O LLM produziu, o parse falhou, o vazio foi persistido. Nada deu erro, nada apareceu
 * em log, e a perda só foi notada por acaso duas semanas depois. É o modo de falha da
 * casa: tudo reporta sucesso e o dado está errado.
 *
 * A gravação em `conversation_messages` trunca em 1000 chars, então a síntese logada
 * podia parecer íntegra enquanto o texto completo estava cortado no meio — provável
 * causa do parse falhar.
 */
describe('ProjectStateService — síntese que não parseia', () => {
  const service = new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const parse = (raw: string) =>
    (service as unknown as { parseSintese: (r: string) => unknown }).parseSintese(raw)

  it('lê JSON puro', () => {
    expect(parse('{"objective":"Lançar o checkout","stage":"building"}'))
      .toMatchObject({ objective: 'Lançar o checkout' })
  })

  /** Claude não suporta `response_format: json_object` e cerca com fences às vezes. */
  it('lê JSON dentro de code fence', () => {
    expect(parse('```json\n{"objective":"Com fence"}\n```')).toMatchObject({ objective: 'Com fence' })
  })

  it('lê JSON com texto em volta', () => {
    expect(parse('Claro! Aqui está:\n{"objective":"Com prosa"}\nEspero ter ajudado.'))
      .toMatchObject({ objective: 'Com prosa' })
  })

  /**
   * O caso mais provável do incidente: resposta cortada por `max_tokens` deixa o JSON
   * sem fechar. Antes isto virava um objeto vazio que apagava o planejamento.
   */
  it('JSON truncado devolve null — e null é o ponto', () => {
    expect(parse('{"objective":"Cortado no meio","nextSteps":[{"title":"algo')).toBeNull()
  })

  it('resposta vazia devolve null', () => {
    expect(parse('')).toBeNull()
    expect(parse('   ')).toBeNull()
  })

  it('desculpa em prosa, sem JSON nenhum, devolve null', () => {
    expect(parse('Desculpe, não consegui gerar a síntese.')).toBeNull()
  })

  /**
   * `JSON.parse` NÃO lança para nenhum destes, e nenhum é uma síntese. Sem a checagem de
   * forma, um array viraria `derived` e todos os campos sairiam `undefined` — o mesmo
   * apagamento por outro caminho, com outra roupa.
   */
  it('array vazio, string e null não passam por síntese', () => {
    expect(parse('[]')).toBeNull()
    expect(parse('"apenas um texto"')).toBeNull()
    expect(parse('null')).toBeNull()
  })

  /**
   * Já um array COM um objeto dentro é extraído, e isso é deliberado: o regex procura
   * `{...}` em qualquer lugar do texto, que é a mesma tolerância que faz funcionar
   * "Claro! Aqui está: {...}". Um objeto de síntese embrulhado em array continua sendo
   * uma síntese; desistir dele seria perder informação que está ali.
   */
  it('array COM objeto dentro é extraído — a tolerância é a mesma que aceita prosa em volta', () => {
    expect(parse('[{"objective":"array"}]')).toMatchObject({ objective: 'array' })
  })

  /**
   * A garantia que fecha o buraco: o parse NUNCA devolve um objeto com os campos
   * zerados. Ou é síntese de verdade, ou é `null` para quem chama decidir.
   */
  it('nunca devolve objeto vazio — a decisão fica com quem chama', () => {
    for (const ruim of ['', '{', 'texto solto', '```json\n{ quebrado', '[]']) {
      const r = parse(ruim)
      expect(r).toBeNull()
      expect(r).not.toEqual(expect.objectContaining({ nextSteps: [] }))
    }
  })
})
