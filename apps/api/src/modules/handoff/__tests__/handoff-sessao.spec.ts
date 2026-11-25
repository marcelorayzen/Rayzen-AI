import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { HandoffService, EFEITO_SESSAO, atorDoEfeito } from '../handoff.service'
import { ConteudoDoHandoff } from '../handoff.const'
import {
  avaliarPreviaDaSessao, verificarEntregaDaSessao, ResultadoDaPreviaDaSessao,
} from '../handoff-preflight'
import { alvoDaExecucao } from '../../execution/alvo-de-execucao.const'
import { hashDoAlvo } from '../../execution/approval.service'

/**
 * Item 7.2a, fatia B — `supervised_session` como efeito de ProjectHandoff, com entrega
 * (branch/PR) confirmada pelo postflight MEDIDO, nunca pelo relato da sessão.
 */

const ROOT = 'C:/Users/dev/Projects'
const CHECKOUT = 'C:/Users/dev/Projects/rayzen-marcenaria'
const SESSAO = 'cmsessao0001'
const BRANCH = 'rayzen/sessao-cmsessao'

const conteudo = (payload: Record<string, unknown>): ConteudoDoHandoff => ({
  name: 'Corrigir peças', brief: 'Ajustar cálculo de peças complementares.', template: 'sessao', root: ROOT,
  efeitos: [{ actionKey: EFEITO_SESSAO, payload }],
})

const PAYLOAD = { projectId: 'proj-1', prompt: 'Corrija o cálculo', publicar: true }

function previa(over: Partial<NonNullable<ResultadoDaPreviaDaSessao['previa']>> = {}, entrega = {}): ResultadoDaPreviaDaSessao {
  return {
    ok: true,
    path: CHECKOUT,
    previa: {
      tipo: 'sessao_supervisionada', branch: BRANCH, publicar: true,
      git: { estado: 'repo', branch: 'main', naoCommitados: 0 },
      remoto: 'https://github.com/x/rayzen-marcenaria.git', ghAutenticado: true,
      entrega: {
        commitLocal: null, commitNoRemoto: null, prUrl: null, prEstado: null, prRascunho: null, inconclusiva: false,
        ...entrega,
      },
      ...over,
    },
  }
}

describe('avaliarPreviaDaSessao — o que autoriza enfileirar', () => {
  it('caminho limpo com publicar: ok', () => {
    expect(avaliarPreviaDaSessao(previa(), ROOT)).toMatchObject({ ok: true })
  })
  it.each([
    ['sem prévia', null, /não respondeu/],
    ['checkout fora da raiz', { ...previa(), path: 'D:/outro/repo' }, /dentro da raiz/],
    ['não é repositório', previa({ git: { estado: 'nao-repo' } }), /não é um repositório/],
    ['branch já existe localmente', previa({}, { commitLocal: 'abc' }), /já existe/],
    ['branch já existe no remoto', previa({}, { commitNoRemoto: 'abc' }), /já existe/],
    ['publicar sem gh autenticado', previa({ ghAutenticado: false }), /gh não está autenticado/],
  ])('recusa: %s', (_caso, resultado, motivo) => {
    const v = avaliarPreviaDaSessao(resultado as ResultadoDaPreviaDaSessao, ROOT)
    expect(v.ok).toBe(false)
    expect(v.motivo).toMatch(motivo)
  })
  it('a recusa do agent aparece no motivo', () => {
    expect(avaliarPreviaDaSessao({ ok: false, error: 'projeto sem checkout nesta máquina' }, ROOT).motivo)
      .toMatch(/projeto sem checkout/)
  })
  it('sem publicar, gh e remoto não são pré-condição', () => {
    expect(avaliarPreviaDaSessao(previa({ publicar: false, remoto: null, ghAutenticado: null }), ROOT).ok).toBe(true)
  })
  // 15/11: o projeto criado pelo Hub nasce sem remoto, e a recusa barrou a primeira tarefa real.
  it('publicar sem remoto vira entrega local, dito no motivo — nunca recusa', () => {
    const v = avaliarPreviaDaSessao(previa({ remoto: null, ghAutenticado: false }), ROOT)
    expect(v.ok).toBe(true)
    expect(v.motivo).toMatch(/entrega local/)
    expect(v.motivo).toMatch(/PR não será aberto/)
  })
})

