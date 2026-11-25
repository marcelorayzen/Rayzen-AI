import { BadRequestException, ConflictException } from '@nestjs/common'
import { HandoffService, nasceuNoHub, resumoDaVerificacao, ultimaLinhaDoLog } from '../handoff.service'
import { chaveDeIdempotencia, hashDoConteudo, ConteudoDoHandoff } from '../handoff.const'

const conteudo: ConteudoDoHandoff = {
  name: 'Projeto X',
  brief: 'Um sistema para medir o que hoje é palpite.',
  template: 'rayzen',
  root: 'C:/Users/dev/Projects',
  efeitos: [{ actionKey: 'jarvis:create_project_folder', payload: { name: 'Projeto X', template: 'rayzen' } }],
}

/**
 * O hash GRAVADO sempre inclui o isolamento derivado do catálogo — o serviço o acrescenta
 * antes de hashear. Calcular sem ele aqui faria o fixture discordar do que `criar()` persiste,
 * e um `editar()` com conteúdo idêntico pareceria revisão.
 */
const HASH_GRAVADO = hashDoConteudo({ ...conteudo, isolamento: 'nenhum' })

function build(inicial: Record<string, unknown> = {}) {
  const linha = {
    id: 'h1',
    version: 1,
    status: 'draft',
    contentHash: HASH_GRAVADO,
    effects: conteudo.efeitos,
    root: conteudo.root,
    name: conteudo.name,
    createdBy: 'agent',
    approvalId: 'ap-1',
    ...inicial,
  }
  const prisma = {
    projectHandoff: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...linha, ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...linha, ...data })),
      findUnique: jest.fn().mockResolvedValue(linha),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Vigente e não consumida — o estado de um envelope recém-aprovado.
    executionApproval: {
      findUnique: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 9 * 60_000), consumedAt: null }),
    },
  }
  const approvals = { criar: jest.fn().mockResolvedValue({ id: 'ap-1' }) }
  const execution = {
    enqueue: jest.fn().mockResolvedValue('task-1'),
    // A previa roda ANTES de materializar. O padrao aqui e o caminho limpo: pasta nao
    // existe, projeto nao registrado.
    dispatch: jest.fn().mockResolvedValue({
      path: 'C:/Users/dev/Projects/Projeto X',
      previa: { acao: 'criar', pastaJaExiste: false, projetoJaRegistrado: null },
    }),
  }
  const service = new HandoffService(prisma as never, approvals as never, execution as never)
  return { service, prisma, approvals, execution, linha }
}

