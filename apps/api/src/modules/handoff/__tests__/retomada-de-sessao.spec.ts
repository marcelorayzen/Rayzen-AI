import { ConflictException } from '@nestjs/common'
import { HandoffService, EFEITO_SESSAO } from '../handoff.service'
import { avaliarPreviaDaSessao, type ResultadoDaPreviaDaSessao } from '../handoff-preflight'

/**
 * G3.2c (24/11) — retomar com um toque a sessão que o executor largou no meio
 * (docs/decisions/G3.2-retomada-desenho.md, D1 e D3).
 *
 * O envelope incerto não reabre: nasce uma continuação aprovada pelo toque, que trabalha na pasta
 * e no ramo da sessão antiga. Quem diz se dá para retomar é a prévia da continuação.
 */

const ROOT = 'sandbox://marcelorayzen/rayzen-marcenaria'
const ANTIGA = 'cmantiga0001xyz'
const NOVA = 'cmnova00002abc'
const PAYLOAD = { projectId: 'proj-1', prompt: 'Acrescente a linha', publicar: true, aprovacao: 'por_entrega' }
const PESSOA = { id: 'hub:abc123', type: 'human' }

function previaDaRetomada(entrega: Record<string, unknown> = {}): ResultadoDaPreviaDaSessao {
  return {
    ok: true,
    path: ROOT,
    previa: {
      tipo: 'sessao_supervisionada', branch: 'rayzen/sessao-cmantiga', publicar: true, regime: 'sandbox', retomada: true,
      git: { estado: 'repo', branch: 'rayzen/sessao-cmantiga', naoCommitados: 0 },
      remoto: 'https://github.com/marcelorayzen/rayzen-marcenaria.git', ghAutenticado: true,
      entrega: { commitLocal: 'c0ffee', commitNoRemoto: null, prUrl: null, prEstado: null, prRascunho: null, inconclusiva: false, ...entrega },
    },
  }
}

/** Banco falso COM estado: o fluxo cria, transiciona e relê envelopes. */
function montar(opcoes: { statusAntigo?: string; statusDaSessao?: string | null; previa?: ResultadoDaPreviaDaSessao } = {}) {
  const linhas = new Map<string, Record<string, unknown>>()
  linhas.set('antigo', {
    id: 'antigo', version: 1, status: opcoes.statusAntigo ?? 'effect_unknown', contentHash: 'h-antigo',
    root: ROOT, name: 'README: plano de corte em PDF', brief: 'Uma linha no README.', template: 'sessao',
    sourceProjectId: 'proj-1', effects: [{ actionKey: EFEITO_SESSAO, payload: { ...PAYLOAD, sessionId: ANTIGA } }],
  })
  const prisma = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1' }) },
    agentSession: {
      create: jest.fn().mockResolvedValue({ id: NOVA }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(opcoes.statusDaSessao === null ? null : { status: opcoes.statusDaSessao ?? 'interrupted' }),
    },
    projectHandoff: {
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(linhas.get(where.id) ?? null)),
      create: jest.fn().mockImplementation(({ data }) => {
        const linha = { id: 'novo', version: 1, ...data }
        linhas.set('novo', linha)
        return Promise.resolve(linha)
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const linha = { ...linhas.get(where.id), ...data }
        linhas.set(where.id, linha)
        return Promise.resolve(linha)
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const atual = linhas.get(where.id)
        if (!atual) return Promise.resolve({ count: 0 })
        linhas.set(where.id, { ...atual, ...data })
        return Promise.resolve({ count: 1 })
      }),
    },
    executionApproval: { findUnique: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 9 * 60_000), consumedAt: null }) },
  }
  const execution = {
    dispatch: jest.fn().mockResolvedValue(opcoes.previa ?? previaDaRetomada()),
    enqueue: jest.fn().mockResolvedValue('task-1'),
  }
  const approvals = { criar: jest.fn().mockResolvedValue({ id: 'ap-1' }) }
  const service = new HandoffService(prisma as never, approvals as never, execution as never)
  return { service, prisma, execution, approvals, linhas }
}

