import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Contrato de qualidade de sinal (CLAUDE.local.md): "tool calls de leitura não viram
 * eventos". O hook é a única barreira que existe — o `PostToolUse` registrado em
 * `~/.claude/settings.json` usa matcher `""`, ou seja, **toda** ferramenta chega aqui.
 * O matcher `Edit|Write|Bash` do settings do projeto não filtra nada: o de usuário
 * dispara antes e para todos.
 *
 * O contrato estava escrito e quebrado ao mesmo tempo: `Read` e `Glob` eram ignorados,
 * `Grep` e `mcp__rayzen__rayzen_list_*` não. Medido em 2026-08-16, 3 dos 10 eventos
 * recentes do banco-imob eram Grep puro, ocupando lugar na timeline que a síntese lê.
 *
 * O teste lê o arquivo como texto porque o hook é `.mjs` executado direto pelo Claude
 * Code (sem build) — mesmo recurso de `memory-ranking.spec.ts`, que lê a lista da V1
 * como texto para barrar drift entre duas fontes que não podem se importar.
 */
describe('rayzen-hook — leitura pura não vira evento', () => {
  const fonte = readFileSync(join(__dirname, '..', 'rayzen-hook.mjs'), 'utf8')

  /**
   * O `Stop` falhou com slug `"?"` em 2026-09-06 — candidatos vazios, evento de fim de
   * sessão nascendo órfão. O hook dependia de `process.cwd()` do próprio processo, e
   * ignorava o `cwd` que a doc do Claude Code garante em todo payload.
   */
  it('resolve o projeto pelo cwd do payload, não pelo do processo', () => {
    expect(fonte).toMatch(/resolveProjectId\(cfg, payload\.cwd\)/)
    expect(fonte).toMatch(/candidatosDeSlug\(cwd\)/)
  })

  const bloco = fonte.match(/const IGNORED_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
  const ignoradas = [...bloco.matchAll(/'([^']+)'/g)].map((m) => m[1])

  it.each(['Read', 'Glob', 'Grep'])('ignora %s — exploração, não mudança', (tool) => {
    expect(ignoradas).toContain(tool)
  })

  it.each(['get', 'search', 'list'])(
    'ignora as tools mcp__rayzen__rayzen_%s* — consultar estado não é progresso',
    (verbo) => {
      expect(fonte).toContain(`tool.startsWith('mcp__rayzen__rayzen_${verbo}')`)
    },
  )

  it('não ignora Edit, Write nem Bash — esses SÃO o sinal', () => {
    for (const tool of ['Edit', 'Write', 'Bash']) {
      expect(ignoradas).not.toContain(tool)
    }
  })
})
