import { ContextEngineController } from '../context-engine.controller'
import type { IssueContextPackDto } from '../dto/context-pack.dto'
import type { AuthenticatedRequest } from '../../core/auth.guard'

function build() {
  const ctx = {
    build: jest.fn().mockResolvedValue({ sections: {}, falhas: [], text: '', totalChars: 0, cacheHit: false, builtAt: new Date() }),
    buildSurgical: jest.fn().mockResolvedValue({}),
    invalidateCache: jest.fn(),
  }
  const packs = {
    issue: jest.fn().mockResolvedValue({ id: 'pack-1' }),
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 'pack-1' }),
    content: jest.fn().mockResolvedValue({ text: '' }),
    verify: jest.fn().mockResolvedValue({ reproducible: true }),
  }
  return { controller: new ContextEngineController(ctx as never, packs as never), ctx, packs }
}

const requisicao = (principal: unknown) => ({ authPrincipal: principal } as AuthenticatedRequest)

const pedido: IssueContextPackDto = {
  scopeType: 'project', projectId: 'p1',
  consumer: 'hermes', sessionId: 'sessao-1', purpose: 'responder',
}

describe('ContextEngineController — quem diz qual é o principal', () => {
  /**
   * O defeito que este arquivo existe para pegar não daria erro nenhum.
   *
   * Todo teste do `ContextPackService` passa o principal como argumento, então nenhum deles
   * enxerga a porta de entrada: trocar `req.authPrincipal` por um campo do corpo deixaria a
   * suíte inteira verde e faria qualquer produtor emitir pacote como o dono — inclusive
   * pedindo candidatos. É a família do A08, em que o gate dependia da rota escolhida em vez
   * do risco.
   */
  it('o principal do pacote vem do guard, mesmo quando o corpo tenta declarar outro', async () => {
    const { controller, packs } = build()
    const guard = { kind: 'service' as const, subject: 'agent' }
    const corpoHostil = {
      ...pedido,
      principal: { kind: 'human', subject: 'admin' },
      principalSubject: 'admin',
      includeCandidates: true,
    } as IssueContextPackDto

    await controller.issuePack(corpoHostil, requisicao(guard))

    expect(packs.issue).toHaveBeenCalledTimes(1)
    const [dtoRecebido, principalRecebido] = packs.issue.mock.calls[0]
    expect(principalRecebido).toBe(guard)
    expect(principalRecebido).not.toEqual({ kind: 'human', subject: 'admin' })
    // O corpo chega inteiro ao serviço — quem recusa candidato sem dono é ele, com o
    // principal do guard. O que o controller garante é que o principal não é negociável.
    expect(dtoRecebido).toBe(corpoHostil)
  })

  it('a leitura do conteúdo também carrega o principal autenticado', async () => {
    const { controller, packs } = build()
    const guard = { kind: 'human' as const, subject: 'admin', role: 'admin' }

    await controller.packContent('pack-1', requisicao(guard))

    expect(packs.content).toHaveBeenCalledWith('pack-1', guard)
  })

  it('manifesto e verificação são evidência: respondem por id, sem depender de quem pergunta', async () => {
    const { controller, packs } = build()

    await controller.getPack('pack-1')
    await controller.verifyPack('pack-1')

    expect(packs.get).toHaveBeenCalledWith('pack-1')
    expect(packs.verify).toHaveBeenCalledWith('pack-1')
  })

  it('a listagem repassa o filtro declarado, sem inventar escopo', async () => {
    const { controller, packs } = build()

    await controller.listPacks('project', 'p1', 'hermes', 'sessao-1')

    expect(packs.list).toHaveBeenCalledWith({
      scopeType: 'project', projectId: 'p1', consumer: 'hermes', sessionId: 'sessao-1',
    })
  })

  it('as rotas antigas de contexto continuam delegando ao engine', async () => {
    const { controller, ctx } = build()

    await controller.build({ projectId: 'p1' })
    await controller.surgical({ projectId: 'p1', task: 'cache' })
    await controller.preview('p1', 'debugging', 'erro')
    controller.invalidate('p1')

    expect(ctx.build).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
    expect(ctx.buildSurgical).toHaveBeenCalledWith({ projectId: 'p1', task: 'cache' })
    expect(ctx.invalidateCache).toHaveBeenCalledWith('p1')
  })
})
