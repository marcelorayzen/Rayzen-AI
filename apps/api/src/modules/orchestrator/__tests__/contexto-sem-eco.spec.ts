import { OrchestratorService } from '../orchestrator.service'

/**
 * ── O chat servia eco de ferramenta como "atividade do projeto" (14/09) ──────
 *
 * Primeira conversa real pelo Telegram, perguntando o status do projeto. A resposta trouxe uma
 * seção "Atividades recentes (Bash)" listando **comandos de depuração** que eu havia acabado de
 * rodar — *"Verificação das correções do Telegram no container"*, *"Checagem da saúde do
 * BuildKit"* — como se fossem trabalho do projeto.
 *
 * Pior que o ruído: o modelo **concluiu a partir do título do comando**. De
 * `Bash: Check whether the pnpm install is alive or hung` ele afirmou *"o pnpm install está
 * rodando normalmente"* — exatamente o oposto do que aconteceu (estava travado e foi morto).
 *
 * `getProjectContext` pegava os 8 eventos mais recentes **sem filtro nenhum**. E o filtro já
 * existia: `ehTextoDerivadoDeEvento`, usado no ProjectState desde 17/08, nascido do mesmo
 * defeito — 292 ecos `Edit:`/`Write:` em 7 dias moldando o objetivo do projeto. A regra estava
 * escrita e aplicada num lugar só; o chat lia a tabela crua.
 *
 * "Atividade não é intenção": eco de ferramenta descreve o MEIO, não o trabalho.
 */
describe('getProjectContext — eco de ferramenta não é atividade do projeto', () => {
  function build(eventos: { content: string; type: string }[]) {
    const svc = Object.create(OrchestratorService.prototype) as OrchestratorService
    Object.assign(svc, {
      prisma: {
        project: { findUnique: jest.fn().mockResolvedValue({ name: 'Rayzen AI', description: 'desc' }) },
        projectState: { findFirst: jest.fn().mockResolvedValue(null) },
        projectGoal: { findFirst: jest.fn().mockResolvedValue(null) },
        event: { findMany: jest.fn().mockResolvedValue(eventos) },
      },
    })
    return (svc as unknown as { getProjectContext: (p?: string) => Promise<string> })
      .getProjectContext('proj-1')
  }

  /**
   * `Bash: <description>` NÃO é filtrado, e isso é o contrato desta casa: a descrição do comando
   * é sinal, o comando cru é que seria ruído. Mudar isso seria classificar por CAMPO de novo —
   * o erro exato do `isNoise` antigo.
   *
   * O que se corrige é o RÓTULO. Chamar telemetria de "Atividade recente" convida o modelo a
   * concluir estado a partir dela, e foi o que aconteceu: de
   * `Bash: Check whether the pnpm install is alive or hung` saiu "o pnpm install está rodando
   * normalmente". A seção precisa dizer o que é e o que não é.
   */
  it('a seção se identifica como registro operacional, não como estado', async () => {
    const ctx = await build([
      { type: 'execution', content: 'Bash: Check whether the pnpm install is alive or hung' },
    ])

    expect(ctx).toMatch(/não são o estado do projeto|não conclua/i)
    expect(ctx).not.toMatch(/Atividade recente/)
  })

  /**
   * Densidade: com oito execuções recentes, uma decisão antiga some da janela. Decisão é o que
   * responde "onde o projeto está"; execução é como se chegou lá.
   */
  it('decisão vem ANTES de execução, mesmo sendo mais antiga', async () => {
    const ctx = await build([
      { type: 'execution', content: 'Bash: comando recente 1' },
      { type: 'execution', content: 'Bash: comando recente 2' },
      { type: 'decision', content: 'Decidimos X porque Y' },
    ])

    expect(ctx.indexOf('Decidimos X porque Y')).toBeLessThan(ctx.indexOf('comando recente 1'))
  })

  it('eco de edição de arquivo não entra como atividade', async () => {
    const ctx = await build([
      { type: 'note', content: 'Edit: C:\\Users\\marce\\Projects\\rayzen-ai\\apps\\api\\src\\app.ts' },
      { type: 'note', content: 'Workspace alterado: rayzen-ai — apps/api/src/app.ts' },
    ])

    expect(ctx).not.toMatch(/Edit:/)
    expect(ctx).not.toMatch(/Workspace alterado/)
  })

  /**
   * O outro lado: filtrar demais deixaria o chat sem contexto nenhum. Trabalho de verdade
   * continua chegando.
   */
  it('decisão e nota de trabalho continuam chegando', async () => {
    const ctx = await build([
      { type: 'decision', content: 'Decidimos usar bind mount para o SOUL, não cópia na imagem' },
      { type: 'note', content: 'Corrigido o 401 do Telegram: TELEGRAM_API_TOKEN nunca existiu' },
    ])

    expect(ctx).toMatch(/bind mount para o SOUL/)
    expect(ctx).toMatch(/401 do Telegram/)
  })

  it('quando tudo é eco, a seção de atividade nem aparece', async () => {
    const ctx = await build([
      { type: 'note', content: 'Workspace alterado: rayzen-ai — apps/api/src/main.ts' },
      { type: 'note', content: 'Edit: apps/api/src/main.ts' },
    ])

    expect(ctx).not.toMatch(/Registro operacional/)
  })

  it('mistura: só o trabalho real sobrevive', async () => {
    const ctx = await build([
      { type: 'execution', content: 'Bash: Verify both telegram fixes in the container' },
      { type: 'decision', content: 'Identidade do Rayzen passa a viver em infra/hermes/SOUL.md' },
      { type: 'note', content: 'Edit: apps/api/src/modules/telegram/telegram.service.ts' },
    ])

    expect(ctx).toMatch(/Registro operacional/)
    expect(ctx).toMatch(/infra\/hermes\/SOUL\.md/)
    expect(ctx).not.toMatch(/Edit:/)
  })
})