describe('retomar a sessão interrompida de um envelope incerto', () => {
  it('nasce a continuação com retomaDe, aprovada pelo toque e enfileirada; o antigo fecha dizendo onde continuou', async () => {
    const { service, linhas, execution, approvals } = montar()
    const r = await service.retomarInterrompida('antigo', PESSOA)

    expect(r).toEqual({ retomado: true, novoId: 'novo' })
    const novo = linhas.get('novo')!
    const payload = (novo.effects as { payload: Record<string, unknown> }[])[0].payload
    expect(payload).toMatchObject({ ...PAYLOAD, sessionId: NOVA, retomaDe: ANTIGA })
    expect(novo).toMatchObject({ status: 'queued', approvedBy: PESSOA.id, name: 'README: plano de corte em PDF' })
    // A aprovação assina a carga COM retomaDe: o agent não consome outra coisa.
    expect(JSON.stringify(approvals.criar.mock.calls[0][0])).toContain(ANTIGA)
    expect(execution.dispatch).toHaveBeenCalledWith('supervised_session', expect.objectContaining({ retomaDe: ANTIGA, dryRun: true }))
    expect(linhas.get('antigo')).toMatchObject({ status: 'failed_safe', motivo: expect.stringMatching(/continuada no envelope novo/) })
  })

  it('a prévia recusa (ramo já no GitHub): a continuação é cancelada e o antigo fica como estava', async () => {
    const { service, linhas, execution } = montar({ previa: previaDaRetomada({ commitNoRemoto: 'f00' }) })
    const r = await service.retomarInterrompida('antigo', PESSOA)

    expect(r).toMatchObject({ retomado: false, motivo: expect.stringMatching(/já está no GitHub/) })
    expect(linhas.get('novo')).toMatchObject({ status: 'cancelled' })
    expect(linhas.get('antigo')).toMatchObject({ status: 'effect_unknown' })
    expect(execution.enqueue).not.toHaveBeenCalled()
  })

  it.each([
    ['o envelope não está incerto', { statusAntigo: 'approved' }],
    ['a sessão não foi interrompida pelo executor', { statusDaSessao: 'completed' }],
    ['a sessão não existe', { statusDaSessao: null }],
  ])('recusa quando %s, sem criar envelope nem sessão', async (_caso, opcoes) => {
    const { service, prisma } = montar(opcoes)
    await expect(service.retomarInterrompida('antigo', PESSOA)).rejects.toThrow(ConflictException)
    expect(prisma.projectHandoff.create).not.toHaveBeenCalled()
    expect(prisma.agentSession.create).not.toHaveBeenCalled()
  })
})

describe('avaliarPreviaDaSessao — continuação (retomada)', () => {
  it('ramo salvo aqui e ausente do GitHub: pode continuar', () => {
    const v = avaliarPreviaDaSessao(previaDaRetomada(), 'irrelevante')
    expect(v).toMatchObject({ ok: true, motivo: expect.stringMatching(/continuação da sessão interrompida/) })
  })

  it.each([
    ['o ramo não existe na pasta', { commitLocal: null }, /não há trabalho salvo/],
    ['não deu para consultar o GitHub', { inconclusiva: true }, /sem medir/],
    ['o ramo já está no GitHub', { commitNoRemoto: 'f00' }, /já está no GitHub/],
  ])('recusa quando %s', (_caso, entrega, motivo) => {
    const v = avaliarPreviaDaSessao(previaDaRetomada(entrega), 'irrelevante')
    expect(v.ok).toBe(false)
    expect(v.motivo).toMatch(motivo)
  })

  it('fora da sandbox, retomar recusa', () => {
    const r = previaDaRetomada()
    const semSandbox = { ...r, path: 'C:/Users/x/repo', previa: { ...r.previa!, regime: undefined } }
    expect(avaliarPreviaDaSessao(semSandbox, 'C:/Users/x')).toMatchObject({ ok: false, motivo: expect.stringMatching(/só funciona na sandbox/) })
  })

  it('sem retomada, o ramo existir continua sendo recusa (regra de antes)', () => {
    const r = previaDaRetomada()
    const normal = { ...r, previa: { ...r.previa!, retomada: undefined } }
    expect(avaliarPreviaDaSessao(normal, 'irrelevante')).toMatchObject({ ok: false, motivo: expect.stringMatching(/já existe antes da execução/) })
  })
})

describe('o resumo diz quais cartões incertos podem ser retomados', () => {
  it('só o envelope incerto cuja sessão foi interrompida', async () => {
    const { service, prisma } = montar()
    const incerto = (id: string, sessionId: string) => ({
      id, name: id, status: 'effect_unknown', motivo: null, updatedAt: new Date(),
      effects: [{ actionKey: EFEITO_SESSAO, payload: { ...PAYLOAD, sessionId } }],
    })
    ;(prisma.projectHandoff as Record<string, jest.Mock>).findMany = jest.fn().mockResolvedValue([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([incerto('h-cortado', ANTIGA), incerto('h-outro', 'cmoutra000001')])
    ;(prisma.agentSession as Record<string, jest.Mock>).findMany = jest.fn().mockResolvedValue([])
      .mockResolvedValueOnce([{ id: ANTIGA }])

    const r = await service.resumo('proj-1')
    const porId = Object.fromEntries(r.precisaDeVoce.map((l) => [l.id, l.retomavel]))
    expect(porId).toEqual({ 'h-cortado': true, 'h-outro': false })
  })
})