describe('HandoffService — o envelope não deixa pular etapa', () => {
  /**
   * O pulo que o envelope existe para impedir. Sem ele, "aprovado" seria um rótulo e a
   * materialização aconteceria com o aceite de ninguém.
   */
  it('não materializa o que não foi aprovado', async () => {
    for (const status of ['draft', 'awaiting_approval', 'rejected', 'cancelled']) {
      const { service, execution } = build({ status })
      await expect(service.materializar('h1')).rejects.toBeInstanceOf(ConflictException)
      expect(execution.enqueue).not.toHaveBeenCalled()
    }
  })

  it('não aprova o que não foi submetido', async () => {
    const { service, approvals } = build({ status: 'draft' })
    await expect(service.aprovar('h1', { id: 'admin', type: 'humano' })).rejects.toBeInstanceOf(ConflictException)
    expect(approvals.criar).not.toHaveBeenCalled()
  })

  /**
   * A autorização é emitida com o alvo EXATO — ação, recurso e argumentos. O `argsHash` do
   * `ExecutionApproval` cobre os três, então trocar o payload depois do aceite invalida a
   * aprovação sozinho, sem precisar de uma segunda checagem aqui.
   */
  it('aprovar emite autorização ligada ao efeito e ao conteúdo', async () => {
    const { service, approvals, prisma } = build({ status: 'awaiting_approval' })

    await service.aprovar('h1', { id: 'admin', type: 'humano' })

    // O alvo e derivado pela regra COMPARTILHADA com o agent: `resource` sai do payload
    // (`path` ?? `root`) e `args` e o payload inteiro. Descreve-lo de outro jeito aqui faria o
    // hash nunca casar no consumo — a aprovacao existiria e nao serviria.
    expect(approvals.criar).toHaveBeenCalledWith(
      {
        actionKey: 'jarvis:create_project_folder',
        actor: 'desktop',
        resource: conteudo.root,
        args: expect.objectContaining({
          handoffId: 'h1',
          root: conteudo.root,
          contentHash: HASH_GRAVADO,
        }),
      },
      { id: 'admin', type: 'humano' },
    )
    expect(prisma.projectHandoff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'approved', approvalId: 'ap-1', approvedBy: 'admin' }),
    }))
  })

  /**
   * Repetição não duplica pasta nem registro: a chave vem do handoff e da versão, então a
   * reentrega do mesmo envelope é replay no broker em vez de uma segunda materialização.
   */
  it('materializar enfileira pelo broker com chave derivada do envelope', async () => {
    const { service, execution } = build({ status: 'approved', version: 3 })

    await service.materializar('h1')

    expect(execution.enqueue).toHaveBeenCalledWith(
      'create_project_folder',
      expect.objectContaining({ handoffId: 'h1', root: conteudo.root }),
      undefined,
      chaveDeIdempotencia('h1', 3),
    )
  })

  /**
   * Caso medido em 15/11: aprovado 02:20, prévia recusou, retomado 02:55 com a aprovação vencida
   * às 02:30. Enfileirar terminava em `failed_safe` sem rodar nada. Agora volta ao card.
   */
  describe('aprovação que não vale mais devolve o envelope ao card, sem enfileirar', () => {
    const casos: Array<[string, unknown, RegExp]> = [
      ['vencida', { expiresAt: new Date(Date.now() - 25 * 60_000), consumedAt: null }, /venceu/],
      ['vence durante a prévia', { expiresAt: new Date(Date.now() + 20_000), consumedAt: null }, /venceu/],
      ['já consumida', { expiresAt: new Date(Date.now() + 9 * 60_000), consumedAt: new Date() }, /já foi usada/],
      ['inexistente', null, /não tem aprovação/],
    ]
    it.each(casos)('%s', async (_nome, aprovacao, motivo) => {
      const { service, prisma, execution } = build({ status: 'approved' })
      prisma.executionApproval.findUnique.mockResolvedValue(aprovacao)

      await expect(service.materializar('h1')).rejects.toThrow(/renovada/)

      expect(execution.dispatch).not.toHaveBeenCalled()
      expect(execution.enqueue).not.toHaveBeenCalled()
      const data = prisma.projectHandoff.update.mock.calls.at(-1)![0].data
      expect(data).toMatchObject({ status: 'awaiting_approval', approvalId: null, approvedBy: null, approvedAt: null })
      expect(data.motivo).toMatch(motivo)
    })

    /** Sem `approvalId` nem se consulta o banco — e o envelope volta do mesmo jeito. */
    it('envelope approved sem approvalId', async () => {
      const { service, prisma, execution } = build({ status: 'approved', approvalId: null })
      await expect(service.materializar('h1')).rejects.toThrow(ConflictException)
      expect(prisma.executionApproval.findUnique).not.toHaveBeenCalled()
      expect(execution.enqueue).not.toHaveBeenCalled()
    })
  })

  /** `enqueue` monta `jarvis:<ação>`; mandar o prefixo produziria `jarvis:jarvis:...`. */
  it('o prefixo jarvis: não é enviado duas vezes', async () => {
    const { service, execution } = build({ status: 'approved' })
    await service.materializar('h1')
    expect(execution.enqueue.mock.calls[0][0]).toBe('create_project_folder')
  })

  /**
   * Editar depois de submetido invalida o aceite POR CONSTRUÇÃO — a versão sobe, o hash muda,
   * e a chave de idempotência deixa de casar com a execução anterior.
   */
  it('editar sobe a versão, volta para rascunho e derruba a aprovação', async () => {
    const { service, prisma } = build({ status: 'awaiting_approval', approvalId: 'ap-antiga', approvedBy: 'admin' })

    await service.editar('h1', { ...conteudo, brief: 'outro brief' }, 'marcelo')

    expect(prisma.projectHandoff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        version: 2, status: 'draft', approvalId: null, approvedBy: null, approvedAt: null,
      }),
    }))
  })

  /**
   * E reenviar o MESMO conteúdo não é revisão: subir versão por um PUT repetido invalidaria um
   * aceite legítimo, que é o falso negativo que faz alguém parar de usar o fluxo.
   */
  it('reenviar conteúdo idêntico no rascunho não sobe versão', async () => {
    const { service, prisma } = build({ status: 'draft' })
    const r = await service.editar('h1', conteudo, 'marcelo')
    expect(prisma.projectHandoff.update).not.toHaveBeenCalled()
    expect(r.version).toBe(1)
  })

  it('não edita depois de aprovado — o caminho é cancelar e refazer', async () => {
    const { service } = build({ status: 'approved' })
    await expect(service.editar('h1', { ...conteudo, brief: 'x' }, 'marcelo'))
      .rejects.toBeInstanceOf(ConflictException)
  })

  it('envelope sem efeito não é aceito — ele não autorizaria nada', async () => {
    const { service } = build()
    await expect(service.criar({ ...conteudo, efeitos: [] }, 'agent')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('efeito fora do vocabulário do agent é recusado na criação', async () => {
    const { service } = build()
    await expect(service.criar({ ...conteudo, efeitos: [{ actionKey: 'rm -rf /', payload: {} }] }, 'agent'))
      .rejects.toBeInstanceOf(BadRequestException)
  })

  /**
   * ── Um efeito por envelope, e a recusa é na ESCRITA ────────────────────────
   *
   * Decidido em 25/09: vários efeitos são vários envelopes. Aceitar o rascunho com dois e
   * reprovar só no aceite deixaria os efeitos 2..N dentro do hash do conteúdo sem nenhum
   * caminho para executar — o autor descobriria a regra depois de escrever o brief inteiro.
   */
  it('dois efeitos no mesmo envelope não são aceitos na criação', async () => {
    const { service } = build()
    await expect(service.criar({
      ...conteudo,
      efeitos: [
        { actionKey: 'jarvis:create_project_folder', payload: { name: 'Projeto X' } },
        { actionKey: 'jarvis:open_vscode', payload: { path: 'C:/Users/dev/Projects/x' } },
      ],
    }, 'agent')).rejects.toThrow(/um efeito por envelope/)
  })


  /**
   * ── Reconciliar antes de materializar ──────────────────────────────────────
   *
   * A previa roda primeiro, e o efeito real so vai para a fila depois dela. Sem isto, a fase
   * prometeria "filesystem, catalogo e Git reconciliados antes de abrir o VS Code" e entregaria
   * uma execucao as cegas.
   */
  it('a previa roda antes, e em dryRun', async () => {
    const { service, execution } = build({ status: 'approved' })

    await service.materializar('h1')

    expect(execution.dispatch).toHaveBeenCalledWith(
      'create_project_folder',
      expect.objectContaining({ dryRun: true, handoffId: 'h1' }),
    )
    // E o efeito real NAO pode levar o dryRun junto.
    expect(execution.enqueue.mock.calls[0][1]).not.toHaveProperty('dryRun')
  })

  it('o que a previa encontrou fica gravado junto com a tarefa', async () => {
    const { service, prisma } = build({ status: 'approved' })

    await service.materializar('h1')

    expect(prisma.projectHandoff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'queued',
        preflight: expect.objectContaining({ previa: expect.anything() }),
      }),
    }))
  })

  /**
   * O projeto ja tem checkout em outro lugar: materializar criaria uma segunda pasta para o
   * mesmo projeto. O envelope FICA em `approved` — a autorizacao continua valida e a tentativa
   * pode ser repetida depois de resolver o conflito.
   */
  it('previa que recusa impede a fila e preserva o aceite', async () => {
    const { service, execution, prisma } = build({ status: 'approved' })
    execution.dispatch.mockResolvedValue({
      path: 'C:/Users/dev/Projects/Projeto X',
      previa: { acao: 'criar', projetoJaRegistrado: { id: 'p1', checkoutPath: 'D:/outro/Projeto X' } },
    })

    await expect(service.materializar('h1')).rejects.toBeInstanceOf(ConflictException)

    expect(execution.enqueue).not.toHaveBeenCalled()
    const gravado = prisma.projectHandoff.update.mock.calls[0][0].data
    expect(gravado.status).toBeUndefined()
    expect(gravado.motivo).toMatch(/segunda pasta/)
  })

  /** Previa que nao completa nao autoriza: ausencia de resposta nao e permissao. */
  it('previa que falha nao deixa materializar', async () => {
    const { service, execution } = build({ status: 'approved' })
    execution.dispatch.mockRejectedValue(new Error('Agent desktop offline (nunca visto)'))

    await expect(service.materializar('h1')).rejects.toBeInstanceOf(ConflictException)
    expect(execution.enqueue).not.toHaveBeenCalled()
  })

  it('cancelar vale na fila e não depois de reivindicado', async () => {
    const naFila = build({ status: 'queued' })
    await expect(naFila.service.cancelar('h1', 'mudei de ideia')).resolves.toMatchObject({ status: 'cancelled' })

    const executando = build({ status: 'executing' })
    await expect(executando.service.cancelar('h1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('estado final não aceita nova transição', async () => {
    const { service } = build({ status: 'completed' })
    await expect(service.cancelar('h1')).rejects.toBeInstanceOf(ConflictException)
  })
})

