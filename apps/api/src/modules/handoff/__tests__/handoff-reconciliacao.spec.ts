import { ConflictException } from '@nestjs/common'
import { HandoffService } from '../handoff.service'
import { verificarEfeito } from '../handoff-preflight'
import { proximoEstadoDoHandoff } from '../handoff-sincronizacao'
import { podeTransicionar, hashDoConteudo, ConteudoDoHandoff } from '../handoff.const'
import { hashDoAlvo } from '../../execution/approval.service'
import { alvoDaExecucao } from '../../execution/alvo-de-execucao.const'

jest.mock('../../../common/system-heartbeat', () => ({ baterNaV2: jest.fn() }))

const conteudo: ConteudoDoHandoff = {
  name: 'Projeto X',
  brief: 'brief',
  template: 'rayzen',
  root: 'C:/Users/dev/Projects',
  efeitos: [{ actionKey: 'jarvis:create_project_folder', payload: { name: 'Projeto X' } }],
}

/**
 * ── Tarefa `done` é um relato, não uma prova ────────────────────────────────
 *
 * Esta casa já pagou por confundir os dois: em 17/08 os três serviços apareciam `Up (healthy)`
 * com a produção rodando código de nove horas antes. O envelope só fecha depois de perguntar
 * ao disco e ao catálogo se o efeito está lá.
 */
describe('verificarEfeito — três desfechos, não dois', () => {
  it('pasta no disco e projeto no catálogo confirmam o efeito', () => {
    const r = verificarEfeito({
      path: 'C:/x',
      previa: { pastaJaExiste: true, projetoJaRegistrado: { id: 'p1', checkoutPath: 'C:/x' } },
    })
    expect(r.estado).toBe('confirmado')
  })

  it('tarefa concluída sem pasta no disco é efeito AUSENTE, e pede uma pessoa', () => {
    const r = verificarEfeito({ path: 'C:/x', previa: { pastaJaExiste: false } })
    expect(r.estado).toBe('ausente')
    expect(r.motivo).toMatch(/nao existe no disco/)
  })

  it('pasta sem registro no catálogo é efeito pela metade', () => {
    const r = verificarEfeito({ path: 'C:/x', previa: { pastaJaExiste: true, projetoJaRegistrado: null } })
    expect(r.estado).toBe('ausente')
    expect(r.motivo).toMatch(/metade/)
  })

  it('não confirma catálogo sem checkout ou apontando para outra pasta', () => {
    for (const checkoutPath of [null, 'D:/outro/Projeto X']) {
      const r = verificarEfeito({
        path: 'C:/x',
        previa: { pastaJaExiste: true, projetoJaRegistrado: { id: 'p1', checkoutPath } },
      })
      expect(r.estado).toBe('ausente')
      expect(r.motivo).toMatch(/catalogo nao aponta/)
    }
  })

  it('não confirma postflight em caminho diferente do preflight aprovado', () => {
    const r = verificarEfeito({
      path: 'C:/x',
      previa: { pastaJaExiste: true, projetoJaRegistrado: { id: 'p1', checkoutPath: 'C:/x' } },
    }, undefined, 'C:/outro')
    expect(r.estado).toBe('ausente')
    expect(r.motivo).toMatch(/outro caminho/)
  })

  /**
   * Não conseguir olhar não autoriza afirmar nada. Colapsar isto em `ausente` mandaria alguém
   * investigar um efeito que talvez esteja perfeito — o mesmo erro que
   * `historico_serve_conversa` evita ao chamar de inconclusivo a falha de sondagem.
   */
  it.each([[null], [undefined], [{}]])('sem resposta é NÃO-VERIFICADO (%p)', (r) => {
    expect(verificarEfeito(r as never).estado).toBe('nao-verificado')
  })
})

