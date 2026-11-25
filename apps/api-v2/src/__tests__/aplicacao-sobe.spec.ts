import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'

/**
 * ── O mesmo sensor da V1, pelo mesmo motivo ──────────────────────────────────
 *
 * Ver `apps/api/src/__tests__/aplicacao-sobe.spec.ts` para a história: um ciclo de módulos
 * derrubou a API em 14/09 com `tsc --noEmit` limpo e a suíte inteira verde.
 *
 * A V2 tem 34 módulos e exatamente a mesma cegueira — nenhum spec dela monta o grafo. Não houve
 * incidente aqui; é o sensor entrando **antes** do defeito, que é a única vez em que isso sai
 * barato.
 *
 * `preview: true` resolve o grafo sem instanciar provider nenhum: sem os dois clientes Prisma, sem
 * Redis, e sem os ciclos automáticos (invariantes 30min, backfill 15min, catálogo 6h, QA 24h) —
 * que num teste disparariam de verdade.
 *
 * ── Ele já pagou, e provou alcançar mais do que estava escrito (17/09) ──────
 *
 * Ao entrar o `PanoramaModule`, este spec reprovou com
 * `Nest can't resolve dependencies of the PanoramaService (PrismaV2Service, ?,
 * SystemStatusService)` — eu tinha injetado `ConfigService` sem notar que **a V2 não registra
 * `ConfigModule`** e que nenhum outro serviço dela usa isso (a convenção aqui é `process.env`
 * direto). O comentário da V1 afirmava que preview NÃO pega esse erro; afirmava errado.
 *
 * A distinção é entre **resolver** e **executar**: preview resolve o grafo e confere escopo de
 * dependência; o que escapa é falha ao rodar construtor ou `onModuleInit`.
 */
describe('a aplicação V2 monta o grafo de módulos', () => {
  jest.setTimeout(120_000)

  it('AppModule sobe sem ciclo e sem módulo indefinido', async () => {
    const ctx = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
      abortOnError: false,
    })

    expect(ctx).toBeDefined()
    await ctx.close()
  })
})