describe('verificarEntregaDaSessao — a entrega é medida, não relatada', () => {
  it('publicado: branch no remoto + PR → confirmado, com a entrega a gravar', () => {
    const v = verificarEntregaDaSessao(previa({}, {
      commitLocal: 'f'.repeat(40), commitNoRemoto: 'f'.repeat(40),
      prUrl: 'https://github.com/x/y/pull/4', prEstado: 'OPEN', prRascunho: true,
    }), CHECKOUT)
    expect(v.estado).toBe('confirmado')
    expect(v.entrega).toMatchObject({ branch: BRANCH, publicado: true, prUrl: 'https://github.com/x/y/pull/4', prRascunho: true })
  })
  it('publicado sem PR continua entrega revisável, dito no motivo', () => {
    const v = verificarEntregaDaSessao(previa({}, { commitNoRemoto: 'a'.repeat(40) }), CHECKOUT)
    expect(v.estado).toBe('confirmado')
    expect(v.motivo).toMatch(/PR nao encontrado/)
  })
  it('publicar aprovado e branch ausente do remoto → ausente (vira effect_unknown)', () => {
    const v = verificarEntregaDaSessao(previa(), CHECKOUT)
    expect(v.estado).toBe('ausente')
    expect(v.entrega).toBeUndefined()
  })
  it('remoto não consultado → nao-verificado, nunca ausente', () => {
    expect(verificarEntregaDaSessao(previa({}, { inconclusiva: true }), CHECKOUT).estado).toBe('nao-verificado')
  })
  it('entrega local: exige commit no branch desta máquina', () => {
    expect(verificarEntregaDaSessao(previa({ publicar: false }), CHECKOUT).estado).toBe('ausente')
    const v = verificarEntregaDaSessao(previa({ publicar: false }, { commitLocal: 'b'.repeat(40) }), CHECKOUT)
    expect(v).toMatchObject({ estado: 'confirmado', entrega: { publicado: false, prUrl: null } })
  })
  it('publicar pedido sem remoto: mede a entrega LOCAL, como o preflight prometeu', () => {
    expect(verificarEntregaDaSessao(previa({ remoto: null }), CHECKOUT).estado).toBe('ausente')
    const v = verificarEntregaDaSessao(previa({ remoto: null }, { commitLocal: 'c'.repeat(40) }), CHECKOUT)
    expect(v).toMatchObject({ estado: 'confirmado', entrega: { publicado: false } })
  })
  it('postflight em outro checkout → ausente', () => {
    expect(verificarEntregaDaSessao({ ...previa(), path: `${ROOT}/outro` }, CHECKOUT).estado).toBe('ausente')
  })
})

function build(linhaInicial: Record<string, unknown> = {}) {
  const linha: Record<string, unknown> = {
    id: 'h1', version: 1, status: 'draft', contentHash: 'hash-1', root: ROOT, name: 'Corrigir peças',
    effects: [{ actionKey: EFEITO_SESSAO, payload: { ...PAYLOAD, sessionId: SESSAO } }],
    createdBy: 'marcelo', ...linhaInicial,
  }
  const prisma = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1' }) },
    agentSession: {
      create: jest.fn().mockResolvedValue({ id: SESSAO }),
      update: jest.fn().mockResolvedValue({}),
      // Sem recusa de publicação registrada — o caso comum.
      findUnique: jest.fn().mockResolvedValue({ publicacaoRecusadaEm: null, publicacaoRecusadaPor: null }),
    },
    projectHandoff: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...linha, ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...linha, ...data })),
      findUnique: jest.fn().mockResolvedValue(linha),
    },
    // Vigente e não consumida — o estado de um envelope recém-aprovado.
    executionApproval: { findUnique: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 9 * 60_000), consumedAt: null }) },
  }
  const execution = { enqueue: jest.fn().mockResolvedValue('task-9'), dispatch: jest.fn() }
  const approvals = { criar: jest.fn().mockResolvedValue({ id: 'ap-9' }) }
  const service = new HandoffService(prisma as never, approvals as never, execution as never)
  return { service, prisma, execution, linha, approvals }
}

