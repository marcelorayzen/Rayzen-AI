import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * O hook RESOLVIA o `projectId` e jogava fora.
 *
 * Tudo que ele injetava era semântico — objetivo, memória, eventos, políticas, grafo.
 * Nada dizia **como endereçar** o projeto, apesar de o hook ter os três valores na mão:
 * ele acabou de usá-los para buscar o que injeta.
 *
 * Medido em 2026-09-05, numa sessão real de trabalho: **~10 chamadas gastas só para
 * redescobrir** o UUID do projeto, a rota da meta (depois de um 404 em `/goal`), o
 * formato de `successCriteria`, que `memory_meta` mora em `v2` e não em `public`, e os
 * nomes de coluna de `approval_gates`. Toda sessão nova, todo dia, de novo.
 *
 * Como `memory-ranking.spec.ts` e `hook-signal-quality.spec.ts`, este teste lê o `.mjs`
 * como TEXTO: o hook roda direto pelo Claude Code, sem build, e não há módulo para
 * importar.
 */
describe('rayzen-context-hook — identidade injetada', () => {
  const fonte = readFileSync(join(__dirname, '..', 'rayzen-context-hook.mjs'), 'utf8')

  it('existe uma função que formata a identidade', () => {
    expect(fonte).toMatch(/function formatarIdentidade\(/)
  })

  it.each(['projectId', 'repoSlug', 'api V1', 'api V2'])('emite %s', (campo) => {
    const bloco = fonte.match(/function formatarIdentidade\([\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).toContain(campo)
  })

  /**
   * Segredo em contexto injetado vira segredo em transcript, em log e em qualquer lugar
   * onde o prompt for parar. O caminho do arquivo pode aparecer; o valor nunca.
   */
  it('NÃO emite o token — só endereço', () => {
    const bloco = fonte.match(/function formatarIdentidade\([\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).not.toMatch(/apiToken|Bearer|cfg\.token/)
  })

  /**
   * Sair só num dos caminhos faria a sessão saber o endereço de forma intermitente, o
   * que é pior que não saber: você para de conferir porque às vezes está lá.
   */
  it('entra na montagem do cache-hit E na da busca fresca', () => {
    const montagens = [...fonte.matchAll(/const full = \[([^\]]*)\]/g)].map((m) => m[1])
    expect(montagens.length).toBeGreaterThanOrEqual(2)
    for (const m of montagens) expect(m).toContain('identidade')
  })

  /**
   * `candidatosDeSlug` devolve duas grafias em ordem, e a busca resolve pela primeira
   * que casar — que **não** é necessariamente a registrada: o diretório `rayzen-ai`
   * resolve um projeto cujo `repoSlug` é `rayzen-ai-private`. Publicar a candidata faria
   * a identidade afirmar um slug que o Rayzen não conhece.
   */
  it('publica o repoSlug REGISTRADO, não a grafia que casou', () => {
    expect(fonte).toMatch(/achado\?\.repoSlug/)
    expect(fonte).toMatch(/writeSlugCache\(slug, id, real\)/)
  })

  /**
   * São três saídas em `resolveProjectId` — cache de slug, busca na API e fallback
   * stale. Se alguma não gravar o slug, a identidade fica incompleta justamente nas
   * sessões que mais dependem de cache, que são as rápidas.
   */
  it('grava o repoSlug nos três caminhos de resolução', () => {
    const bloco = fonte.match(/async function resolveProjectId\([\s\S]*?\n}/)?.[0] ?? ''
    expect([...bloco.matchAll(/cfg\.repoSlug =/g)]).toHaveLength(3)
  })

  /**
   * O cache de slug é **um arquivo único no tmpdir, compartilhado por todos os projetos
   * abertos na máquina**. É a mesma superfície que tornou perigoso fixar `projectId` no
   * `hook.config.mjs` — arquivo global, referenciado por caminho absoluto em cada
   * `.claude/settings.json`.
   *
   * A diferença é esta comparação: sem ela, um projeto leria a entrada deixada por outro
   * e a identidade injetada apontaria para o projeto errado — que é exatamente o
   * incidente da Urna, onde um consumidor sem projeto definido caiu no default e gravou
   * um blueprint no lugar errado.
   *
   * Verificado por execução em 2026-09-05: com o cache plantado com
   * `rayzen-commerce-platform`, o hook rodando em `rayzen-ai` resolveu
   * `rayzen-ai-private` — entrada alheia vira cache miss.
   */
  it('o cache de slug compara identidade antes de servir — nada de ler entrada de outro projeto', () => {
    const bloco = fonte.match(/function readSlugCache\(slug\)[\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).toMatch(/c\.slug === slug/)
  })

  /**
   * `readSlugCacheReal` NÃO compara slug — ela lê o campo direto. Isso só é seguro
   * porque a única chamada acontece depois de `readSlugCache(slug)` ter confirmado a
   * identidade. Se alguém mover a chamada para fora dessa guarda, o slug real passa a
   * vir de outro projeto.
   */
  /**
   * A documentação do Claude Code garante `cwd` em TODO evento de hook, e avisa que ele é
   * o que segue o Claude ao entrar numa worktree ou depois de um `cd` — enquanto
   * `process.cwd()` do processo do hook é outra coisa.
   *
   * O hook ignorava o campo e dependia do `process.cwd()`. Em 2026-09-06 o `Stop` falhou
   * com slug `"?"`: lista de candidatos VAZIA, ou seja, evento de fim de sessão nascendo
   * órfão. A informação chegava e estava sendo jogada fora.
   */
  it('usa o cwd do PAYLOAD, não o process.cwd() do processo', () => {
    expect(fonte).toMatch(/function extractCwd\(/)
    expect(fonte).toMatch(/resolveProjectId\(cfg, extractCwd\(raw\)\)/)
    expect(fonte).toMatch(/candidatosDeSlug\(cwd\)/)
    // Chamar sem argumento voltaria a depender do diretório do processo.
    const bloco = fonte.match(/async function resolveProjectId\([\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).not.toMatch(/candidatosDeSlug\(\)/)
  })

  it('o repoSlug real só é lido depois da guarda de identidade', () => {
    const bloco = fonte.match(/async function resolveProjectId\([\s\S]*?\n}/)?.[0] ?? ''
    const chamadas = [...bloco.matchAll(/readSlugCacheReal\(\)/g)]
    expect(chamadas).toHaveLength(1)
    expect(bloco).toMatch(/const cached = readSlugCache\(slug\)\s*\n\s*if \(cached\) \{ cfg\.repoSlug = readSlugCacheReal\(\)/)
  })
})
