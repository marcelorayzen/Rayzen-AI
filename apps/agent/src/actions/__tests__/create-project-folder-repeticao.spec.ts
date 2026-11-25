import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createProjectFolder, statusDoRegistro } from '../create-project-folder'
import { criarProjetoTemporario, removerProjetoTemporario } from '../../test-utils/projeto-temporario'

/**
 * ── Repetição precisa convergir, não falhar ─────────────────────────────────
 *
 * A Fase 4 pede "repetição não duplica pasta ou registro", e o broker da Fase 1 **reentrega**
 * tarefa cujo efeito ficou incerto — então a segunda chamada é o caminho normal, não o
 * excepcional. Até 24/09 ela lançava `Projeto já existe`, e uma tentativa que criou a pasta e
 * morreu antes de registrar não tinha como ser retomada por ninguém.
 *
 * Reconciliar não é sobrescrever: arquivo nenhum é reescrito. Sobrescrever apagaria o trabalho
 * feito no projeto desde a primeira execução, que é pior que o defeito original.
 */
describe('createProjectFolder — segunda chamada sobre a mesma pasta', () => {
  let projeto: string
  const tokenOriginal = process.env.AGENT_TOKEN

  beforeEach(() => {
    projeto = criarProjetoTemporario('repeticao')
    // Sem token, `chamarApi` devolve null e nenhuma chamada de rede acontece. O que este
    // arquivo mede é a convergência local; o caminho do catálogo é medido em `statusDoRegistro`.
    delete process.env.AGENT_TOKEN
  })

  afterEach(() => {
    removerProjetoTemporario(projeto)
    if (tokenOriginal === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = tokenOriginal
  })

  it('não lança, e se declara reconciliação em vez de criação', async () => {
    const nome = projeto.split(/[\\/]/).pop() as string
    const raiz = projeto.slice(0, projeto.length - nome.length - 1)

    const r = await createProjectFolder({ name: nome, root: raiz, openVscode: false })

    expect(r.created).toBe(false)
    expect(r.reconciled).toBe(true)
    expect(r.path).toBe(projeto)
  })

  it('não reescreve arquivo nenhum do que já estava lá', async () => {
    const nome = projeto.split(/[\\/]/).pop() as string
    const raiz = projeto.slice(0, projeto.length - nome.length - 1)
    // Um README com conteúdo humano é exatamente o que o caminho de criação sobrescreveria.
    writeFileSync(join(projeto, 'README.md'), '# trabalho humano que não pode sumir\n', 'utf8')

    await createProjectFolder({ name: nome, root: raiz, template: 'rayzen', openVscode: false })

    expect(readFileSync(join(projeto, 'README.md'), 'utf8')).toBe('# trabalho humano que não pode sumir\n')
    expect(existsSync(join(projeto, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(projeto, 'RAYZEN-SETUP.md'))).toBe(false)
  })

  /**
   * O retrato do git, e não um booleano: `temGit` não distinguia "não é repositório" de "não
   * consegui olhar", e não dizia nada sobre branch, HEAD ou trabalho pendente — que é
   * justamente o que a reconciliação compara entre o antes e o depois.
   */
  it('devolve o retrato do git do checkout, no mesmo formato da prévia', async () => {
    const nome = projeto.split(/[\\/]/).pop() as string
    const raiz = projeto.slice(0, projeto.length - nome.length - 1)

    const r = await createProjectFolder({ name: nome, root: raiz, openVscode: false })

    expect(r.git).toMatchObject({ estado: 'nao-repo', medidoEm: projeto })
  }, 20_000)
})

/**
 * A prévia é o mecanismo que a regra da casa prescreve para risco médio — e
 * `create_project_folder` virou `medium` em 24/09, porque ela cria pasta, roda
 * `git init/add/commit` e abre o editor.
 *
 * A prévia anterior devolvia caminho e slug: nada que permitisse conferir se já existe pasta,
 * se o projeto já está registrado, ou se um commit inicial vai acontecer — ou seja, nada do
 * que alguém precisa para decidir se autoriza.
 */
describe('createProjectFolder — dryRun prevê o que vai acontecer', () => {
  let projeto: string
  const tokenOriginal = process.env.AGENT_TOKEN

  beforeEach(() => { projeto = criarProjetoTemporario('previa'); delete process.env.AGENT_TOKEN })
  afterEach(() => {
    removerProjetoTemporario(projeto)
    if (tokenOriginal === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = tokenOriginal
  })

  it('pasta inexistente: diz que vai CRIAR, com git e editor declarados', async () => {
    const raiz = projeto.slice(0, projeto.lastIndexOf(projeto.split(/[\\/]/).pop() as string) - 1)

    const r = await createProjectFolder({ name: 'projeto-que-nao-existe-ainda', root: raiz, template: 'rayzen', dryRun: true })

    expect(r.dryRun).toBe(true)
    expect(r.previa).toMatchObject({
      acao: 'criar',
      pastaJaExiste: false,
      template: 'rayzen',
      vaiRodarGitInitCommit: true,
      vaiAbrirVscode: true,
    })
    expect(r.previa?.subpastas).toContain('docs/adr')
  })

  /** Prever não pode causar o efeito previsto: nada é criado no disco. */
  it('a prévia não cria nada', async () => {
    const raiz = projeto.slice(0, projeto.lastIndexOf(projeto.split(/[\\/]/).pop() as string) - 1)

    const r = await createProjectFolder({ name: 'projeto-que-nao-existe-ainda', root: raiz, template: 'rayzen', dryRun: true })

    expect(existsSync(r.path)).toBe(false)
  })

  it('pasta existente: diz que vai RECONCILIAR, e que não haverá commit inicial', async () => {
    const nome = projeto.split(/[\\/]/).pop() as string
    const raiz = projeto.slice(0, projeto.length - nome.length - 1)

    const r = await createProjectFolder({ name: nome, root: raiz, template: 'rayzen', dryRun: true })

    expect(r.previa).toMatchObject({ acao: 'reconciliar', pastaJaExiste: true, vaiRodarGitInitCommit: false })
  })
})

/**
 * Três casos, não dois — e o do meio é o que o texto anterior não tinha.
 *
 * `repoSlug` é `@unique`, então registrar de novo devolve HTTP 409. A versão anterior lia só
 * `project?.id`, não achava id num corpo de erro e devolvia `null`, que o gerador traduzia
 * para *"API offline?"*. O `RAYZEN-SETUP.md` mandava criar à mão um projeto que existia, e o
 * `CLAUDE.md` saía com `projectId` vazio.
 */
describe('statusDoRegistro — o que o RAYZEN-SETUP.md afirma', () => {
  const caminho = 'C:\\Users\\dev\\Projects\\projeto-x'

  it('criado agora: anuncia registro e traz o id', () => {
    const texto = statusDoRegistro({ projectId: 'p1', criado: true }, 'Projeto X', 'projeto-x', caminho)
    expect(texto).toContain('registrado automaticamente')
    expect(texto).toContain('p1')
    expect(texto).toContain(caminho)
  })

  it('já existia: diz que reaproveitou, e nunca que a API está fora', () => {
    const texto = statusDoRegistro({ projectId: 'p1', criado: false }, 'Projeto X', 'projeto-x', caminho)
    expect(texto).toContain('já estava registrado')
    expect(texto).toContain('p1')
    expect(texto).not.toMatch(/offline|não foi possível/i)
  })

  it('sem resposta: não afirma que o projeto não existe, manda conferir', () => {
    const texto = statusDoRegistro(null, 'Projeto X', 'projeto-x', caminho)
    expect(texto).toMatch(/sem resposta/i)
    expect(texto).toContain('Confira no painel')
  })
})