function build(inicial: Record<string, unknown> = {}) {
  const linha = {
    id: 'h1', version: 1, status: 'reconciling',
    contentHash: hashDoConteudo(conteudo), effects: conteudo.efeitos,
    preflight: { path: 'C:/x' },
    approvalId: 'a1', approvedBy: 'approval-token:teste', taskId: 't1',
    root: conteudo.root, name: conteudo.name, createdBy: 'agent',
    ...inicial,
  }
  const carga = {
    ...conteudo.efeitos[0].payload, root: linha.root,
    handoffId: linha.id, contentHash: linha.contentHash,
  }
  const aprovacao = {
    argsHash: hashDoAlvo(alvoDaExecucao(conteudo.efeitos[0].actionKey, 'desktop', carga)),
    createdBy: 'approval-token:teste', consumedAt: new Date(), consumedByTask: 't1',
  }
  const prisma = {
    projectHandoff: {
      findUnique: jest.fn().mockResolvedValue(linha),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...linha, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    executionApproval: {
      findUnique: jest.fn().mockResolvedValue(aprovacao),
    },
  }
  const execution = {
    dispatch: jest.fn().mockResolvedValue({
      path: 'C:/x',
      previa: { pastaJaExiste: true, projetoJaRegistrado: { id: 'p1', checkoutPath: 'C:/x' } },
    }),
    enqueue: jest.fn(),
  }
  const service = new HandoffService(prisma as never, { criar: jest.fn() } as never, execution as never)
  return { service, prisma, execution, linha, aprovacao }
}

describe('HandoffService.reconciliar', () => {
  it('efeito confirmado fecha o envelope', async () => {
    const { service, prisma } = build()
    const r = await service.reconciliar('h1')

    expect(r.status).toBe('completed')
    expect(prisma.projectHandoff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', projectId: 'p1', postflight: expect.anything() }),
    }))
  })

  it('efeito ausente abre incerteza em vez de fechar', async () => {
    const { service, execution } = build()
    execution.dispatch.mockResolvedValue({ path: 'C:/x', previa: { pastaJaExiste: false } })

    const r = await service.reconciliar('h1')
    expect(r.status).toBe('effect_unknown')
  })

  it('não fecha nem vincula projeto se a verificação ocorreu em outro caminho', async () => {
    const { service, prisma } = build({ preflight: { path: 'C:/outro' } })
    const r = await service.reconciliar('h1')
    expect(r.status).toBe('effect_unknown')
    const gravado = prisma.projectHandoff.update.mock.calls[0][0].data
    expect(gravado.projectId).toBeUndefined()
    expect(gravado.motivo).toMatch(/outro caminho/)
  })

  it.each([
    ['sem consumo', { consumedAt: null }],
    ['outra tarefa', { consumedByTask: 'outra-tarefa' }],
    ['outro alvo', { argsHash: 'outro-hash' }],
    ['outro aprovador', { createdBy: 'outra-pessoa' }],
  ])('não fecha quando a aprovação não prova %s', async (_caso, alteracao) => {
    const { service, prisma, aprovacao } = build()
    prisma.executionApproval.findUnique.mockResolvedValue({ ...aprovacao, ...alteracao })

    const r = await service.reconciliar('h1')
    expect(r.status).toBe('effect_unknown')
    const gravado = prisma.projectHandoff.update.mock.calls[0][0].data
    expect(gravado.projectId).toBeUndefined()
    expect(gravado.motivo).toMatch(/aprovacao.*consumida/)
  })

  it('não fecha sem aprovação vinculada ao envelope', async () => {
    const { service, prisma } = build({ approvalId: null })
    const r = await service.reconciliar('h1')
    expect(r.status).toBe('effect_unknown')
    expect(prisma.executionApproval.findUnique).not.toHaveBeenCalled()
    expect(prisma.projectHandoff.update.mock.calls[0][0].data.projectId).toBeUndefined()
  })

  it('falha de leitura da aprovação conserva o envelope em reconciliação', async () => {
    const { service, prisma } = build()
    prisma.executionApproval.findUnique.mockRejectedValue(new Error('banco indisponivel'))

    const r = await service.reconciliar('h1')
    expect(r.status).toBe('reconciling')
    expect(prisma.projectHandoff.update.mock.calls[0][0].data.motivo).toMatch(/nao completou/)
  })

  /**
   * Não conseguir verificar NÃO move o envelope: ele fica em `reconciling` e a próxima
   * varredura tenta de novo. Mover para incerteza aqui inventaria um problema a partir de um
   * agent offline.
   */
  it('verificação que não completa deixa o envelope onde está', async () => {
    const { service, prisma, execution } = build()
    execution.dispatch.mockRejectedValue(new Error('Agent desktop offline'))

    const r = await service.reconciliar('h1')

    expect(r.status).toBe('reconciling')
    const gravado = prisma.projectHandoff.update.mock.calls[0][0].data
    expect(gravado.status).toBeUndefined()
    expect(gravado.motivo).toMatch(/nao completou/)
  })

  it('só reconcilia o que está em reconciliação', async () => {
    const { service } = build({ status: 'queued' })
    await expect(service.reconciliar('h1')).rejects.toBeInstanceOf(ConflictException)
  })
})

/**
 * ── A armadilha da ação rápida ─────────────────────────────────────────────
 *
 * O agent renova a posse a cada 20s, então uma ação que termina em 2s **nunca manda
 * batimento** e o envelope nunca passa por `executing`. Sem a aresta `claimed → reconciling`,
 * todo envelope de efeito rápido ficaria preso em `claimed` para sempre — e o sintoma seria
 * silêncio, não erro.
 */
describe('ação rápida não deixa o envelope preso', () => {
  it('claimed vai direto para reconciliação quando a tarefa conclui', () => {
    expect(podeTransicionar('claimed', 'reconciling')).toBe(true)
    expect(proximoEstadoDoHandoff('claimed', { tipo: 'status', status: 'done' })).toBe('reconciling')
  })

  it('e o caminho com batimento continua valendo', () => {
    expect(proximoEstadoDoHandoff('executing', { tipo: 'status', status: 'done' })).toBe('reconciling')
  })

  /** `done` não fecha mais o envelope sozinho — é o ponto da mudança. */
  it('tarefa concluída não leva direto a completed', () => {
    expect(proximoEstadoDoHandoff('executing', { tipo: 'status', status: 'done' })).not.toBe('completed')
  })

  /**
   * ── E a exceção, que é sobre quem decidiu ────────────────────────────────
   *
   * Vindo de `effect_unknown`, o `done` é a reconciliação HUMANA confirmando o efeito. Mandar
   * isso de volta para verificação faria uma checagem de máquina reabrir a decisão de quem
   * tinha a informação para decidir — e, pior, poderia contradizê-la.
   */
  it('confirmação humana fecha direto, sem nova verificação de máquina', () => {
    expect(proximoEstadoDoHandoff('effect_unknown', { tipo: 'status', status: 'done' })).toBe('completed')
  })
})

// O ciclo tem spec própria em `handoff-reconciliation.service.spec.ts` — a convenção do
// Guardian espera `X.service.ts` → `__tests__/X.service.spec.ts`, e ele bloqueou o push
// justamente porque estes casos moravam aqui. Este arquivo cobre as REGRAS; aquele, o ciclo.
