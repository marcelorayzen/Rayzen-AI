import {
  blocoDeServicos, blocoDeCiclos, blocoDeInvariantes, estadoGeral, montarPanorama,
  type RespostaV1, type CicloBruto, type LeituraDeProjeto,
} from '../panorama.const'

/**
 * ── O que este painel promete, e o que ele tem de nunca fazer ───────────────
 *
 * Pedido de 17/09: visão no HUB para quando algum serviço cair. A única forma de um painel de
 * saúde ser pior que nenhum é **afirmar saúde sobre o que não mediu** — daí metade destes testes
 * ser sobre `desconhecido` não virar `ok`.
 */

const saudavel = (): RespostaV1 => ({
  tipo:  'respondeu',
  corpo: {
    ok: true,
    services: {
      postgres: { ok: true }, redis: { ok: true }, litellm: { ok: true },
      api_v2: { ok: true }, mcp: { ok: true }, hook_jwt: { ok: true }, agent_desktop: { ok: true },
    },
  },
})

const ciclo = (id: string, estado: string, lastError: string | null = null): CicloBruto =>
  ({ id, titulo: `titulo de ${id}`, estado, lastError })

const leitura = (
  idadeH: number,
  resultados: { id: string; ok: boolean; gravidade: string }[],
): LeituraDeProjeto => ({
  projectId:  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  idadeH,
  resultados: resultados.map((r) => ({ ...r, titulo: `titulo de ${r.id}`, detalhe: `detalhe de ${r.id}` })),
})

describe('blocoDeServicos — a V1 é medida, não é a medidora', () => {
  it('V1 viva e tudo ok: conta a si mesma entre os serviços', () => {
    const b = blocoDeServicos(saudavel())
    expect(b.estado).toBe('ok')
    expect(b.total).toBe(8)   // 7 da V1 + a própria V1
    expect(b.ok).toBe(8)
    expect(b.porque).toBeUndefined()
  })

  it('serviço caído entra como problema com o erro da V1', () => {
    const r = saudavel() as Extract<RespostaV1, { tipo: 'respondeu' }>
    r.corpo.services.redis = { ok: false, error: 'desconectado' }
    const b = blocoDeServicos(r)
    expect(b.estado).toBe('quebrado')
    expect(b.problemas.map((p) => p.id)).toEqual(['redis'])
    expect(b.problemas[0].detalhe).toBe('desconectado')
  })

  /**
   * O caso que o painel existe para cobrir. Chamar o bloco de `desconhecido` aqui esconderia o
   * achado mais importante que a sonda produziu: tentamos falar com a V1 e não deu.
   */
  it('V1 sem resposta é PROBLEMA, não incógnita — e declara o que ficou sem medir', () => {
    const b = blocoDeServicos({ tipo: 'semResposta', erro: 'ECONNREFUSED' })
    expect(b.estado).toBe('quebrado')
    expect(b.problemas.map((p) => p.id)).toEqual(['api_v1'])
    expect(b.problemas[0].detalhe).toContain('ECONNREFUSED')
    expect(b.porque).toMatch(/sem medição/)
  })

  /** A distinção é estrutural (houve status?), nunca por texto de erro — como na sonda de LLM. */
  it('status HTTP ruim é distinguido de silêncio', () => {
    const b = blocoDeServicos({ tipo: 'statusRuim', status: 503 })
    expect(b.problemas[0].detalhe).toBe('respondeu HTTP 503')
  })
})

/**
 * ── O HUB entrou como serviço medido no dia em que virou porta de entrada ──
 *
 * Construir vigilância e deixar de fora justamente a coisa nova é o modo de falha desta casa —
 * e eu quase o repeti: o alerta de queda da V1 ficou pronto de manhã e o `hermes serve` subiu
 * público à tarde, sem observador nenhum.
 */