describe('HandoffService — sessão supervisionada como envelope', () => {
  it('criar cunha a AgentSession pending e põe o sessionId DENTRO do conteúdo hasheado', async () => {
    const { service, prisma } = build()
    const criado = await service.criar(conteudo(PAYLOAD), 'marcelo')

    expect(prisma.agentSession.create).toHaveBeenCalledWith({
      data: { projectId: 'proj-1', claudePrompt: 'Corrija o cálculo', status: 'pending' },
    })
    const data = prisma.projectHandoff.create.mock.calls[0][0].data
    expect(data.effects[0].payload).toEqual({ ...PAYLOAD, aprovacao: 'por_entrega', sessionId: SESSAO })
    expect(data.isolamento).toBe('worktree')
    expect(criado.contentHash).toBe(data.contentHash)
  })

  /**
   * Item 7.3: o modo é gravado EXPLÍCITO mesmo quando omitido — quem aprova precisa ver se a
   * sessão vai parar em cada etapa ou só no fim, e o hash precisa cobrir isso. Omitir e deixar
   * o agent decidir faria o mesmo envelope significar coisas diferentes conforme a versão.
   */
  it.each([
    ['omitido → por_entrega, gravado', {}, 'por_entrega'],
    ['por_etapa é preservado', { aprovacao: 'por_etapa' }, 'por_etapa'],
  ])('modo de aprovação: %s', async (_caso, extra, esperado) => {
    const { service, prisma } = build()
    await service.criar(conteudo({ ...PAYLOAD, ...extra }), 'marcelo')
    expect(prisma.projectHandoff.create.mock.calls[0][0].data.effects[0].payload.aprovacao).toBe(esperado)
  })

  it('o modo entra no hash — trocar por_entrega por por_etapa muda o envelope', async () => {
    const a = build(); await a.service.criar(conteudo(PAYLOAD), 'm')
    const b = build(); await b.service.criar(conteudo({ ...PAYLOAD, aprovacao: 'por_etapa' }), 'm')
    expect(a.prisma.projectHandoff.create.mock.calls[0][0].data.contentHash)
      .not.toBe(b.prisma.projectHandoff.create.mock.calls[0][0].data.contentHash)
  })

  // G6.6 (21/11): o primeiro disparo real de rotina gravou o envelope SEM o ramo do PR.
  it('baseRef (ramo do PR) é preservado no envelope e entra no hash', async () => {
    const a = build(); await a.service.criar(conteudo({ ...PAYLOAD, baseRef: 'rayzen/aceite-g6-ci-falha' }), 'rotina:r1')
    const b = build(); await b.service.criar(conteudo(PAYLOAD), 'rotina:r1')
    const data = a.prisma.projectHandoff.create.mock.calls[0][0].data
    expect(data.effects[0].payload).toMatchObject({ baseRef: 'rayzen/aceite-g6-ci-falha', sessionId: SESSAO })
    expect(data.contentHash).not.toBe(b.prisma.projectHandoff.create.mock.calls[0][0].data.contentHash)
    expect(b.prisma.projectHandoff.create.mock.calls[0][0].data.effects[0].payload).not.toHaveProperty('baseRef')
  })

  it.each([
    ['baseRef começando com -', { ...PAYLOAD, baseRef: '--upload-pack=x' }, /baseRef precisa ser um nome de ramo/],
    ['baseRef com ..', { ...PAYLOAD, baseRef: 'a/../b' }, /baseRef/],
    ['baseRef com espaço', { ...PAYLOAD, baseRef: 'feature x' }, /baseRef/],
    ['baseRef não-string', { ...PAYLOAD, baseRef: 7 }, /baseRef/],
    ['sessionId vindo do corpo', { ...PAYLOAD, sessionId: 'outra' }, /cunhado pelo servidor/],
    ['projectPath livre', { ...PAYLOAD, projectPath: 'C:/x' }, /projectPath não é aceito/],
    ['publicar em string', { ...PAYLOAD, publicar: 'true' }, /booleano/],
    ['modo de aprovação desconhecido', { ...PAYLOAD, aprovacao: 'nenhuma' }, /aprovacao precisa ser/],
    ['sem projectId', { prompt: 'x' }, /projectId/],
    ['sem prompt', { projectId: 'proj-1' }, /prompt/],
  ])('recusa %s sem criar sessão', async (_caso, payload, motivo) => {
    const { service, prisma } = build()
    await expect(service.criar(conteudo(payload), 'm')).rejects.toThrow(BadRequestException)
    await expect(service.criar(conteudo(payload), 'm')).rejects.toThrow(motivo)
    expect(prisma.agentSession.create).not.toHaveBeenCalled()
  })

  it('projeto inexistente: 404 e nenhuma sessão', async () => {
    const { service, prisma } = build()
    prisma.project.findUnique.mockResolvedValue(null)
    await expect(service.criar(conteudo(PAYLOAD), 'm')).rejects.toThrow(NotFoundException)
    expect(prisma.agentSession.create).not.toHaveBeenCalled()
  })

  it('envelope que falha ao gravar marca a sessão como error — não deixa pending prometendo trabalho', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.create.mockRejectedValue(new Error('db fora'))
    await expect(service.criar(conteudo(PAYLOAD), 'm')).rejects.toThrow('db fora')
    expect(prisma.agentSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: SESSAO }, data: expect.objectContaining({ status: 'error' }),
    }))
  })

  it('editar mantém a mesma sessão (mesmo branch) e atualiza o prompt dela', async () => {
    const { service, prisma } = build()
    await service.editar('h1', conteudo({ ...PAYLOAD, prompt: 'Novo pedido' }), 'm')
    const data = prisma.projectHandoff.update.mock.calls[0][0].data
    expect(data.effects[0].payload.sessionId).toBe(SESSAO)
    expect(prisma.agentSession.create).not.toHaveBeenCalled()
    expect(prisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: SESSAO }, data: { projectId: 'proj-1', claudePrompt: 'Novo pedido' },
    })
  })

  it('materializar com prévia limpa enfileira e só então marca a sessão active', async () => {
    const { service, prisma, execution } = build({ status: 'approved', approvalId: 'ap-9' })
    execution.dispatch.mockResolvedValue(previa())
    await service.materializar('h1')
    expect(execution.dispatch).toHaveBeenCalledWith('supervised_session', expect.objectContaining({ dryRun: true, sessionId: SESSAO }))
    expect(execution.enqueue).toHaveBeenCalledWith('supervised_session', expect.objectContaining({ sessionId: SESSAO, publicar: true, nomeDoEnvelope: 'Corrigir peças' }), undefined, expect.any(String))
    expect(prisma.agentSession.update).toHaveBeenCalledWith({ where: { id: SESSAO }, data: { status: 'active' } })
  })

  it('materializar recusa quando o branch da sessão já existe — e não enfileira', async () => {
    const { service, execution, prisma } = build({ status: 'approved', approvalId: 'ap-9' })
    execution.dispatch.mockResolvedValue(previa({}, { commitLocal: 'abc' }))
    await expect(service.materializar('h1')).rejects.toThrow(ConflictException)
    expect(execution.enqueue).not.toHaveBeenCalled()
    expect(prisma.agentSession.update).not.toHaveBeenCalled()
  })

  describe('reconciliar', () => {
    const efeito = { actionKey: EFEITO_SESSAO, payload: { ...PAYLOAD, sessionId: SESSAO } }
    const carga = { ...efeito.payload, nomeDoEnvelope: 'Corrigir peças', root: ROOT, handoffId: 'h1', contentHash: 'hash-1' }
    const emReconciliacao = {
      status: 'reconciling', approvalId: 'ap-9', taskId: 'task-9', approvedBy: 'marcelo',
      preflight: previa(),
    }
    const aprovacaoConsumida = {
      argsHash: hashDoAlvo(alvoDaExecucao(EFEITO_SESSAO, 'desktop', carga)),
      createdBy: 'marcelo', consumedAt: new Date(), consumedByTask: 'task-9',
    }

    it('branch e PR medidos no remoto → completed com delivery e o projeto do payload', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.executionApproval.findUnique.mockResolvedValue(aprovacaoConsumida)
      execution.dispatch.mockResolvedValue(previa({}, {
        commitLocal: 'c'.repeat(40), commitNoRemoto: 'c'.repeat(40), prUrl: 'https://github.com/x/y/pull/4', prEstado: 'OPEN', prRascunho: true,
      }))

      await service.reconciliar('h1')

      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data.status).toBe('completed')
      expect(data.projectId).toBe('proj-1')
      expect(data.delivery).toMatchObject({ branch: BRANCH, commit: 'c'.repeat(40), publicado: true, prUrl: 'https://github.com/x/y/pull/4' })
    })

    it('branch ausente do remoto → effect_unknown, sem delivery', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.executionApproval.findUnique.mockResolvedValue(aprovacaoConsumida)
      execution.dispatch.mockResolvedValue(previa())
      await service.reconciliar('h1')
      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data.status).toBe('effect_unknown')
      expect(data.delivery).toBeUndefined()
    })

    // 21/11 (aceite do G6): "Não publicar" deixava o envelope incerto e exigia descarte à mão.
    const RECUSA = { publicacaoRecusadaEm: new Date('2026-11-21T18:34:00Z'), publicacaoRecusadaPor: 'hub:8c69' }

    it('publicação recusada pela pessoa e nada no remoto → failed_safe, com quem recusou', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.executionApproval.findUnique.mockResolvedValue(aprovacaoConsumida)
      prisma.agentSession.findUnique.mockResolvedValue(RECUSA)
      execution.dispatch.mockResolvedValue(previa())
      await service.reconciliar('h1')
      expect(prisma.agentSession.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SESSAO } }))
      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data.status).toBe('failed_safe')
      expect(data.motivo).toMatch(/publicação recusada por hub:8c69 .* nada publicado/)
      expect(data.delivery).toBeUndefined()
    })

    it('recusa registrada mas o ramo ESTÁ no remoto → nunca fecha como recusado', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.executionApproval.findUnique.mockResolvedValue({ ...aprovacaoConsumida, consumedByTask: 'outra' })
      prisma.agentSession.findUnique.mockResolvedValue(RECUSA)
      execution.dispatch.mockResolvedValue(previa({}, { commitNoRemoto: 'c'.repeat(40) }))
      await service.reconciliar('h1')
      expect(prisma.projectHandoff.update.mock.calls.at(-1)![0].data.status).toBe('effect_unknown')
    })

    it('recusa registrada mas o postflight mediu OUTRO checkout → continua incerto', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.agentSession.findUnique.mockResolvedValue(RECUSA)
      execution.dispatch.mockResolvedValue({ ...previa(), path: 'D:/outro/repo' })
      await service.reconciliar('h1')
      expect(prisma.projectHandoff.update.mock.calls.at(-1)![0].data.status).toBe('effect_unknown')
    })

    it('ler a recusa falhou → continua incerto, sem lançar', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.agentSession.findUnique.mockRejectedValue(new Error('db fora'))
      execution.dispatch.mockResolvedValue(previa())
      await service.reconciliar('h1')
      expect(prisma.projectHandoff.update.mock.calls.at(-1)![0].data.status).toBe('effect_unknown')
    })

    it('remoto não consultado → não move nada', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      execution.dispatch.mockResolvedValue(previa({}, { inconclusiva: true }))
      await service.reconciliar('h1')
      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data.status).toBeUndefined()
      expect(data.delivery).toBeUndefined()
    })

    it('entrega presente mas aprovação não consumida pela tarefa → effect_unknown, sem delivery', async () => {
      const { service, prisma, execution } = build(emReconciliacao)
      prisma.executionApproval.findUnique.mockResolvedValue({ ...aprovacaoConsumida, consumedByTask: 'outra' })
      execution.dispatch.mockResolvedValue(previa({}, { commitNoRemoto: 'c'.repeat(40) }))
      await service.reconciliar('h1')
      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data.status).toBe('effect_unknown')
      expect(data.delivery).toBeUndefined()
    })
  })
})