/**
 * ── Quem pede não escolhe a própria proteção ────────────────────────────────
 *
 * Se o produtor declarasse o isolamento, a entrada escolheria a própria defesa — é a lição do
 * A08 na forma mais direta. O valor vem do catálogo e entra no hash, porque a aprovação se
 * refere a um efeito rodando sob um isolamento específico.
 */
describe('HandoffService — isolamento vem do catálogo', () => {
  it('grava o isolamento declarado, sem o corpo pedir', async () => {
    const { service, prisma } = build()

    await service.criar(conteudo, 'agent')

    expect(prisma.projectHandoff.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isolamento: 'nenhum' }),
    }))
  })

  it('preserva o projeto de origem separado do projeto que sera materializado', async () => {
    const { service, prisma } = build()
    ;(prisma as any).project = { findUnique: jest.fn().mockResolvedValue({ id: 'project-origem' }) }

    await service.criar({ ...conteudo, sourceProjectId: 'project-origem' }, 'agent')

    expect((prisma as any).project.findUnique).toHaveBeenCalledWith({ where: { id: 'project-origem' }, select: { id: true } })
    expect(prisma.projectHandoff.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceProjectId: 'project-origem' }),
    }))
  })

  /** Recusar em voz alta, não ignorar: quem mandou o campo acredita estar pedindo proteção. */
  it('recusa quando o corpo tenta declarar isolamento diferente', async () => {
    const { service, prisma } = build()

    await expect(service.criar({ ...conteudo, isolamento: 'worktree' }, 'agent'))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.projectHandoff.create).not.toHaveBeenCalled()
  })

  it('aceita quando o corpo repete exatamente o que o catálogo declara', async () => {
    const { service } = build()
    await expect(service.criar({ ...conteudo, isolamento: 'nenhum' }, 'agent')).resolves.toBeTruthy()
  })

  /** Efeito sem isolamento declarado é erro — ausência não é permissão. */
  it('recusa efeito que o catálogo não conhece', async () => {
    const { service } = build()
    await expect(service.criar({
      ...conteudo,
      efeitos: [{ actionKey: 'jarvis:acao_inexistente', payload: {} }],
    }, 'agent')).rejects.toBeInstanceOf(BadRequestException)
  })

  /** O isolamento entra no hash: trocá-lo mudaria o que foi autorizado sem mudar o id. */
  it('isolamento diferente produz conteúdo diferente', () => {
    expect(hashDoConteudo({ ...conteudo, isolamento: 'worktree' }))
      .not.toBe(hashDoConteudo({ ...conteudo, isolamento: 'nenhum' }))
  })
})

