import { InvariantsService } from '../invariants.service'

/**
 * ── Embeddings não são LLM, e o check de LLM não os cobre ───────────────────
 *
 * Em 17/09 a conta da Jina ficou sem saldo: `HTTP 403 AUTHZ_INSUFFICIENT_BALANCE`. Embeddings
 * alimentam indexação **e** busca, então a memória semântica inteira saiu do ar — `/memory/search`
 * passou a devolver 500, o `memory_relevant` sumiu do contexto e o context-engine da V2 começou a
 * falhar.
 *
 * **Nada acusou.** Foi descoberto por acaso, investigando um deploy que falhara por outro motivo
 * no dia anterior — exatamente a história que criou o `modelos_llm_respondem` quando a Groq
 * descontinuou dois modelos e toda chamada virou 500 com o painel verde.
 *
 * E aquele check não bastaria: LLM e embeddings são **provedor diferente, conta diferente, saldo
 * diferente**. No dia do incidente o LiteLLM estava de pé e a Jina no chão — um verde, o outro
 * vermelho, e só o segundo importava para a memória.
 *
 * Sonda `POST /memory/search` da V1, não a Jina direto: testa embed + pgvector, que é o caminho
 * que o usuário usa, e não exige a chave da Jina dentro da api-v2.
 */
describe('embeddings_respondem', () => {
  const fetchOriginal = global.fetch

  function checar(responder: () => Promise<Response> | Response) {
    global.fetch = jest.fn().mockImplementation(responder) as never
    const service = new InvariantsService({} as never, {} as never, {} as never, {} as never)
    // O cache é estático e compartilhado entre projetos do mesmo ciclo — limpo entre casos,
    // senão o primeiro veredito responderia por todos os testes seguintes.
    ;(InvariantsService as unknown as { cacheEmbeddings: unknown }).cacheEmbeddings = null
    return (service as unknown as {
      embeddingsRespondem: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).embeddingsRespondem()
  }

  afterEach(() => {
    global.fetch = fetchOriginal
    ;(InvariantsService as unknown as { cacheEmbeddings: unknown }).cacheEmbeddings = null
  })

  it('busca respondendo é verde', async () => {
    const r = await checar(() => ({ ok: true, status: 200 }) as Response)
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/embeddings de p[ée]/i)
  })

  /** O caso real: Jina sem saldo faz a V1 devolver 500. */
  it('500 na busca é FALHA, e o detalhe diz o que parou', async () => {
    const r = await checar(() => ({ ok: false, status: 500 }) as Response)
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('500')
    expect(r.detalhe).toMatch(/buscar nem indexar/i)
  })

  /** Quem lê a correção precisa saber onde olhar, e que não é o mesmo lugar do LLM. */
  it('a correção aponta a conta da Jina e separa de LLM', async () => {
    const r = await checar(() => ({ ok: false, status: 500 }) as Response)
    expect(r.correcao).toMatch(/JINA_API_KEY/)
    expect(r.correcao).toMatch(/AUTHZ_INSUFFICIENT_BALANCE/)
    expect(r.correcao).toMatch(/contas diferentes/i)
  })

  /**
   * Sem status HTTP não houve resposta do provedor: quem não respondeu foi a rede local até a api
   * V1. Mesma distinção estrutural de `modelos_llm_respondem` — houve status?
   */
  it('erro de rede é INCONCLUSIVO, não falha', async () => {
    const r = await checar(() => Promise.reject(new Error('ECONNREFUSED')))
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/inconclusivo/i)
  })

  /**
   * O ciclo varre até 10 projetos por rodada e a pergunta não é por projeto. Sem cache seriam 10
   * chamadas de embedding a cada 30min — e sensor caro é sensor que alguém desliga.
   */
  it('o cache evita repetir a sonda no mesmo ciclo', async () => {
    const espiao = jest.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    global.fetch = espiao as never
    ;(InvariantsService as unknown as { cacheEmbeddings: unknown }).cacheEmbeddings = null

    const service = new InvariantsService({} as never, {} as never, {} as never, {} as never)
    const rodar = () => (service as unknown as {
      embeddingsRespondem: () => Promise<{ ok: boolean }>
    }).embeddingsRespondem()

    await rodar()
    await rodar()
    await rodar()

    expect(espiao).toHaveBeenCalledTimes(1)
  })
})