describe('blocoDeServicos com serviços sondados aqui', () => {
  const hubOk = { id: 'hub', titulo: 'O HUB (Hermes) responde', ok: true }
  const hubFora = { id: 'hub', titulo: 'O HUB (Hermes) responde', ok: false, erro: 'não respondeu (timeout)' }

  it('o HUB entra na contagem quando está de pé', () => {
    const b = blocoDeServicos(saudavel(), [hubOk])
    expect(b.estado).toBe('ok')
    expect(b.total).toBe(9)   // 7 da V1 + a própria V1 + o HUB
    expect(b.ok).toBe(9)
  })

  it('HUB fora derruba o bloco', () => {
    const b = blocoDeServicos(saudavel(), [hubFora])
    expect(b.estado).toBe('quebrado')
    expect(b.problemas.map((p) => p.id)).toEqual(['hub'])
  })

  /**
   * O caso que justifica sondar o HUB **daqui** e não pela V1: com a V1 muda, saber se a porta de
   * entrada continua de pé é justamente o que mais importa. Se a sonda dele dependesse da V1,
   * as duas cairiam juntas e o painel ficaria cego no pior momento.
   */
  it('com a V1 muda, o HUB continua medido', () => {
    const b = blocoDeServicos({ tipo: 'semResposta', erro: 'ECONNREFUSED' }, [hubOk])
    expect(b.problemas.map((p) => p.id)).toEqual(['api_v1'])
    expect(b.ok).toBe(1)      // o HUB, que respondeu
    expect(b.total).toBe(2)   // api_v1 + hub
  })

  it('V1 muda e HUB fora: os dois aparecem', () => {
    const b = blocoDeServicos({ tipo: 'semResposta', erro: 'x' }, [hubFora])
    expect(b.problemas.map((p) => p.id).sort()).toEqual(['api_v1', 'hub'])
    expect(b.ok).toBe(0)
  })
})

describe('blocoDeCiclos', () => {
  it('só o que não está saudável entra', () => {
    const b = blocoDeCiclos([ciclo('a', 'saudavel'), ciclo('b', 'falhando', 'boom')], true)
    expect(b.problemas.map((p) => p.id)).toEqual(['b'])
    expect(b.ok).toBe(1)
    expect(b.total).toBe(2)
  })

  /**
   * `status()` engole erro do Prisma e devolve `[]`; como a montagem itera o CATÁLOGO, banco fora
   * viraria "os 7 ciclos nunca subiram" — 7 falhas inventadas escondendo a única real.
   */
  it('banco fora não vira sete ciclos parados: vira desconhecido', () => {
    const b = blocoDeCiclos([], false)
    expect(b.estado).toBe('desconhecido')
    expect(b.problemas).toEqual([])
    expect(b.porque).toMatch(/banco da V2/)
  })

  it('nunca-subiu conta como problema, com gravidade menor', () => {
    const b = blocoDeCiclos([ciclo('guardian', 'nunca-subiu')], true)
    expect(b.estado).toBe('quebrado')
    expect(b.problemas[0].gravidade).toBe('baixa')
  })
})