/**
 * S1 (15/11): a alçada decide quem aprova. O mock aqui guarda estado de verdade — com o
 * `findUnique` fixo dos outros casos, enviar e aprovar enxergariam sempre o rascunho.
 */
describe('HandoffService — alçada autônoma ao enviar', () => {
  function comEstado(efeitos: { actionKey: string; payload: Record<string, unknown> }[]) {
    const { service, prisma, approvals, execution } = build({ effects: efeitos })
    let atual: Record<string, unknown> = { ...(prisma.projectHandoff.findUnique.mock.results[0]?.value ?? {}) }
    prisma.projectHandoff.findUnique.mockReset()
    const base = { id: 'h1', version: 1, status: 'draft', contentHash: HASH_GRAVADO, effects: efeitos, root: conteudo.root, name: 'X', createdBy: 'agent', approvalId: null }
    atual = { ...base }
    prisma.projectHandoff.findUnique.mockImplementation(() => Promise.resolve({ ...atual }))
    prisma.projectHandoff.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      atual = { ...atual, ...data }
      return Promise.resolve({ ...atual })
    })
    return { service, approvals, execution, estado: () => atual }
  }

  it('efeito autônomo é aprovado pela política — e sem prévia conhecida, nada é despachado', async () => {
    const { service, approvals, execution, estado } = comEstado([{ actionKey: 'jarvis:open_url', payload: { url: 'https://example.com' } }])
    const r = await service.submeter('h1')
    // O registro diz QUEM aprovou: a política, nunca uma pessoa inventada.
    expect(approvals.criar.mock.calls[0][1]).toEqual({ id: 'alcada:autonomo', type: 'policy' })
    expect(estado().approvedBy).toBe('alcada:autonomo')
    // `open_url` não tem prévia: despachar com dryRun poderia abrir a URL. Recusa dita, sem execução.
    expect(r).toMatchObject({ alcada: 'autonomo', materializado: false })
    expect((r as { motivo?: string }).motivo).toMatch(/não tem prévia conhecida/)
    expect(execution.dispatch).not.toHaveBeenCalled()
    expect(execution.enqueue).not.toHaveBeenCalled()
  })

  it('materializar recusa efeito sem prévia antes de despachar qualquer coisa', async () => {
    const { service, execution } = build({ status: 'approved', effects: [{ actionKey: 'jarvis:file_delete', payload: {} }] })
    await expect(service.materializar('h1')).rejects.toThrow(/não tem prévia conhecida/)
    expect(execution.dispatch).not.toHaveBeenCalled()
  })

  it('efeito que propõe fica aguardando uma pessoa', async () => {
    const { service, approvals, execution, estado } = comEstado(conteudo.efeitos)
    const r = await service.submeter('h1')
    expect(r).toMatchObject({ alcada: 'propoe', status: 'awaiting_approval' })
    expect(estado().status).toBe('awaiting_approval')
    expect(approvals.criar).not.toHaveBeenCalled()
    expect(execution.enqueue).not.toHaveBeenCalled()
  })

  it('efeito crítico fica aguardando, e efeito desconhecido também', async () => {
    for (const actionKey of ['jarvis:file_delete', 'jarvis:acao_inventada']) {
      const { service, approvals } = comEstado([{ actionKey, payload: {} }])
      const r = await service.submeter('h1')
      expect(r).toMatchObject({ alcada: 'critico', status: 'awaiting_approval' })
      expect(approvals.criar).not.toHaveBeenCalled()
    }
  })
})

