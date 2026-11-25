import { execFileSync } from 'child_process'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { supervisedSession } from '../supervised-session'
import { removerWorktree } from '../../exec/workspace-isolado'
import { criarProjetoTemporario, removerProjetoTemporario } from '../../test-utils/projeto-temporario'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function repoComCommit(): string {
  const dir = criarProjetoTemporario('supervised-deterministic')
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'teste@rayzen.local'], dir)
  git(['config', 'user.name', 'Teste'], dir)
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'fixture inicial'], dir)
  // `origin` fictício: publicar exige remoto (15/11), e `remote get-url` só lê a config.
  git(['remote', 'add', 'origin', 'https://example.invalid/fixture.git'], dir)
  return dir
}

describe('supervised-session — prova determinística sem conta Claude', () => {
  jest.setTimeout(30_000)

  let repo: string

  beforeEach(() => { repo = repoComCommit() })
  afterEach(() => { removerProjetoTemporario(repo) })

  // G6, fatia 4: no regime local, ignorar o baseRef abriria o PR contra `main` sem ninguém notar.
  it('baseRef no regime local é recusado em vez de ignorado', async () => {
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const executarModelo = jest.fn()

    const r = await supervisedSession({ sessionId: randomUUID(), prompt: 'x', projectPath: repo, baseRef: 'feature/pr-7' } as never,
      { executarModelo, postar })

    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/só funciona na sandbox/) })
    expect(executarModelo).not.toHaveBeenCalled()
  })

  it('entrega protocolo, prompt e workspace isolado ao executor e correlaciona o resultado', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const executarModelo = jest.fn().mockResolvedValue('Fixture concluída.\n[[RAYZEN:DONE]]')

    const resultado = await supervisedSession({
      sessionId,
      prompt: 'Crie uma alteração controlada',
      projectPath: repo,
    }, { executarModelo, postar })

    expect(executarModelo).toHaveBeenCalledTimes(1)
    const [contexto, cwd, idRecebido] = executarModelo.mock.calls[0]
    expect(contexto).toContain('[PROTOCOLO RAYZEN')
    // G4.2: o contrato do projeto vai junto, sempre — não depende de o modelo lembrar de ler.
    expect(contexto).toContain('[CONTRATO DO PROJETO]')
    expect(contexto).toMatch(/leia AGENTS\.md/)
    expect(contexto).toContain('Crie uma alteração controlada')
    expect(cwd).not.toBe(repo)
    expect(cwd).toContain(`rayzen-worktree-sessao-${sessionId.slice(0, 8)}`)
    expect(idRecebido).toBe(sessionId)
    expect(resultado).toMatchObject({ ok: true, sessionId })
    expect(postar).toHaveBeenCalledWith(
      `/agent/session/${sessionId}/complete`,
      expect.objectContaining({ summary: expect.stringContaining('Fixture concluída.') }),
    )
    expect(postar.mock.calls.some(([rota]) => String(rota).endsWith('/metrics'))).toBe(false)
  })

  it('mantém a aprovação humana entre etapas no mesmo fluxo usado em produção', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const aguardarResposta = jest.fn().mockResolvedValue('Aprovado, continue')
    const executarModelo = jest.fn()
      .mockResolvedValueOnce('Etapa preparada.\n[[RAYZEN:STEP_DONE]]')
      .mockResolvedValueOnce('Missão encerrada.\n[[RAYZEN:DONE]]')

    const resultado = await supervisedSession({
      sessionId,
      prompt: 'Execute em duas etapas',
      projectPath: repo,
    }, { executarModelo, postar, aguardarResposta })

    expect(resultado).toMatchObject({ ok: true, sessionId })
    expect(aguardarResposta).toHaveBeenCalledWith(sessionId)
    expect(executarModelo).toHaveBeenCalledTimes(2)
    expect(executarModelo.mock.calls[1][0]).toContain('O usuário APROVOU esta etapa')
    expect(postar).toHaveBeenCalledWith(
      `/agent/session/${sessionId}/question`,
      expect.objectContaining({ requiresApproval: true }),
    )
  })

  /**
   * 15/11: cada etapa começa sem a conversa anterior. A sessão recebeu "B" e depois "sim" sem
   * saber a que respondiam. A resposta só tem sentido junto com a pergunta.
   */
  it('a resposta chega à etapa seguinte junto com a pergunta que ela responde', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const aguardarResposta = jest.fn().mockResolvedValue('B')
    const executarModelo = jest.fn()
      .mockResolvedValueOnce('Dúvida.\n[[RAYZEN:QUESTION]] Conteúdo (a) só # ou (b) # Notas?')
      .mockResolvedValueOnce('Feito.\n[[RAYZEN:DONE]]')

    await supervisedSession({ sessionId, prompt: 'Crie NOTAS.MD', projectPath: repo }, { executarModelo, postar, aguardarResposta })

    const segunda = executarModelo.mock.calls[1][0] as string
    expect(segunda).toContain('(b) # Notas?')
    expect(segunda).toMatch(/Resposta do usuário a essa pergunta\]: B/)
  })

  it('o protocolo diz as regras de autorização do ambiente: sem cd, sem git -C, sem cat', async () => {
    const executarModelo = jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]')
    await supervisedSession({ sessionId: randomUUID(), prompt: 'x', projectPath: repo }, { executarModelo, postar: jest.fn().mockResolvedValue({ ok: true }) })
    const contexto = executarModelo.mock.calls[0][0] as string
    expect(contexto).toContain('Não use `cd` nem `git -C`')
    expect(contexto).toContain('`cat`, `head` e `tail` são negados')
  })

  /**
   * Item 7.3 (13/11): o envelope pode declarar aprovação POR ENTREGA. As etapas seguem sem
   * parar — e nada sai sem o portão do fim, que mostra o diff de TODAS as etapas.
   */
  describe('aprovação por entrega (7.3)', () => {
    it('etapas seguem sem esperar ninguém e nenhum pedido de aprovação é feito', async () => {
      const sessionId = randomUUID()
      const postar = jest.fn().mockResolvedValue({ ok: true })
      const aguardarResposta = jest.fn()
      const executarModelo = jest.fn()
        .mockResolvedValueOnce('Etapa 1.\n[[RAYZEN:STEP_DONE]]')
        .mockResolvedValueOnce('Etapa 2.\n[[RAYZEN:STEP_DONE]]')
        .mockResolvedValueOnce('Pronto.\n[[RAYZEN:DONE]]')

      const resultado = await supervisedSession({
        sessionId, prompt: 'Três passos', projectPath: repo, aprovacao: 'por_entrega',
      }, { executarModelo, postar, aguardarResposta })

      expect(resultado).toMatchObject({ ok: true, sessionId })
      expect(executarModelo).toHaveBeenCalledTimes(3)
      expect(aguardarResposta).not.toHaveBeenCalled()
      expect(postar).not.toHaveBeenCalledWith(`/agent/session/${sessionId}/question`, expect.anything())
      expect(executarModelo.mock.calls[1][0]).toContain('aprovado POR ENTREGA')
    })

    it('com publicar, para UMA vez — e o diff mostra o que todas as etapas mudaram', async () => {
      const sessionId = randomUUID()
      const postar = jest.fn().mockResolvedValue({ ok: true })
      const aguardarResposta = jest.fn().mockResolvedValue('Aprovado, publicar')
      const publicar = jest.fn().mockResolvedValue({ ok: false, motivo: 'teste', detalhe: 'sem remoto' })
      const executarModelo = jest.fn()
        .mockImplementationOnce(async (_p: string, cwd: string) => { writeFileSync(join(cwd, 'etapa-um.txt'), 'um\n'); git(['add', '.'], cwd); git(['commit', '-q', '-m', 'um'], cwd); return 'Etapa 1.\n[[RAYZEN:STEP_DONE]]' })
        .mockImplementationOnce(async (_p: string, cwd: string) => { writeFileSync(join(cwd, 'etapa-dois.txt'), 'dois\n'); git(['add', '.'], cwd); git(['commit', '-q', '-m', 'dois'], cwd); return 'Etapa 2.\n[[RAYZEN:STEP_DONE]]' })
        .mockResolvedValueOnce('Pronto.\n[[RAYZEN:DONE]]')

      await supervisedSession({
        sessionId, prompt: 'Dois arquivos', projectPath: repo, aprovacao: 'por_entrega', publicar: true,
      }, { executarModelo, postar, aguardarResposta, publicar })

      expect(aguardarResposta).toHaveBeenCalledTimes(1)
      const perguntas = postar.mock.calls.filter(([rota]) => rota === `/agent/session/${sessionId}/question`)
      expect(perguntas).toHaveLength(1)
      const { question, approvalOptions } = perguntas[0][1] as { question: string; approvalOptions: string[] }
      expect(approvalOptions).toEqual(['Aprovado, publicar', 'Não publicar'])
      expect(question).toContain('etapa-um.txt')
      expect(question).toContain('etapa-dois.txt')
    })

    it.each([['ausente', undefined], ['grafia diferente', 'POR_ENTREGA']])(
      'modo %s continua parando em cada etapa — só o literal libera',
      async (_caso, aprovacao) => {
        const sessionId = randomUUID()
        const aguardarResposta = jest.fn().mockResolvedValue('Aprovado, continue')
        const executarModelo = jest.fn()
          .mockResolvedValueOnce('Etapa.\n[[RAYZEN:STEP_DONE]]')
          .mockResolvedValueOnce('Pronto.\n[[RAYZEN:DONE]]')
        await supervisedSession({
          sessionId, prompt: 'x', projectPath: repo, aprovacao: aprovacao as 'por_entrega' | undefined,
        }, { executarModelo, postar: jest.fn().mockResolvedValue({}), aguardarResposta })
        expect(aguardarResposta).toHaveBeenCalledTimes(1)
      },
    )
  })

  it('publicar: true publica o branch da sessão e põe o link do PR no resumo', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const executarModelo = jest.fn().mockResolvedValue('Ajuste feito.\n[[RAYZEN:DONE]]')
    const publicar = jest.fn().mockResolvedValue({
      ok: true,
      entrega: {
        branch: `rayzen/sessao-${sessionId.slice(0, 8)}`, base: 'origin/main', commit: 'a'.repeat(40),
        commitsAFrente: 2, diffstat: '3 files changed', remoto: 'https://github.com/x/y.git',
        prUrl: 'https://github.com/x/y/pull/9',
      },
    })

    const aguardarResposta = jest.fn().mockResolvedValue('Aprovado, publicar')
    const resultado = await supervisedSession({
      sessionId, prompt: 'Corrigir cálculo\ncom detalhes', projectPath: repo, publicar: true,
    }, { executarModelo, postar, publicar, aguardarResposta })

    // A pessoa vê o diff ANTES de publicar, mesmo numa sessão que terminou de uma vez.
    expect(postar).toHaveBeenCalledWith(`/agent/session/${sessionId}/question`, expect.objectContaining({
      question: expect.stringContaining('Publicar esta entrega como PR em rascunho?'),
      requiresApproval: true,
      approvalOptions: ['Aprovado, publicar', 'Não publicar'],
    }))
    expect(publicar).toHaveBeenCalledTimes(1)
    const [repoPublicado, branch, pr] = publicar.mock.calls[0]
    expect(repoPublicado).toBe(repo)
    expect(branch).toBe(`rayzen/sessao-${sessionId.slice(0, 8)}`)
    expect(pr.titulo).toBe('Rayzen · Corrigir cálculo')
    expect(resultado).toMatchObject({ ok: true, publicacao: { ok: true } })
    expect(postar).toHaveBeenCalledWith(
      `/agent/session/${sessionId}/complete`,
      expect.objectContaining({
        summary: expect.stringContaining('https://github.com/x/y/pull/9'),
        entrega: expect.objectContaining({ prUrl: 'https://github.com/x/y/pull/9' }),
      }),
    )
  })

  it('sem publicar: true nada é publicado — efeito externo só quando o envelope pediu', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const publicar = jest.fn()

    await supervisedSession({
      sessionId, prompt: 'x', projectPath: repo,
      publicar: 'true' as unknown as boolean, // string não é pedido: só `true` literal
    }, { executarModelo: jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]'), postar, publicar })

    expect(publicar).not.toHaveBeenCalled()
  })

  // 15/11: o primeiro pedido real do Hub foi num projeto sem remoto, e parou antes de começar.
  it('publicar sem remoto: não pergunta "publicar?", não publica, e diz que a entrega é local', async () => {
    git(['remote', 'remove', 'origin'], repo)
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const publicar = jest.fn()
    const aguardarResposta = jest.fn()
    const resultado = await supervisedSession({ sessionId, prompt: 'x', projectPath: repo, publicar: true },
      { executarModelo: jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]'), postar, publicar, aguardarResposta })

    expect(resultado).toMatchObject({ ok: true })
    expect(publicar).not.toHaveBeenCalled()
    expect(aguardarResposta).not.toHaveBeenCalled()
    const [, corpo] = postar.mock.calls.find(([p]) => String(p).endsWith('/complete'))!
    expect(corpo.summary).toMatch(/não tem remoto `origin`/)
    expect(corpo.summary).toContain('git merge')
  })

  it('publicação recusada aparece no resumo e mantém as instruções locais', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const publicar = jest.fn().mockResolvedValue({ ok: false, motivo: 'sem_commits', detalhe: 'nada à frente' })

    await supervisedSession({ sessionId, prompt: 'x', projectPath: repo, publicar: true },
      { executarModelo: jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]'), postar, publicar, aguardarResposta: jest.fn().mockResolvedValue('1') })

    const [, corpo] = postar.mock.calls.find(([p]) => String(p).endsWith('/complete'))!
    expect(corpo.summary).toContain('NÃO foi publicada (sem_commits')
    expect(corpo.summary).toContain('git merge')
    expect(corpo.entrega).toBeUndefined()
  })

  it.each([
    ['recusa', 'Não publicar', /a publicação foi recusada/],
    ['silêncio', null, /sem resposta à aprovação do diff/],
  ])('%s na aprovação do diff: nada é publicado e o branch fica alcançável', async (_caso, resposta, motivo) => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    const publicar = jest.fn()
    const resultado = await supervisedSession({ sessionId, prompt: 'x', projectPath: repo, publicar: true }, {
      executarModelo: jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]'), postar, publicar,
      aguardarResposta: jest.fn().mockResolvedValue(resposta),
    })
    expect(publicar).not.toHaveBeenCalled()
    expect(resultado).toMatchObject({ ok: true, publicacao: { ok: false, motivo: 'publicacao_nao_autorizada' } })
    const [, corpo] = postar.mock.calls.find(([p]) => String(p).endsWith('/complete'))!
    expect(corpo.summary).toMatch(motivo)
    expect(corpo.summary).toContain('git merge')
  })

  it('o título do PR é o nome do envelope quando ele vem na carga', async () => {
    const sessionId = randomUUID()
    const publicar = jest.fn().mockResolvedValue({ ok: false, motivo: 'sem_commits' })
    await supervisedSession({
      sessionId, prompt: 'pedido longo e ilegível como título', projectPath: repo, publicar: true,
      nomeDoEnvelope: 'Prova 7.2a — README Itapevi',
    }, {
      executarModelo: jest.fn().mockResolvedValue('ok\n[[RAYZEN:DONE]]'), postar: jest.fn().mockResolvedValue({}),
      publicar, aguardarResposta: jest.fn().mockResolvedValue('Aprovado, publicar'),
    })
    expect(publicar.mock.calls[0][2].titulo).toBe('Rayzen · Prova 7.2a — README Itapevi')
  })

  it('não perde WIP quando o executor cai e devolve localização explícita para recuperação', async () => {
    const sessionId = randomUUID()
    const postar = jest.fn().mockResolvedValue({ ok: true })
    let worktree = ''
    const executarModelo = jest.fn(async (_prompt: string, cwd: string) => {
      worktree = cwd
      writeFileSync(join(cwd, 'wip-preservado.txt'), 'bytes ainda não commitados\n')
      throw new Error('executor interrompido pela fixture')
    })

    const resultado = await supervisedSession({
      sessionId,
      prompt: 'Produza WIP antes da interrupção',
      projectPath: repo,
    }, { executarModelo, postar })

    expect(resultado).toMatchObject({
      ok: false,
      sessionId,
      recoveryRequired: true,
      branch: `rayzen/sessao-${sessionId.slice(0, 8)}`,
      worktree,
    })
    expect(existsSync(join(worktree, 'wip-preservado.txt'))).toBe(true)
    expect(postar).toHaveBeenCalledWith(
      `/agent/session/${sessionId}/error`,
      expect.objectContaining({ message: expect.stringContaining('executor interrompido') }),
    )

    // Limpeza explícita da fixture somente depois de comprovar que os bytes sobreviveram.
    unlinkSync(join(worktree, 'wip-preservado.txt'))
    await removerWorktree(repo, {
      dir: worktree,
      branch: `rayzen/sessao-${sessionId.slice(0, 8)}`,
    })
  })
})
