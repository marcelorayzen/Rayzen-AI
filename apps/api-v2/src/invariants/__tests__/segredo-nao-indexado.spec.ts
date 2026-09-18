import { InvariantsService } from '../invariants.service'

/**
 * O invariante que nasceu de um vazamento medido.
 *
 * Em 2026-09-10 o `hook.config.mjs` — que guarda o `AGENT_TOKEN` — estava indexado no
 * Brain, e a busca semântica o serviu **com o JWT completo em texto claro** dentro do
 * `memory_relevant` de uma sessão real. O arquivo tinha sido fechado por ACL no dia
 * anterior; proteger o objeto não protege a cópia que já saiu dele.
 *
 * Nenhum sensor existente respondia essa pergunta: `pnpm scan:secrets` audita o que está
 * VERSIONADO (o `.env` é gitignored e passa limpo) e o check de ACL audita quem PODE LER
 * o arquivo (o Brain não é arquivo).
 */
describe('InvariantsService — segredo_nao_indexado', () => {
  type Doc = { id: string; projectId: string | null; sourcePath: string | null }

  function build(caminhos: Doc[], erro?: Error) {
    const bridge = {
      listarCaminhosIndexados: erro
        ? jest.fn().mockRejectedValue(erro)
        : jest.fn().mockResolvedValue(caminhos),
    }
    const service = new InvariantsService({} as never, bridge as never, {} as never, {} as never)
    const rodar = () => (service as unknown as {
      segredoNaoIndexado: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).segredoNaoIndexado()
    return { rodar, bridge }
  }

  const doc = (sourcePath: string | null, id = 'd1'): Doc => ({ id, projectId: 'p1', sourcePath })

  it('vermelho com o hook.config.mjs indexado — o caso real de 10/09', async () => {
    const r = await build([
      doc('c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\apps\\agent\\src\\hooks\\hook.config.mjs'),
      doc('CLAUDE.md', 'd2'),
    ]).rodar()

    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('1 de 2')
    expect(r.detalhe).toContain('hook.config.mjs')
  })

  it('a correção manda ROTACIONAR, não só apagar', async () => {
    const r = await build([doc('apps/api/.env')]).rodar()

    expect(r.ok).toBe(false)
    // Apagar o documento não desfaz o que já foi servido em contexto injetado.
    expect(r.correcao).toMatch(/ROTACIONAR/)
    expect(r.correcao).toMatch(/example/i)
  })

  it('verde quando nenhum caminho aparenta credencial', async () => {
    const r = await build([
      doc('apps/api/src/modules/memory/memory.service.ts'),
      doc('CLAUDE.md', 'd2'),
      doc('package.json', 'd3'),
    ]).rodar()

    expect(r.ok).toBe(true)
    expect(r.detalhe).toContain('3 caminhos')
  })

  /**
   * Os dois `.example` foram PRESERVADOS quando os dois reais foram apagados: template
   * versionado é o que ensina o formato a quem chega, e não carrega segredo.
   */
  it('template .example não derruba o check', async () => {
    const r = await build([
      doc('apps/agent/src/hooks/hook.config.example.mjs'),
      doc('.env.example', 'd2'),
    ]).rodar()

    expect(r.ok).toBe(true)
  })

  it('acervo vazio é verde', async () => {
    const r = await build([]).rodar()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Nenhum documento/)
  })

  /**
   * Não conseguir LER o acervo não é o mesmo que o acervo estar limpo — mesma distinção
   * estrutural de `modelos_llm_respondem` e `historico_serve_conversa`.
   */
  it('falha ao ler o acervo é INCONCLUSIVA, não verde silencioso', async () => {
    const r = await build([], new Error('sem banco')).rodar()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Inconclusivo/)
  })

  /**
   * O sensor não precisa ver o que denuncia. Carregar `content` espalharia o segredo por
   * mais um processo, mais um log e mais uma mensagem de erro.
   */
  it('pede o acervo INTEIRO, sem escopo de projeto', async () => {
    const { rodar, bridge } = build([doc('CLAUDE.md')])
    await rodar()
    expect(bridge.listarCaminhosIndexados).toHaveBeenCalledWith()
  })
})