describe('blocoDeInvariantes', () => {
  it('tudo ok e leitura fresca', () => {
    const b = blocoDeInvariantes([leitura(0.5, [{ id: 'disco', ok: true, gravidade: 'alta' }])], 6)
    expect(b.estado).toBe('ok')
    expect(b.ok).toBe(1)
    expect(b.idadeH).toBe(0.5)
  })

  /**
   * O erro do `updatedAt` como sinal de idade, aplicado aqui: uma data atestando frescor que o
   * conteúdo não tem. O ciclo grava a cada 6h, então acima disso o relatório não descreve o agora.
   */
  it('leitura velha NÃO vira ok — vira desconhecido, dizendo a idade', () => {
    const b = blocoDeInvariantes([leitura(9, [{ id: 'disco', ok: true, gravidade: 'alta' }])], 6)
    expect(b.estado).toBe('desconhecido')
    expect(b.idadeH).toBe(9)
    expect(b.porque).toMatch(/9\.0h/)
  })

  it('sem relatório nenhum é desconhecido, nunca ok', () => {
    expect(blocoDeInvariantes([], 6).estado).toBe('desconhecido')
  })

  /** `registro_sem_projeto` é `media` e falhava por desenho — não pode pintar o painel. */
  it('gravidade media quebrada aparece, mas não derruba o estado', () => {
    const b = blocoDeInvariantes(
      [leitura(1, [{ id: 'registro_sem_projeto', ok: false, gravidade: 'media' }])], 6)
    expect(b.estado).toBe('ok')
    expect(b.problemas.map((p) => p.id)).toEqual(['registro_sem_projeto'])
  })

  /**
   * ── Achado da primeira leitura em produção (17/09) ────────────────────────
   *
   * `registro_sem_projeto` voltou **nove vezes**, uma por projeto, com o texto idêntico — o
   * passivo histórico que ele relata é global, não por projeto. Nove linhas iguais numa tela de
   * celular empurram para fora tudo o que importa, e repetir o mesmo aviso é exatamente como ele
   * deixa de ser lido.
   */
  it('o mesmo invariante quebrado em vários projetos vira UMA linha', () => {
    const p1 = { ...leitura(1, [{ id: 'reg', ok: false, gravidade: 'media' }]), projectId: 'aaaa1111-x' }
    const p2 = { ...leitura(1, [{ id: 'reg', ok: false, gravidade: 'media' }]), projectId: 'bbbb2222-x' }
    const p3 = { ...leitura(1, [{ id: 'reg', ok: false, gravidade: 'media' }]), projectId: 'cccc3333-x' }

    const b = blocoDeInvariantes([p1, p2, p3], 6)
    expect(b.problemas).toHaveLength(1)
    expect(b.problemas[0].detalhe).toMatch(/em 3 projetos/)
    // a contagem continua contando os três
    expect(b.total).toBe(3)
  })

  it('quebrado num projeto só nomeia o projeto', () => {
    const b = blocoDeInvariantes([leitura(1, [{ id: 'reg', ok: false, gravidade: 'media' }])], 6)
    expect(b.problemas[0].detalhe).toMatch(/projeto aaaaaaaa/)
  })

  it('gravidade alta quebrada derruba', () => {
    const b = blocoDeInvariantes([leitura(1, [{ id: 'jina', ok: false, gravidade: 'alta' }])], 6)
    expect(b.estado).toBe('quebrado')
  })

  /** Leitura velha de um projeto não pode apagar a leitura fresca de outro. */
  it('mistura de idades usa só as frescas', () => {
    const velha = leitura(20, [{ id: 'x', ok: false, gravidade: 'alta' }])
    const nova  = leitura(1,  [{ id: 'y', ok: true,  gravidade: 'alta' }])
    const b = blocoDeInvariantes([velha, nova], 6)
    expect(b.estado).toBe('ok')
    expect(b.total).toBe(1)
    expect(b.problemas).toEqual([])
  })
})

describe('estadoGeral — falha medida nunca é mascarada por desconhecido', () => {
  const ok = { estado: 'ok' as const, ok: 1, total: 1, problemas: [] }
  const q  = { estado: 'quebrado' as const, ok: 0, total: 1, problemas: [] }
  const d  = { estado: 'desconhecido' as const, ok: 0, total: 0, problemas: [] }

  it('tudo ok', ()                    => expect(estadoGeral([ok, ok, ok])).toBe('ok'))
  it('um quebrado manda', ()          => expect(estadoGeral([ok, q, d])).toBe('quebrado'))
  it('desconhecido sem quebra: incerto', () => expect(estadoGeral([ok, ok, d])).toBe('incerto'))

  /** A asserção central: não medir nunca produz "ok". */
  it('desconhecido JAMAIS resulta em ok', () => {
    expect(estadoGeral([d, d, d])).not.toBe('ok')
  })
})

describe('resumo — uma linha que se lê no celular', () => {
  it('quando está tudo bem, ele FALA (ao contrário do hook)', () => {
    const p = montarPanorama(
      blocoDeServicos(saudavel()),
      blocoDeCiclos([ciclo('a', 'saudavel')], true),
      blocoDeInvariantes([leitura(1, [{ id: 'd', ok: true, gravidade: 'alta' }])], 6),
    )
    expect(p.geral).toBe('ok')
    expect(p.resumo).toMatch(/tudo de pé/)
  })

  it('com a V1 fora, o resumo nomeia o problema e conta o que não foi medido', () => {
    const p = montarPanorama(
      blocoDeServicos({ tipo: 'semResposta', erro: 'timeout' }),
      blocoDeCiclos([], false),
      blocoDeInvariantes([], 6),
    )
    expect(p.geral).toBe('quebrado')
    expect(p.resumo).toContain('api_v1')
    expect(p.resumo).toMatch(/não medida/)
  })
})