/** S3 (16/11): a sessão na sandbox declara `sandbox://dono/repo` — e só vale com o regime declarado. */
describe('avaliarPreviaDaSessao — regime sandbox', () => {
  const naSandbox = (over: Partial<NonNullable<ResultadoDaPreviaDaSessao['previa']>> = {}, path = 'sandbox://marcelorayzen/rayzen-marcenaria') =>
    ({ ...previa({ regime: 'sandbox', ...over }), path }) as ResultadoDaPreviaDaSessao

  it('sandbox com dono/repo válidos e publicar: ok, sem exigir raiz do PC', () => {
    expect(avaliarPreviaDaSessao(naSandbox(), ROOT)).toMatchObject({ ok: true })
  })
  it('caminho sandbox:// SEM o regime declarado é recusado — o caminho não se autoriza sozinho', () => {
    const r = { ...previa(), path: 'sandbox://marcelorayzen/rayzen-marcenaria' } as ResultadoDaPreviaDaSessao
    expect(avaliarPreviaDaSessao(r, ROOT)).toMatchObject({ ok: false, motivo: expect.stringMatching(/dentro da raiz/) })
  })
  it.each([
    ['caminho do PC com regime sandbox', 'C:/Users/dev/Projects/x'],
    ['traversal', 'sandbox://marcelorayzen/../etc'],
    ['sem repo', 'sandbox://marcelorayzen'],
    ['opção disfarçada', 'sandbox://-x/repo'],
  ])('recusa %s', (_caso, path) => {
    expect(avaliarPreviaDaSessao(naSandbox({}, path), ROOT)).toMatchObject({ ok: false })
  })
  it('na sandbox, sem publicar é recusado: a entrega local se perderia no volume', () => {
    expect(avaliarPreviaDaSessao(naSandbox({ publicar: false }), ROOT)).toMatchObject({ ok: false, motivo: expect.stringMatching(/sempre PR/) })
  })
  it('as outras regras continuam valendo na sandbox (branch que já existe)', () => {
    expect(avaliarPreviaDaSessao({ ...naSandbox(), previa: { ...naSandbox().previa!, entrega: { ...naSandbox().previa!.entrega, commitNoRemoto: 'abc' } } } as ResultadoDaPreviaDaSessao, ROOT))
      .toMatchObject({ ok: false, motivo: expect.stringMatching(/já existe/) })
  })
})

