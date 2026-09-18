import { podeIndexarAutomaticamente, ehCaminhoDeSegredo } from '../indexable-path.const'

/**
 * O hook indexava TODO `Edit`/`Write` sem olhar o caminho.
 *
 * Medido no Rayzen AI em 2026-08-18, num acervo de 1.715 documentos: **65 de
 * scratchpad** (scripts de análise descartáveis), 6 lockfiles, 7 artefatos de build.
 *
 * O problema não é volume, é **ocupar slot**. `memory_relevant` é a maior seção do
 * contexto injetado (30-50%) e entrega 5 trechos. No banco-imob, dois dos cinco eram
 * `pnpm-lock.yaml` — para a consulta "implementar cache de sessão no módulo de
 * autenticação". Numa busca no Rayzen AI em `debugging`, dois dos cinco eram scripts
 * temporários da própria sessão que estava buscando.
 */
describe('podeIndexarAutomaticamente', () => {
  describe('barra o que não tem intenção autoral', () => {
    it.each([
      'c:/proj/pnpm-lock.yaml',
      '/home/u/app/package-lock.json',
      'proj/yarn.lock',
      'api/Cargo.lock',
    ])('lockfile: %s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(false))

    it.each([
      'c:/proj/node_modules/react/index.js',
      '/proj/dist/main.js',
      'apps/web/.next/server/page.js',
      'proj/coverage/lcov-report/index.html',
      'graphify-out/graph.json',
    ])('gerado/build: %s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(false))

    it.each([
      'C:\\Users\\marce\\AppData\\Local\\Temp\\claude\\x\\scratchpad\\q1.sql',
      '/tmp/analise.mjs',
      'c:/proj/scratchpad/medir.mjs',
    ])('scratchpad/temporário: %s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(false))

    it.each([
      'web/public/bundle.min.js',
      'web/dist/app.css.map',
      'proj/img/logo.png',
      'docs/manual.pdf',
    ])('ilegível/binário: %s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(false))

    /**
     * Segredo NÃO segue o critério das outras categorias — ele tem intenção autoral de
     * sobra, e é por isso mesmo que não entra: o que ele diz é credencial.
     *
     * Vazamento medido em 2026-09-10: `hook.config.mjs` estava indexado e a busca
     * semântica o serviu **com o JWT completo** dentro do `memory_relevant` de uma sessão
     * real — um dia depois de o arquivo ter sido fechado por ACL. Proteger o objeto não
     * protege a cópia que já saiu dele.
     */
    it.each([
      'apps/agent/src/hooks/hook.config.mjs',
      'C:\\Users\\marce\\Desktop\\Projects\\rayzen-ai\\apps\\agent\\src\\hooks\\hook.config.mjs',
      'proj/.env',
      'proj/.env.local',
      'apps/api/.env',
      'infra/certs/server.pem',
      'infra/certs/server.key',
      '~/.ssh/id_ed25519',
      'credentials.json',
      'rayzenexec-senha.txt',
    ])('segredo: %s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(false))
  })

  describe('deixa passar o que é o trabalho', () => {
    it.each([
      'apps/api/src/modules/event/event.controller.ts',
      'apps/web/app/page.tsx',
      'apps/api/prisma/schema.prisma',
      'CLAUDE.md',
      'blueprints/025-hud-mission-control.md',
      'infra/litellm/config.yaml',
      'apps/api/src/modules/memory/__tests__/indexable-path.spec.ts',
      'package.json',
    ])('%s', (p) => expect(podeIndexarAutomaticamente(p)).toBe(true))

    /**
     * `package.json` não pode ser confundido com `package-lock.json` — um é escrito
     * por pessoa e declara intenção, o outro é resolvido por ferramenta.
     */
    it('distingue package.json de package-lock.json', () => {
      expect(podeIndexarAutomaticamente('proj/package.json')).toBe(true)
      expect(podeIndexarAutomaticamente('proj/package-lock.json')).toBe(false)
    })

    /** "dist" como parte de um nome não é a pasta de build. */
    it('não confunde nome de arquivo com pasta de build', () => {
      expect(podeIndexarAutomaticamente('apps/api/src/distribuicao.service.ts')).toBe(true)
      expect(podeIndexarAutomaticamente('apps/api/src/outbox/handler.ts')).toBe(true)
    })
  })

  /**
   * Sem caminho não dá para julgar, e a indexação automática dispara dezenas de vezes
   * por sessão — o custo de deixar entrar lixo é maior que o de perder um caso raro.
   */
  it('caminho ausente ou vazio não é indexado', () => {
    expect(podeIndexarAutomaticamente('')).toBe(false)
    expect(podeIndexarAutomaticamente('   ')).toBe(false)
    expect(podeIndexarAutomaticamente(null)).toBe(false)
    expect(podeIndexarAutomaticamente(undefined)).toBe(false)
  })
})

/**
 * `ehCaminhoDeSegredo` responde outra pergunta que `podeIndexarAutomaticamente`, e por isso
 * é função separada: aquela decide o que o **hook** indexa sozinho; esta serve a quem precisa
 * AUDITAR o acervo — inclusive o que entrou antes da regra de segredo existir, que foi
 * exatamente o caso dos dois documentos apagados em 2026-09-10.
 */
describe('ehCaminhoDeSegredo', () => {
  it.each([
    'apps/agent/src/hooks/hook.config.mjs',
    'proj/.env',
    'proj/.env.production',
    'apps/web/.env.local',
    'infra/certs/server.pem',
    '~/.ssh/id_ed25519',
    '.credentials.json',
  ])('acusa: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(true))

  /**
   * `.example` fica de fora DE PROPÓSITO. `hook.config.example.mjs` é template versionado
   * e é o que ensina o formato a quem chega — os dois documentos `.example` foram
   * preservados no Brain quando os dois reais foram apagados.
   */
  it.each([
    'apps/agent/src/hooks/hook.config.example.mjs',
    'proj/.env.example',
    '.env.agent.server.example',
  ])('não acusa template: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(false))

  it.each([
    'apps/api/src/modules/memory/memory.service.ts',
    'CLAUDE.md',
    'package.json',
  ])('não acusa arquivo comum: %s', (p) => expect(ehCaminhoDeSegredo(p)).toBe(false))

  it('caminho ausente não é segredo', () => {
    expect(ehCaminhoDeSegredo('')).toBe(false)
    expect(ehCaminhoDeSegredo(null)).toBe(false)
    expect(ehCaminhoDeSegredo(undefined)).toBe(false)
  })
})