/** S1e (15/11): descartar pelo Hub, que antes só saía por SQL. */
describe('HandoffService — descartar e resumo', () => {
  it('efeito incerto vai a failed_safe, dizendo que uma pessoa conferiu', async () => {
    const { service, prisma } = build({ status: 'effect_unknown' })
    await service.descartar('h1', { id: 'hub:abc' })
    expect(prisma.projectHandoff.update.mock.calls[0][0].data).toMatchObject({
      status: 'failed_safe', motivo: expect.stringContaining('conferido à mão'),
    })
  })

  it('aceite que não vai rodar é cancelado', async () => {
    for (const status of ['approved', 'queued']) {
      const { service, prisma } = build({ status })
      await service.descartar('h1', { id: 'hub:abc' })
      expect(prisma.projectHandoff.update.mock.calls[0][0].data.status).toBe('cancelled')
    }
  })

  it('o que roda, aguarda aprovação ou já terminou não se descarta por aqui', async () => {
    for (const status of ['executing', 'claimed', 'awaiting_approval', 'draft', 'completed']) {
      const { service, prisma } = build({ status })
      await expect(service.descartar('h1', { id: 'hub:abc' })).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.projectHandoff.update).not.toHaveBeenCalled()
    }
  })

  it('o resumo separa o que fiz sozinho, o que proponho e o que parou', async () => {
    const { service, prisma } = build()
    const linha = (id: string, status: string, actionKey: string) => ({
      id, name: id, status, motivo: null, updatedAt: new Date(), effects: [{ actionKey, payload: {} }],
    })
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([linha('a', 'approved', 'jarvis:open_url')])
      .mockResolvedValueOnce([linha('b', 'awaiting_approval', 'jarvis:supervised_session')])
      .mockResolvedValueOnce([linha('c', 'effect_unknown', 'jarvis:create_project_folder')])
    const r = await service.resumo('p1')
    expect(r.fizSozinho.map((x) => x.id)).toEqual(['a'])
    expect(r.proponho[0]).toMatchObject({ id: 'b', alcada: 'propoe' })
    expect(r.precisaDeVoce[0]).toMatchObject({ id: 'c', status: 'effect_unknown' })
    // "Fiz sozinho" vem do registro de quem aprovou — nunca do status nem da redação do modelo.
    expect(prisma.projectHandoff.findMany.mock.calls[0][0].where).toMatchObject({ approvedBy: 'alcada:autonomo', sourceProjectId: 'p1' })
  })
})

