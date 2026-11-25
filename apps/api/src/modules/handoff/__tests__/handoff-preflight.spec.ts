import { avaliarPrevia, avisosAntesDeAprovar, compararGit, verificarEfeito } from '../handoff-preflight'

const root = 'C:/Users/dev/Projects'
const caminho = 'C:/Users/dev/Projects/Projeto X'

describe('avaliarPrevia — reconciliar antes de materializar', () => {
  it('pasta inexistente autoriza a criação', () => {
    const r = avaliarPrevia({ path: caminho, previa: { acao: 'criar', pastaJaExiste: false } }, root)
    expect(r.ok).toBe(true)
    expect(r.motivo).toMatch(/criar/)
  })

  /**
   * Pasta existente **não** é impedimento: a ação reconcilia sem reescrever arquivo nenhum, e
   * recusar aqui tornaria impossível retomar um projeto — que é metade do que a fase promete
   * ("materializar ou RETOMAR o trabalho com Claude no VS Code").
   */
  it('pasta existente autoriza, porque a execução reconcilia sem sobrescrever', () => {
    const r = avaliarPrevia({ path: caminho, previa: { acao: 'reconciliar', pastaJaExiste: true } }, root)
    expect(r.ok).toBe(true)
    expect(r.motivo).toMatch(/reconciliar/)
  })

  /**
   * ── O caso que a reconciliação existe para pegar ───────────────────────────
   *
   * O projeto já está registrado com checkout em OUTRO lugar. Materializar criaria uma segunda
   * pasta para o mesmo projeto, e o catálogo passaria a apontar para uma das duas — o
   * "repetição duplica pasta ou registro" por um caminho que a chave de idempotência não cobre,
   * porque são envelopes diferentes sobre o mesmo projeto.
   */
  it('recusa quando o projeto já tem checkout em outro caminho', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: {
        acao: 'criar',
        projetoJaRegistrado: { id: 'p1', checkoutPath: 'D:/outro/lugar/Projeto X' },
      },
    }, root)

    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/segunda pasta/)
    expect(r.motivo).toContain('D:/outro/lugar/Projeto X')
  })

  it('o mesmo checkout não é conflito, mesmo escrito com outra barra ou caixa', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: {
        acao: 'reconciliar',
        projetoJaRegistrado: { id: 'p1', checkoutPath: 'c:\\Users\\dev\\Projects\\Projeto X' },
      },
    }, root)
    expect(r.ok).toBe(true)
  })

  it('recusa prévia sem caminho ou fora da raiz aprovada', () => {
    const previa = { acao: 'criar' as const, pastaJaExiste: false }
    expect(avaliarPrevia({ previa }, root).ok).toBe(false)
    expect(avaliarPrevia({ path: 'C:/Users/dev/ProjectsEvil/Projeto X', previa }, root).ok).toBe(false)
    expect(avaliarPrevia({ path: 'C:/Users/dev/Projects/../fora/Projeto X', previa }, root).ok).toBe(false)
    expect(avaliarPrevia({ path: 'D:/outro/Projeto X', previa }, root).ok).toBe(false)
  })

  /** Registro sem caminho conhecido é o projeto antigo, anterior ao `checkoutPath`. */
  it('projeto registrado sem checkout conhecido não bloqueia', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'criar', projetoJaRegistrado: { id: 'p1', checkoutPath: null } },
    }, root)
    expect(r.ok).toBe(true)
  })

  /**
   * Seguir sem prévia seria executar às cegas justamente no passo que a fase pede para ser
   * verificado antes. Ausência de resposta não é permissão.
   */
  it.each([[null], [undefined], [{}], [{ path: caminho }]])(
    'sem prévia não autoriza (%p)',
    (resultado) => {
      const r = avaliarPrevia(resultado as never, root)
      expect(r.ok).toBe(false)
      expect(r.motivo).toMatch(/às cegas|não respondeu/)
    },
  )
})

/**
 * ── Git bloqueia só o que o efeito danificaria; o resto é registro ──────────
 *
 * A regra não é "git limpo autoriza". É que o estado do git quase sempre é CONTEXTO — e num
 * caso só ele torna o efeito errado.
 */
