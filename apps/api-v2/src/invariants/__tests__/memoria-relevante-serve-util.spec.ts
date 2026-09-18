import { InvariantsService, ehArquivoGerado, ehDeOutroRepo, nomeDoArquivo } from '../invariants.service'

/**
 * `memory_relevant` é a maior seção do contexto injetado — 58% do orçamento no Rayzen AI
 * — e até 2026-08-22 nenhum sensor olhava para o que ela serve.
 *
 * Duas falhas reais, e as duas silenciosas:
 *
 * - 2026-08-17: **dois dos cinco** trechos servidos ao banco-imob eram `pnpm-lock.yaml`,
 *   para a consulta "implementar cache de sessão no módulo de autenticação".
 * - 2026-08-22: **194 documentos de outros repositórios** (154 do Commerce, 37 do
 *   banco-imob, 3 do VB Ferragens) estavam indexados dentro do Rayzen AI — 15% do acervo.
 *   A busca é escopada por `projectId` e não acusava nada: os documentos ESTAVAM no
 *   projeto, só não eram dele. O `sourcePath` é o único sinal observável.
 *
 * O risco deste check não é deixar passar — é **acusar demais**. Um invariante que fica
 * vermelho por engano é abandonado, e aí não sensoreia nada. Daí a maior parte dos casos
 * abaixo ser sobre o que ele NÃO pode marcar.
 */

describe('ehArquivoGerado', () => {
  it.each([
    'c:\\Users\\marce\\Desktop\\Projects\\banco-imob\\pnpm-lock.yaml',
    '/home/x/proj/package-lock.json',
    'C:\\p\\app\\node_modules\\react\\index.js',
    '/repo/apps/web/.next/static/chunk.js',
    '/repo/dist/main.js',
    '/repo/public/vendor.min.js',
  ])('marca %s', (p) => expect(ehArquivoGerado(p)).toBe(true))

  it.each([
    'c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md',
    '/repo/apps/api/src/modules/session/session.service.ts',
    // "dist" como parte de um nome não é o diretório dist
    '/repo/src/distribuicao/calculo.ts',
    // lockfile citado DENTRO de um doc não é um lockfile
    '/repo/docs/por-que-o-pnpm-lock-nao-entra-no-brain.md',
  ])('não marca %s', (p) => expect(ehArquivoGerado(p)).toBe(false))

  it('caminho ausente não é arquivo gerado — desconhecido não é lixo', () => {
    expect(ehArquivoGerado(null)).toBe(false)
    expect(ehArquivoGerado(undefined)).toBe(false)
    expect(ehArquivoGerado('')).toBe(false)
  })
})

describe('ehDeOutroRepo', () => {
  // As três grafias que a casa realmente usa. Comparação exata reprovaria nas três.
  it('pasta `rayzen-ai` pertence ao slug `rayzen-ai-private`', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md', 'rayzen-ai-private')).toBe(false)
  })

  it('pasta `VB-ferragens` pertence ao slug `vb_ferragens`', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\VB-ferragens\\apps\\web\\Hero.tsx', 'vb_ferragens')).toBe(false)
  })

  it('pasta `Rayzen Commerce Platform` pertence ao slug `rayzen-commerce-platform`', () => {
    expect(ehDeOutroRepo('C:\\Users\\marce\\Desktop\\Projects\\Rayzen Commerce Platform\\PRODUCT_SCOPE.md', 'rayzen-commerce-platform')).toBe(false)
  })

  // O caso que originou o invariante: 154 arquivos do Commerce dentro do Rayzen AI.
  it('acusa arquivo do Commerce servido como se fosse do Rayzen AI', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\Rayzen Commerce Platform\\apps\\web\\modules\\cashier\\services\\nfce.service.ts', 'rayzen-ai-private')).toBe(true)
  })

  it('acusa arquivo do banco-imob servido como se fosse do Rayzen AI', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\banco-imob\\apps\\web\\src\\app\\layout.tsx', 'rayzen-ai-private')).toBe(true)
  })

  // `rayzen-pdv` e `rayzen-ai` compartilham prefixo até o hífen; o teste de prefixo é
  // por segmento inteiro normalizado, então não podem se confundir.
  it('projetos de prefixo parecido não se confundem', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\Rayzen-PDV\\src\\app.ts', 'rayzen-ai-private')).toBe(true)
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\src\\app.ts', 'Rayzen-PDV')).toBe(true)
  })

  /**
   * Falso positivo real, pego na PRIMEIRA execução contra dado de produção — os testes
   * estavam todos verdes e o invariante acusou a memória do Commerce como sendo de outro
   * repositório.
   *
   * O Claude Code guarda memória em `~/.claude/projects/<caminho achatado>/memory/`, e o
   * caminho achatado embute o diretório inteiro num segmento só. Lido como nome de pasta,
   * não casa com repoSlug nenhum.
   */
  it('entende o caminho achatado da memória do Claude Code', () => {
    const p = 'C:\\Users\\marce\\.claude\\projects\\c--Users-marce-Desktop-Projects-Rayzen-Commerce-Platform\\memory\\feedback_nextauth_v5_middleware.md'
    expect(ehDeOutroRepo(p, 'rayzen-commerce-platform')).toBe(false)
    // e continua acusando quando o projeto achatado é realmente outro
    expect(ehDeOutroRepo(p, 'rayzen-ai-private')).toBe(true)
  })

  it('caminho achatado do próprio Rayzen AI, cujo slug tem sufixo `-private`', () => {
    const p = 'C:\\Users\\marce\\.claude\\projects\\c--Users-marce-Desktop-Projects-rayzen-ai\\memory\\MEMORY.md'
    expect(ehDeOutroRepo(p, 'rayzen-ai-private')).toBe(false)
  })

  /**
   * Segundo falso positivo real da mesma execução. A regra anterior era **posicional** —
   * lia a pasta logo depois de `Projects` — e o repo do Coach mora dois níveis abaixo:
   * `Projects\Projetos\Ray Coach\personal-english-coach\`. Ela leu "Projetos".
   *
   * A regra hoje varre todos os segmentos, então não depende de profundidade.
   */
  it('entende repositório aninhado em subpastas', () => {
    const p = 'c:\\Users\\marce\\Desktop\\Projects\\Projetos\\Ray Coach\\personal-english-coach\\apps\\api\\src\\x.ts'
    expect(ehDeOutroRepo(p, 'personal-english-coach')).toBe(false)
    expect(ehDeOutroRepo(p, 'rayzen-ai-private')).toBe(true)
  })

  it('caminho relativo não é julgado — não dá para localizar repositório nenhum', () => {
    expect(ehDeOutroRepo('apps/api/package.json', 'personal-english-coach')).toBe(false)
  })

  // Conservador por construção: só julga o que consegue localizar.
  it.each([
    ['nota de aprendizado', 'learning/backlog-do-projectstate-nasce-com-id-placeholder'],
    ['URL', 'https://www.notion.so/alguma-pagina-123'],
    ['README do GitHub', 'github:marcelorayzen/catalog-guardian/README.md'],
    ['caminho fora de Projects', '/var/log/app.log'],
  ])('não julga %s — desconhecido não é alheio', (_rotulo, p) => {
    expect(ehDeOutroRepo(p, 'rayzen-ai-private')).toBe(false)
  })

  it('sem repoSlug não acusa ninguém', () => {
    expect(ehDeOutroRepo('c:\\Users\\marce\\Desktop\\Projects\\banco-imob\\x.ts', '')).toBe(false)
  })
})