describe('HandoffService — prévia da sessão no envio (S1f)', () => {
  const sessao = [{ actionKey: 'jarvis:supervised_session', payload: { projectId: 'p1', prompt: 'x', publicar: true } }]

  it('roda a prévia em dryRun e grava, sem enfileirar nada', async () => {
    const { service, prisma, execution } = build({ effects: sessao })
    execution.dispatch.mockResolvedValue({ path: 'C:/p', previa: { tipo: 'sessao_supervisionada', remoto: null } })
    await service.submeter('h1')
    expect(execution.dispatch.mock.calls[0][0]).toBe('supervised_session')
    expect(execution.dispatch.mock.calls[0][1]).toMatchObject({ dryRun: true, handoffId: 'h1' })
    expect(execution.enqueue).not.toHaveBeenCalled()
    const gravou = prisma.projectHandoff.update.mock.calls.find((c: [{ data: Record<string, unknown> }]) => 'preflight' in c[0].data)
    expect(gravou?.[0].data.preflight).toMatchObject({ previa: { remoto: null } })
  })

  it('agent fora: grava o erro e o envelope segue aguardando', async () => {
    const { service, prisma, execution } = build({ effects: sessao })
    execution.dispatch.mockRejectedValue(new Error('agent offline'))
    const r = await service.submeter('h1')
    expect(r).toMatchObject({ status: 'awaiting_approval' })
    const gravou = prisma.projectHandoff.update.mock.calls.find((c: [{ data: Record<string, unknown> }]) => 'preflight' in c[0].data)
    expect(gravou?.[0].data.preflight).toEqual({ error: 'agent offline' })
  })

  it('criar projeto não roda prévia no envio', async () => {
    const { service, execution } = build()
    await service.submeter('h1')
    expect(execution.dispatch).not.toHaveBeenCalled()
  })
})

describe('HandoffService — pergunta da sessão no fio (S1d)', () => {
  it('traz a pergunta da sessão em curso deste projeto, com as opções', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'h9', name: 'Sessão X', effects: [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 's1' } }] }])
    const agentSession = { findMany: jest.fn().mockResolvedValue([{
      id: 's1', status: 'waiting', pendingQuestion: 'Posso publicar o PR?', pendingRequiresApproval: true,
      pendingApprovalOptions: ['Aprovado, continue', 'Rejeitar e corrigir'], updatedAt: new Date(),
    }]) }
    Object.assign(prisma, { agentSession })
    const r = await service.resumo('p1')
    expect(r.perguntas).toEqual([expect.objectContaining({
      sessionId: 's1', handoffId: 'h9', pergunta: 'Posso publicar o PR?', exigeAprovacao: true,
      opcoes: ['Aprovado, continue', 'Rejeitar e corrigir'],
    })])
    // Só as sessões dos envelopes deste fio — nunca uma busca global por sessões esperando.
    expect(agentSession.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['s1'] }, status: 'waiting' })
    expect(prisma.projectHandoff.findMany.mock.calls[3][0].where).toMatchObject({ sourceProjectId: 'p1' })
  })

  it.each([
    ['https://preview.example.com', 'https://preview.example.com'],
    [null, null],
    ['http://preview.example.com', null],
    ['javascript:alert(1)', null],
  ])('o link da prévia vai junto com a pergunta (%s → %s)', async (previewUrl, esperado) => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'h9', name: 'Sessão X', effects: [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 's1' } }] }])
    Object.assign(prisma, { agentSession: { findMany: jest.fn().mockResolvedValue([{
      id: 's1', status: 'waiting', pendingQuestion: 'Posso publicar o PR?', pendingRequiresApproval: true,
      pendingApprovalOptions: null, previewUrl, updatedAt: new Date(),
    }]) } })
    const r = await service.resumo('p1')
    expect(r.perguntas[0].previa).toBe(esperado)
  })

  it('sem sessão em curso, não consulta sessões', async () => {
    const { service, prisma } = build()
    const agentSession = { findMany: jest.fn() }
    Object.assign(prisma, { agentSession })
    const r = await service.resumo('p1')
    expect(r.perguntas).toEqual([])
    expect(agentSession.findMany).not.toHaveBeenCalled()
  })
})

