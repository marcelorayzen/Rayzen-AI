import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createProjectFolder } from '../create-project-folder'
import { validarArquivosDoPlano, gitignoreDoPadrao, arquivosGeradosDoPadrao } from '../padrao-rayzen'
import { criarProjetoTemporario, removerProjetoTemporario } from '../../test-utils/projeto-temporario'

jest.setTimeout(60_000)

const PLANO = [
  { path: 'AGENTS.md', conteudo: '# Contrato de trabalho — Teste\n\nTODO(decisão): verificação mínima\n' },
  { path: 'README.md', conteudo: '# Teste\n\nProjeto de teste.\n' },
  { path: 'docs/ESTADO-DO-PROJETO.md', conteudo: '# Estado\n\n| área | estado |\n' },
  { path: 'docs/decisions/ADR-0001-stack.md', conteudo: '# ADR-0001\n\n**Status:** Proposta\n' },
  { path: 'CLAUDE.local.md', conteudo: '# notas locais — não versionar\n' },
]

describe('validarArquivosDoPlano — o plano aprovado, e só ele', () => {
  it('aceita e normaliza um plano válido', () => {
    const r = validarArquivosDoPlano([{ path: './docs\\ARQUITETURA.md', conteudo: 'x' }, { path: 'AGENTS.md', conteudo: 'y' }])
    expect(r.map((a) => a.path)).toEqual(['docs/ARQUITETURA.md', 'AGENTS.md'])
  })

  it.each([
    [[], /exige "arquivos"/],
    [undefined, /exige "arquivos"/],
    [[{ path: 'README.md', conteudo: 'x' }], /AGENTS\.md é obrigatório/],
    [[{ path: '../fora.md', conteudo: 'x' }, { path: 'AGENTS.md', conteudo: 'a' }], /relativo e dentro do projeto/],
    [[{ path: 'C:/x.md', conteudo: 'x' }, { path: 'AGENTS.md', conteudo: 'a' }], /relativo e dentro do projeto/],
    [[{ path: '.env', conteudo: 'TOKEN=1' }, { path: 'AGENTS.md', conteudo: 'a' }], /segredo/],
    [[{ path: '.mcp.json', conteudo: '{}' }, { path: 'AGENTS.md', conteudo: 'a' }], /escrita pelo gerador/],
    [[{ path: '.git/config', conteudo: 'x' }, { path: 'AGENTS.md', conteudo: 'a' }], /\.git é do git/],
    [[{ path: 'AGENTS.md', conteudo: 'a' }, { path: 'agents.md', conteudo: 'b' }], /repetido/],
    [[{ path: 'AGENTS.md', conteudo: 'x'.repeat(210 * 1024) }], /máximo/],
  ])('recusa plano inválido %#', (arquivos, motivo) => {
    expect(() => validarArquivosDoPlano(arquivos)).toThrow(motivo)
  })

  it('lista TODOS os problemas de uma vez, não só o primeiro', () => {
    expect(() => validarArquivosDoPlano([{ path: '.env', conteudo: 'x' }, { path: '../a', conteudo: 'x' }]))
      .toThrow(/\.env.*\.\.\/a.*AGENTS\.md/s)
  })

  it('.env.example é template e pode entrar', () => {
    expect(validarArquivosDoPlano([{ path: '.env.example', conteudo: 'TOKEN=' }, { path: 'AGENTS.md', conteudo: 'a' }])).toHaveLength(2)
  })

  it('o .gitignore do padrão sempre tira o privado do git, sem duplicar linha', () => {
    const g = gitignoreDoPadrao('node_modules/\n.local/\n')
    expect(g).toContain('CLAUDE.local.md')
    expect(g.match(/^\.local\/$/gm)).toHaveLength(1)
    expect(g).toContain('!.env.example')
  })
})

describe('arquivosGeradosDoPadrao — CLAUDE.md e CLAUDE.local.md quando o plano não traz (G4.2)', () => {
  it('plano só com o contrato ganha os dois, e o CLAUDE.md importa só o AGENTS.md', () => {
    const extras = arquivosGeradosDoPadrao([{ path: 'AGENTS.md', conteudo: 'x' }])
    expect(extras.map((a) => a.path)).toEqual(['CLAUDE.md', 'CLAUDE.local.md'])
    expect(extras[0].conteudo).toMatch(/^@AGENTS\.md$/m)
    expect(extras[0].conteudo).not.toContain('@PRODUCT.md')
  })

  it('com PRODUCT.md no plano, o CLAUDE.md importa os dois', () => {
    const [claude] = arquivosGeradosDoPadrao([{ path: 'AGENTS.md', conteudo: 'x' }, { path: 'PRODUCT.md', conteudo: 'y' }])
    expect(claude.conteudo).toMatch(/^@AGENTS\.md\n@PRODUCT\.md$/m)
  })

  it('o que o plano já traz vence: nada é sobrescrito', () => {
    const extras = arquivosGeradosDoPadrao([
      { path: 'AGENTS.md', conteudo: 'x' }, { path: 'CLAUDE.md', conteudo: 'meu' }, { path: 'CLAUDE.local.md', conteudo: 'meu' },
    ])
    expect(extras).toEqual([])
  })
})

