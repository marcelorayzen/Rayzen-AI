jest.mock('../../exec/workdir', () => ({ resolverWorkdir: jest.fn() }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolverWorkdir } = require('../../exec/workdir') as { resolverWorkdir: jest.Mock }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolverBaseDaSessao } = require('../base-da-sessao') as {
  resolverBaseDaSessao: (p: { projectId?: string; projectPath?: string }) => Promise<
    { base: string } | { erro: string }
  >
}

/**
 * ── Terceira peça de R2 (A03) ─────────────────────────────────────────────────
 *
 * Com a sessão passando a ser enfileirada de verdade, o payload que chega ao executor carrega
 * `projectId` — não um caminho. Antes, `base = projectPath ?? process.cwd()` caía silenciosamente
 * no diretório de onde o agent foi iniciado quando não havia caminho: a sessão rodaria contra um
 * repositório arbitrário, e nada indicaria o erro.
 *
 * A regra é a mesma da Fase 3 do plano de execução tipada, aplicada aqui: `projectId` que não
 * resolve **recusa a chamada inteira**, nunca cai para `process.cwd()` nem para um `path`
 * residual. `resolverWorkdir()` nunca lança e devolve `null` quando não encontra — quem chama é
 * que decide, e a decisão é recusar.
 */
describe('resolverBaseDaSessao — projectId manda, e não resolver é recusa', () => {
  beforeEach(() => jest.clearAllMocks())

  it('projectId que resolve vira o diretório do projeto', async () => {
    resolverWorkdir.mockResolvedValueOnce('/repos/rayzen-ai')

    const r = await resolverBaseDaSessao({ projectId: 'proj-1' })

    expect(r).toEqual({ base: '/repos/rayzen-ai' })
    expect(resolverWorkdir).toHaveBeenCalledWith('proj-1')
  })

  it('projectId que NÃO resolve recusa — nunca cai em process.cwd()', async () => {
    resolverWorkdir.mockResolvedValueOnce(null)

    const r = await resolverBaseDaSessao({ projectId: 'proj-sem-checkout' })

    expect(r).not.toHaveProperty('base')
    expect((r as { erro: string }).erro).toMatch(/proj-sem-checkout/)
  })

  it('projectId que não resolve recusa MESMO com projectPath junto — sem cair no resíduo', async () => {
    resolverWorkdir.mockResolvedValueOnce(null)

    const r = await resolverBaseDaSessao({ projectId: 'proj-x', projectPath: '/qualquer/coisa' })

    expect(r).not.toHaveProperty('base')
  })

  it('projectId tem precedência sobre projectPath quando resolve', async () => {
    resolverWorkdir.mockResolvedValueOnce('/repos/certo')

    const r = await resolverBaseDaSessao({ projectId: 'proj-1', projectPath: '/repos/errado' })

    expect(r).toEqual({ base: '/repos/certo' })
  })

  it('sem projectId, projectPath continua valendo — chamadas legadas não quebram', async () => {
    const r = await resolverBaseDaSessao({ projectPath: '/repos/legado' })

    expect(r).toEqual({ base: '/repos/legado' })
    expect(resolverWorkdir).not.toHaveBeenCalled()
  })

  it('sem nada, cai no cwd — compatibilidade explícita, não acidente', async () => {
    const r = await resolverBaseDaSessao({})

    expect(r).toEqual({ base: process.cwd() })
  })
})