describe('HandoffService — entregas com link (S1c)', () => {
  it('inclui autoria e métricas da sessão vinculada à entrega confirmada', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'sessao-handoff',
        name: 'Sessão A',
        effects: [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 'session-1' } }],
        delivery: { branch: 'rayzen/a', commit: 'abc12345', publicado: true, prUrl: 'https://github.com/x/y/pull/7' },
      }])
    const agentSession = {
      findMany: jest.fn().mockResolvedValue([{
        id: 'session-1', papel: 'developer', provedor: 'claude-code', modelo: 'claude-sonnet',
        costUsd: 0.42, numTurns: 12,
      }]),
    }
    Object.assign(prisma, { agentSession })

    const r = await service.resumo('p1')

    expect(r.entregas[0]).toMatchObject({
      handoffId: 'sessao-handoff',
      sessao: {
        papel: 'developer',
        provedor: 'claude-code',
        modelo: 'claude-sonnet',
        costUsd: 0.42,
        numTurns: 12,
      },
    })
    expect(agentSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['session-1'] } },
      select: { id: true, papel: true, provedor: true, modelo: true, costUsd: true, numTurns: true, testVerification: true },
    }))
  })

  it('traz o link do PR confirmado, sem o remoto e sem link que não seja PR do GitHub', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'a', name: 'Sessão A', delivery: { branch: 'rayzen/a', commit: 'abc12345', publicado: true, remoto: 'https://u:tok@github.com/x/y.git', prUrl: 'https://github.com/x/y/pull/7' } },
        { id: 'b', name: 'Sessão B', delivery: { branch: 'rayzen/b', commit: 'def', prUrl: 'javascript:alert(1)' } },
        { id: 'c', name: 'Projeto C', delivery: null },
      ])
    const r = await service.resumo('p1')
    expect(r.entregas.map((e) => e.handoffId)).toEqual(['a', 'b'])
    expect(r.entregas[0].entrega).toMatchObject({ prUrl: 'https://github.com/x/y/pull/7', branch: 'rayzen/a' })
    expect(JSON.stringify(r.entregas)).not.toContain('tok@')
    expect(r.entregas[1].entrega?.prUrl).toBeNull()
    expect(prisma.projectHandoff.findMany.mock.calls[4][0].where).toMatchObject({ status: 'completed', sourceProjectId: 'p1' })
  })
})

describe('HandoffService — entrega diz quem aprovou e o que o Rayzen testou (G2.10)', () => {
  it('traz approvedBy do envelope e o resumo da verificação da sessão', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'h1', name: 'Sessão A', approvedBy: 'hub:8c6976e5b541',
        effects: [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 's1' } }],
        delivery: { branch: 'rayzen/a', commit: 'abc12345', publicado: true, prUrl: 'https://github.com/x/y/pull/7' },
      }])
    Object.assign(prisma, { agentSession: { findMany: jest.fn().mockResolvedValue([{
      id: 's1', papel: 'developer', provedor: 'claude-code', modelo: 'm', costUsd: null, numTurns: 3,
      testVerification: { status: 'passou', comando: 'npm test', codigo: 0, duracaoMs: 9000, ultimasLinhas: ['ok'] },
    }]) } })

    const r = await service.resumo('p1')

    expect(r.entregas[0]).toMatchObject({
      aprovadoPor: 'hub:8c6976e5b541',
      verificacao: { status: 'passou', comando: 'npm test' },
    })
  })

  it.each([
    [{ status: 'falhou', comando: 'npm test' }, { status: 'falhou', comando: 'npm test' }],
    [{ status: 'não verificado', comando: '' }, { status: 'não verificado', comando: '' }],
    [{ status: 'ok' }, null],
    [null, null],
    [['passou'], null],
  ])('verificação %j vira %j — formato desconhecido nunca vira "passou"', (bruto, esperado) => {
    expect(resumoDaVerificacao(bruto)).toEqual(esperado)
  })
})

describe('HandoffService — o que está rodando agora (G2.9)', () => {
  it('lista o envelope em execução com etapa, pergunta e link do VS Code da sessão', async () => {
    const { service, prisma } = build()
    prisma.projectHandoff.findMany
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'h7', name: 'Rodapé com versão', status: 'executing', updatedAt: new Date('2026-11-24T15:00:00Z'),
        effects: [{ actionKey: 'jarvis:supervised_session', payload: { sessionId: 's7' } }],
      }])
    const agentSession = { findMany: jest.fn().mockResolvedValue([{
      id: 's7', status: 'active', pendingQuestion: null,
      liveLog: '\n[pasta da sessão pronta]\n🔧 Edit src/App.tsx\n\n',
      vscodeUrl: 'vscode://vscode-remote/ssh-remote+rayzen@192.0.2.10/home/rayzen/workspaces/m/sessao-s7',
    }]) }
    Object.assign(prisma, { agentSession })

    const r = await service.resumo('p1')

    expect(r.emAndamento).toEqual([{
      id: 'h7', name: 'Rodapé com versão', status: 'executing', quando: new Date('2026-11-24T15:00:00Z'),
      sessao: {
        id: 's7', status: 'active', etapa: '🔧 Edit src/App.tsx', aguardandoResposta: false,
        vscodeUrl: 'vscode://vscode-remote/ssh-remote+rayzen@192.0.2.10/home/rayzen/workspaces/m/sessao-s7',
      },
    }])
    // Só os estados em que o executor está com o envelope, e só deste projeto.
    expect(prisma.projectHandoff.findMany.mock.calls[5][0].where).toEqual({
      sourceProjectId: 'p1', status: { in: ['queued', 'claimed', 'executing', 'reconciling'] },
    })
  })

  it('etapa é a última linha não vazia do log, sem ANSI e cortada', () => {
    expect(ultimaLinhaDoLog(null)).toBeNull()
    expect(ultimaLinhaDoLog('\n\n')).toBeNull()
    expect(ultimaLinhaDoLog('a\r\n\u001b[32mb verde\u001b[0m\r\n')).toBe('b verde')
    expect(ultimaLinhaDoLog('x'.repeat(300))).toHaveLength(160)
  })
})