/**
 * 16/11: o primeiro envelope roteado para a sandbox foi recusado pelo agent-server porque a
 * aprovação tinha sido assinada para `desktop`. Quem assina e quem consome usam o mesmo papel.
 */
describe('aprovação assinada para quem vai consumir', () => {
  const antes = process.env.SESSAO_NO_SERVIDOR
  afterEach(() => { if (antes === undefined) delete process.env.SESSAO_NO_SERVIDOR; else process.env.SESSAO_NO_SERVIDOR = antes })

  it('sem a sandbox ligada, o ator continua desktop', () => {
    expect(atorDoEfeito(EFEITO_SESSAO, {})).toBe('desktop')
  })
  it('com a sessão no servidor, o ator é server — o mesmo papel do roteamento', () => {
    expect(atorDoEfeito(EFEITO_SESSAO, { SESSAO_NO_SERVIDOR: 'true' })).toBe('server')
    expect(atorDoEfeito('jarvis:create_project_folder', { SESSAO_NO_SERVIDOR: 'true' })).toBe('desktop')
  })
  it('aprovar emite o alvo com ator server quando a sessão vai para a sandbox', async () => {
    process.env.SESSAO_NO_SERVIDOR = 'true'
    const { service, approvals } = build({ status: 'awaiting_approval' })
    await service.aprovar('h1', { id: 'hub:abc', type: 'human' })
    expect(approvals.criar.mock.calls[0][0]).toMatchObject({ actionKey: EFEITO_SESSAO, actor: 'server' })
  })
})