describe('nomeDoArquivo', () => {
  it('extrai o nome nas duas convenções de separador', () => {
    expect(nomeDoArquivo('c:\\Users\\x\\Projects\\p\\a\\b.ts')).toBe('b.ts')
    expect(nomeDoArquivo('/home/x/a/b.ts')).toBe('b.ts')
  })

  it('caminho ausente não quebra o detalhe do invariante', () => {
    expect(nomeDoArquivo(null)).toBe('(sem caminho)')
  })
})

describe('InvariantsService — memoria_relevante_serve_util', () => {
  function build(servidos: Array<{ sourcePath?: string | null }>, repoSlug = 'rayzen-ai-private', erro?: Error) {
    const bridge = {
      getProject: jest.fn().mockResolvedValue({ id: 'p1', name: 'Rayzen AI', repoSlug }),
    }
    const contexto = {
      diagnosticarMemoria: erro
        ? jest.fn().mockRejectedValue(erro)
        : jest.fn().mockResolvedValue(servidos),
    }
    const service = new InvariantsService({} as never, bridge as never, {} as never, contexto as never)
    const rodar = () => (service as unknown as {
      memoriaRelevanteServeUtil: (id: string) => Promise<{ ok: boolean; detalhe: string; correcao?: string }>
    }).memoriaRelevanteServeUtil('p1')
    return { rodar, contexto }
  }

  it('verde quando os trechos servidos são do projeto', async () => {
    const r = await build([
      { sourcePath: 'c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md' },
      { sourcePath: 'c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\apps\\api\\src\\x.ts' },
    ]).rodar()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toContain('2 trechos')
  })

  it('vermelho quando serve lockfile — o caso do banco-imob', async () => {
    const r = await build([
      { sourcePath: 'c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\pnpm-lock.yaml' },
      { sourcePath: 'c:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\CLAUDE.md' },
    ]).rodar()
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('1 arquivo(s) gerado(s)')
    expect(r.detalhe).toContain('pnpm-lock.yaml')
  })

  it('vermelho quando serve arquivo de outro repositório — o caso dos 194', async () => {
    const r = await build([
      { sourcePath: 'c:\\Users\\marce\\Desktop\\Projects\\Rayzen Commerce Platform\\apps\\web\\modules\\cashier\\services\\nfce.service.ts' },
    ]).rodar()
    expect(r.ok).toBe(false)
    expect(r.detalhe).toContain('1 de outro repositório')
    // A correção precisa dizer que o erro é de INDEXAÇÃO — filtrar na busca não resolve.
    expect(r.correcao).toMatch(/INDEXAÇÃO/)
    expect(r.correcao).toMatch(/reatribuir/i)
  })

  it('seção calada é verde — ausência não é defeito', async () => {
    const r = await build([]).rodar()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/calada/)
  })

  it('busca que não responde é INCONCLUSIVA, não falha', async () => {
    const r = await build([], 'rayzen-ai-private', new Error('sem rede')).rodar()
    expect(r.ok).toBe(true)
    expect(r.detalhe).toMatch(/Inconclusivo/)
  })

  it('usa a MESMA seleção que monta a seção, não uma consulta própria', async () => {
    const { rodar, contexto } = build([])
    await rodar()
    // Sem `limit`/`piso` aqui de propósito: quem decide isso é o ContextEngine. Se este
    // check passasse os parâmetros, viraria uma cópia que pode divergir em silêncio.
    expect(contexto.diagnosticarMemoria).toHaveBeenCalledWith({
      projectId: 'p1',
      query:     expect.any(String),
      mode:      'implementation',
    })
  })
})