describe('git no preflight', () => {
  const repo = { estado: 'repo' as const, raiz: 'C:/Users/dev/Projects', branch: 'main', head: 'abc123', naoCommitados: 0 }

  /**
   * O único bloqueio: criar dentro de um repositório existente. O `git init` do template
   * criaria um repositório ANINHADO — e aí não é contexto, é dano.
   */
  it('recusa criar quando a raiz já está dentro de um repositório', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'criar', vaiRodarGitInitCommit: true, git: repo },
    }, root)

    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/aninhado/)
  })

  /**
   * Sem `git init` não há o que aninhar. Template `blank` dentro de um repo é legítimo — e
   * bloquear ali seria estender a regra além do dano que ela existe para impedir.
   */
  it('mas autoriza quando o efeito não roda git init', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'criar', vaiRodarGitInitCommit: false, git: repo },
    }, root)
    expect(r.ok).toBe(true)
  })

  /**
   * Trabalho não commitado NÃO bloqueia: o caminho de reconciliar não roda git nem reescreve
   * arquivo, e bloquear impediria retomar um projeto — que normalmente se retoma justamente
   * porque tem trabalho em andamento.
   */
  it('trabalho não commitado não bloqueia, e entra como registro', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'reconciliar', pastaJaExiste: true, git: { ...repo, naoCommitados: 7 } },
    }, root)

    expect(r.ok).toBe(true)
    expect(r.motivo).toMatch(/7 não commitado/)
  })

  /** O envelope não declara branch esperada; recusar por ela seria inventar um campo. */
  it('branch diferente não bloqueia', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'reconciliar', pastaJaExiste: true, git: { ...repo, branch: 'feature/x' } },
    }, root)
    expect(r.ok).toBe(true)
  })

  /**
   * Não conseguir medir não pode virar bloqueio nem ser lido como "não é repositório" — é a
   * mesma disciplina de três estados do resto da casa.
   */
  it('git inconclusivo não bloqueia, e se declara', () => {
    const r = avaliarPrevia({
      path: caminho,
      previa: { acao: 'criar', vaiRodarGitInitCommit: true, git: { estado: 'inconclusivo', motivo: 'git ausente' } },
    }, root)

    expect(r.ok).toBe(true)
    expect(r.motivo).toMatch(/não foi possível medir/)
  })
})

describe('compararGit — divergência é evidência, não bloqueio', () => {
  const antes = { estado: 'repo' as const, branch: 'main', head: 'aaaaaaaa1111', naoCommitados: 0 }

  it('nada mudou não produz nota', () => {
    expect(compararGit(antes, { ...antes })).toBeNull()
  })

  it('branch, HEAD e pendências aparecem na nota', () => {
    const nota = compararGit(antes, { ...antes, branch: 'feature/x', head: 'bbbbbbbb2222', naoCommitados: 3 })
    expect(nota).toMatch(/branch main para feature\/x/)
    expect(nota).toMatch(/HEAD aaaaaaaa para bbbbbbbb/)
    expect(nota).toMatch(/não commitados 0 para 3/)
  })

  /** Comparar com uma medição que não aconteceu produziria alarme a partir de ausência. */
  it.each([
    [undefined, { estado: 'repo' as const }],
    [{ estado: 'inconclusivo' as const }, { estado: 'repo' as const }],
    [{ estado: 'repo' as const }, { estado: 'inconclusivo' as const }],
  ])('medição ausente ou inconclusiva não vira divergência (%p)', (a, b) => {
    expect(compararGit(a, b)).toBeNull()
  })

  /** E a divergência acompanha a confirmação, sem impedi-la. */
  it('efeito confirmado com git divergente continua confirmado', () => {
    const r = verificarEfeito({
      path: 'C:/x',
      previa: {
        pastaJaExiste: true,
        projetoJaRegistrado: { id: 'p1', checkoutPath: 'C:/x' },
        git: { estado: 'repo', branch: 'outra', head: 'bbbbbbbb2222', naoCommitados: 0 },
      },
    }, antes)

    expect(r.estado).toBe('confirmado')
    expect(r.motivo).toMatch(/git mudou/)
  })
})

/** S1f (15/11): o card diz "sem remoto, sem PR" antes do toque — e nunca cala sem ter conferido. */
describe('avisosAntesDeAprovar', () => {
  const SESSAO = 'jarvis:supervised_session'
  const previa = (extra: Record<string, unknown>) => ({
    path: 'C:/p', previa: { tipo: 'sessao_supervisionada', branch: 'rayzen/x', publicar: true, remoto: 'git@github.com:x/y.git', ghAutenticado: true, entrega: {}, ...extra },
  })

  it('sem remoto e com publicar: avisa que não haverá PR', () => {
    expect(avisosAntesDeAprovar(SESSAO, previa({ remoto: null }))[0]).toMatch(/Sem remoto `origin`: não haverá PR/)
  })

  it('gh sem login: avisa que o PR não abre', () => {
    expect(avisosAntesDeAprovar(SESSAO, previa({ ghAutenticado: false }))[0]).toMatch(/`gh` não está autenticado/)
  })

  it('checkout sujo: avisa que a sessão parte do último commit', () => {
    expect(avisosAntesDeAprovar(SESSAO, previa({ git: { estado: 'repo', naoCommitados: 3 } }))[0]).toMatch(/3 alteração/)
  })

  it('tudo certo: nenhum aviso', () => {
    expect(avisosAntesDeAprovar(SESSAO, previa({}))).toEqual([])
  })

  it('sem publicar, a falta de remoto não importa', () => {
    expect(avisosAntesDeAprovar(SESSAO, previa({ publicar: false, remoto: null }))).toEqual([])
  })

  it('sem prévia gravada: diz que não conferiu, nunca fica calado', () => {
    expect(avisosAntesDeAprovar(SESSAO, null)[0]).toMatch(/Não consegui conferir/)
    expect(avisosAntesDeAprovar(SESSAO, { error: 'agent offline' })[0]).toMatch(/recusou antes da aprovação: agent offline/)
  })

  it('outros efeitos não ganham aviso de sessão', () => {
    expect(avisosAntesDeAprovar('jarvis:create_project_folder', null)).toEqual([])
  })
})