describe('HandoffService — envelope nascido no Hub entra no fio sozinho (G2.11)', () => {
  function montar(fios: Array<{ id: string }>, upsert = jest.fn().mockResolvedValue({})) {
    const { service, prisma } = build()
    const hubThread = { findMany: jest.fn().mockResolvedValue(fios) }
    Object.assign(prisma, {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-m' }) },
      hubThread, hubWorkItem: { upsert },
    })
    return { service, prisma, hubThread, upsert }
  }
  const doProjeto = { ...conteudo, sourceProjectId: 'proj-m' }

  it.each(['mcp:hermes', 'rotina:b98cc911-e8d2-4cb5-9c52-e963c8198085', 'hub:8c6976e5b541'])(
    '%s: vincula ao único fio de pessoa do projeto', async (criador) => {
      const { service, hubThread, upsert } = montar([{ id: 'fio-1' }])
      await service.criar(doProjeto, criador)
      // O fio é achado pelo projeto, só de pessoa (nunca `service:*`), ativo e de escopo de projeto.
      expect(hubThread.findMany.mock.calls[0][0].where).toEqual({
        projectId: 'proj-m', scopeType: 'project', status: 'active', NOT: { principalId: { startsWith: 'service:' } },
      })
      expect(upsert).toHaveBeenCalledWith({
        where: { threadId_sourceSystem_sourceId: { threadId: 'fio-1', sourceSystem: 'v1', sourceId: 'h1' } },
        create: { threadId: 'fio-1', sourceSystem: 'v1', sourceId: 'h1', kind: 'project_handoff' },
        update: {},
      })
    })

  it('proposta de fora do Hub (Claude Code pelo MCP, agent) não é vinculada', async () => {
    for (const criador of ['agent', 'service:agent', 'mcp:claude-code', 'admin']) {
      const { service, hubThread, upsert } = montar([{ id: 'fio-1' }])
      await service.criar(doProjeto, criador)
      expect(hubThread.findMany).not.toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
    }
  })

  it('nenhum fio, ou mais de um, não se adivinha: fica sem vínculo', async () => {
    for (const fios of [[], [{ id: 'fio-1' }, { id: 'fio-2' }]]) {
      const { service, upsert } = montar(fios)
      await service.criar(doProjeto, 'mcp:hermes')
      expect(upsert).not.toHaveBeenCalled()
    }
  })

  it('falha no vínculo não desfaz a criação do envelope', async () => {
    const { service } = montar([{ id: 'fio-1' }], jest.fn().mockRejectedValue(new Error('banco fora')))
    await expect(service.criar(doProjeto, 'rotina:abc')).resolves.toMatchObject({ id: 'h1', createdBy: 'rotina:abc' })
  })

  it('envelope sem projeto de origem não procura fio', async () => {
    const { service, hubThread } = montar([{ id: 'fio-1' }])
    await service.criar(conteudo, 'mcp:hermes')
    expect(hubThread.findMany).not.toHaveBeenCalled()
  })

  it('nasceuNoHub não aceita parecidos', () => {
    expect(nasceuNoHub('mcp:hermes')).toBe(true)
    expect(nasceuNoHub('mcp:hermes2')).toBe(false)
    expect(nasceuNoHub('hub:XYZ')).toBe(false)
    expect(nasceuNoHub('rotina:')).toBe(false)
    expect(nasceuNoHub('rotina:a b')).toBe(false)
  })
})
