import { raizDoRepo } from '../invariants.service'

/**
 * `20260630000000_policy_exceptions` ficou **53 dias** sem aplicar: declarava `id`/`rule_id`
 * como UUID contra uma `policy_rules.id` que é TEXT, e o Postgres recusava a FK.
 *
 * Parecia contabilidade de migração e era queda de produção. `policy-engine.service.ts`
 * chama `findActiveException()` para CADA regra em toda avaliação, então sem a tabela o
 * Prisma lançava e `POST /v2/policy/evaluate` devolvia 500 — o motor de política inteiro
 * morto, incluindo o `block` que protege o Brain de conhecimento com trust baixo.
 * Heartbeats saudáveis, invariantes 8 de 9, painel verde. Achado por acaso.
 *
 * O detalhe que torna o check possível é contraintuitivo: na V2, `migrate deploy` **nunca
 * roda** (o schema vem de `db push`), então a migração que nunca aplicou **não deixa
 * rastro nenhum** em `_prisma_migrations` — não há linha de erro para consultar. A única
 * evidência é o diretório ter um nome que o banco não conhece.
 */

describe('raizDoRepo', () => {
  const arvore = (paths: string[]) => (p: string) => paths.includes(p.replace(/\\/g, '/'))

  it('acha a raiz subindo a partir do build dentro do container', () => {
    const existe = arvore(['/app/apps/api-v2/prisma/migrations'])
    expect(raizDoRepo('/app/apps/api-v2/dist/invariants', existe)?.replace(/\\/g, '/')).toBe('/app')
  })

  it('acha a raiz rodando do fonte, sem build', () => {
    const existe = arvore(['/repo/apps/api-v2/prisma/migrations'])
    expect(raizDoRepo('/repo/apps/api-v2/src/invariants', existe)?.replace(/\\/g, '/')).toBe('/repo')
  })

  it('devolve null quando não existe — não sabe não é sabe que está errado', () => {
    expect(raizDoRepo('/tmp/qualquer/coisa', () => false)).toBeNull()
  })

  it('não sobe para sempre quando a raiz do sistema é atingida', () => {
    // O loop precisa terminar em `dirname(x) === x`; sem isso, um caminho curto
    // rodaria as 8 voltas inteiras à toa e o teste travaria em ambiente estranho.
    expect(raizDoRepo('/', () => false)).toBeNull()
  })
})

describe('migracoes_aplicadas', () => {
  type Linha = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }

  function build(noDisco: Record<string, string[]>, noBanco: Record<string, Linha[]>, semRaiz = false) {
    jest.resetModules()
    jest.doMock('node:fs', () => ({
      existsSync: (p: string) => {
        if (semRaiz) return false
        const n = p.replace(/\\/g, '/')
        if (n.endsWith('apps/api-v2/prisma/migrations')) return true
        return Object.keys(noDisco).some((s) => n.endsWith(`apps/${s === 'v2' ? 'api-v2' : 'api'}/prisma/migrations`))
      },
      readdirSync: (p: string) => {
        // Pelo SUFIXO, nunca por `includes('api-v2')`: a raiz resolvida em teste é o
        // próprio diretório do spec, cujo caminho já contém `api-v2`, e um `includes`
        // classificaria o diretório da V1 como sendo da V2.
        const n = p.replace(/\\/g, '/')
        const schema = n.endsWith('apps/api-v2/prisma/migrations') ? 'v2' : 'public'
        return (noDisco[schema] ?? []).map((name) => ({ name, isDirectory: () => true }))
      },
    }))

    const { InvariantsService } = require('../invariants.service') as typeof import('../invariants.service')
    const prisma = {
      $queryRawUnsafe: jest.fn().mockImplementation((sql: string) => {
        const schema = sql.includes('"v2"') ? 'v2' : 'public'
        return Promise.resolve(noBanco[schema] ?? [])
      }),
    }
    const service = new InvariantsService(prisma as never, {} as never, {} as never, {} as never)
    return () => (service as unknown as {
      migracoesAplicadas: () => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).migracoesAplicadas()
  }

  const aplicada = (n: string): Linha => ({ migration_name: n, finished_at: new Date(), rolled_back_at: null })

  afterEach(() => jest.dontMock('node:fs'))

  it('verde quando todo diretório tem linha aplicada', async () => {
    const r = await build(
      { v2: ['20260101_a', '20260102_b'], public: ['20250101_c'] },
      { v2: [aplicada('20260101_a'), aplicada('20260102_b')], public: [aplicada('20250101_c')] },
    )()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toContain('3 migração(ões)')
  })

  /**
   * O caso real: a migração nunca foi tentada, então NÃO existe linha nenhuma para ela —
   * nem de erro. Um check que procurasse "linha com erro" passaria verde.
   */
  it('vermelho quando o diretório tem migração que o banco não conhece', async () => {
    const r = await build(
      { v2: ['20260101_a', '20260630000000_policy_exceptions'], public: [] },
      { v2: [aplicada('20260101_a')], public: [] },
    )()
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('1 nunca aplicada(s)')
    expect(r.detalhe).toContain('v2/20260630000000_policy_exceptions')
  })

  it('vermelho quando uma migração começou e nunca terminou', async () => {
    const r = await build(
      { v2: ['20260101_a'], public: [] },
      { v2: [aplicada('20260101_a'), { migration_name: '20260102_b', finished_at: null, rolled_back_at: null }], public: [] },
    )()
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('travada(s) no meio')
  })

  /**
   * Só olha numa direção, de propósito. A V1 tem 37 linhas aplicadas para 25 diretórios —
   * squash e histórico reescrito são normais, e falhar por isso deixaria o check vermelho
   * para sempre por causa de coisa antiga.
   */
  it('migração aplicada que sumiu do diretório NÃO é falha', async () => {
    const r = await build(
      { v2: ['20260102_b'], public: [] },
      { v2: [aplicada('20260101_a_apagada'), aplicada('20260102_b')], public: [] },
    )()
    expect(r.ok).toBe(true)
  })

  it('tentativa que já foi resolvida como rolled_back não conta como travada', async () => {
    const r = await build(
      { v2: ['20260101_a'], public: [] },
      {
        v2: [
          aplicada('20260101_a'),
          { migration_name: '20260101_a', finished_at: null, rolled_back_at: new Date() },
        ],
        public: [],
      },
    )()
    expect(r.ok).toBe(true)
  })

  it('sem diretório localizável é INCONCLUSIVO, não falha', async () => {
    const r = await build({}, {}, true)()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Inconclusivo/)
  })

  it('a correção manda EXERCITAR a rota, não só aplicar a migração', async () => {
    const r = await build({ v2: ['x'], public: [] }, { v2: [], public: [] })()
    expect(r.correcao).toMatch(/EXERCITE/)
    expect(r.correcao).toMatch(/migrate diff/)
  })
})