describe('createProjectFolder template padrao-rayzen — escreve exatamente o plano', () => {
  let raiz: string
  const tokenOriginal = process.env.AGENT_TOKEN
  beforeEach(() => { raiz = criarProjetoTemporario('padrao-rayzen'); delete process.env.AGENT_TOKEN })
  afterEach(() => {
    removerProjetoTemporario(raiz)
    if (tokenOriginal === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = tokenOriginal
  })

  it('a prévia lista os arquivos e recusa plano inválido antes de qualquer aprovação virar efeito', async () => {
    const ok = await createProjectFolder({ name: 'Projeto Novo', root: raiz, template: 'padrao-rayzen', arquivos: PLANO, dryRun: true })
    expect(ok.previa).toMatchObject({ acao: 'criar', vaiRodarGitInitCommit: true })
    // G4.2: a prévia mostra também o que o gerador acrescenta — aqui o CLAUDE.md, porque o
    // plano já traz o próprio CLAUDE.local.md.
    expect(ok.previa?.arquivos).toEqual([...PLANO.map((a) => a.path), 'CLAUDE.md'])
    await expect(createProjectFolder({ name: 'Projeto Novo', root: raiz, template: 'padrao-rayzen', arquivos: [{ path: '.env', conteudo: 'x' }], dryRun: true }))
      .rejects.toThrow(/plano recusado/)
    expect(existsSync(join(raiz, 'Projeto Novo'))).toBe(false)
  })

  it('grava byte a byte, gera .gitignore e integração, e o commit inicial não leva o CLAUDE.local.md', async () => {
    const r = await createProjectFolder({ name: 'Projeto Novo', root: raiz, template: 'padrao-rayzen', arquivos: PLANO, openVscode: false })
    const p = join(raiz, 'Projeto Novo')
    expect(r.created).toBe(true)
    for (const a of PLANO) expect(readFileSync(join(p, a.path), 'utf8')).toBe(a.conteudo)
    expect(readFileSync(join(p, '.gitignore'), 'utf8')).toContain('CLAUDE.local.md')
    expect(existsSync(join(p, '.mcp.json'))).toBe(true)
    // nada gerado por LLM: nem BRIEF.md nem docs/project.md do template antigo
    expect(existsSync(join(p, 'BRIEF.md'))).toBe(false)
    expect(existsSync(join(p, 'docs', 'project.md'))).toBe(false)
    const versionados = execFileSync('git', ['ls-files'], { cwd: p, encoding: 'utf8' }).split(/\r?\n/)
    expect(versionados).toEqual(expect.arrayContaining(['AGENTS.md', 'docs/decisions/ADR-0001-stack.md', '.gitignore', '.mcp.json']))
    expect(versionados).not.toContain('CLAUDE.local.md')
  })

  it('G4.2: gera CLAUDE.md que importa o contrato e CLAUDE.local.md fora do commit', async () => {
    const plano = [
      { path: 'AGENTS.md', conteudo: '# Contrato\n' },
      { path: 'PRODUCT.md', conteudo: '# Produto\n' },
    ]
    const r = await createProjectFolder({ name: 'Projeto Curso', root: raiz, template: 'padrao-rayzen', arquivos: plano, openVscode: false })
    const p = join(raiz, 'Projeto Curso')
    expect(r.filesGenerated).toEqual(expect.arrayContaining(['CLAUDE.md', 'CLAUDE.local.md']))
    const claude = readFileSync(join(p, 'CLAUDE.md'), 'utf8')
    expect(claude).toMatch(/^@AGENTS\.md$/m)
    expect(claude).toMatch(/^@PRODUCT\.md$/m)
    expect(existsSync(join(p, 'CLAUDE.local.md'))).toBe(true)
    const versionados = execFileSync('git', ['ls-files'], { cwd: p, encoding: 'utf8' }).split(/\r?\n/)
    expect(versionados).toContain('CLAUDE.md')
    expect(versionados).not.toContain('CLAUDE.local.md')
  })

  it('plano inválido na execução não deixa pasta pela metade', async () => {
    await expect(createProjectFolder({ name: 'Projeto Ruim', root: raiz, template: 'padrao-rayzen', arquivos: [{ path: 'README.md', conteudo: 'x' }], openVscode: false }))
      .rejects.toThrow(/AGENTS\.md é obrigatório/)
    expect(existsSync(join(raiz, 'Projeto Ruim'))).toBe(false)
  })
})
