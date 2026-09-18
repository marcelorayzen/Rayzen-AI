import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'

/**
 * ── Perguntar ao Nest, em vez de deduzir do texto ────────────────────────────
 *
 * Em 14/09 uma rota do Telegram no `InfraHealthController` fechou o grafo de módulos e a **API
 * ficou fora do ar**. O que não pegou o defeito é o ponto: `tsc --noEmit` passou limpo e as 578
 * asserções passaram. Ciclo de MÓDULO não é erro de tipo, e nenhum spec unitário monta o grafo —
 * cada um injeta seus próprios dublês, que é exatamente o que os torna rápidos e isolados.
 *
 * `sem-ciclo-de-modulos.spec.ts` lê os `*.module.ts` como texto e é a primeira linha: instantâneo,
 * imprime o caminho do ciclo, e enxerga até módulo que ninguém importou ainda. Mas ele **deduz** o
 * grafo a partir de um regex — e o regex já errou uma vez, acusando ciclo onde havia `forwardRef`.
 *
 * Este aqui não deduz nada: manda o **próprio Nest** montar o grafo, com o mesmo scanner do boot
 * de produção. Reintroduzindo o ciclo de 14/09 ele falha com a mensagem literal do container:
 *
 *     Nest cannot create the TelegramModule instance.
 *     Scope [AppModule -> OrchestratorModule -> ... -> ProjectStateModule -> HealthModule]
 *
 * ── Por que `preview: true` ──────────────────────────────────────────────────
 *
 * Preview mode percorre e resolve o grafo **sem instanciar provider nenhum**: nenhum construtor
 * roda, nenhum `onModuleInit` dispara. Sem isso, subir o `AppModule` num teste abriria conexão
 * com Postgres e Redis, ligaria o long-polling do Telegram e rodaria os ciclos automáticos — um
 * teste que depende de infraestrutura é um teste que fica vermelho por motivo errado, e vermelho
 * por motivo errado é o que se aprende a ignorar.
 *
 * ── O alcance real, corrigido em 17/09 ──────────────────────────────────────
 *
 * Este comentário dizia que **preview não pega dependência de PROVIDER não resolvida**
 * (`Nest can't resolve dependencies of the XService (?)`), porque "isso só aparece na
 * instanciação". **Estava errado, e foi medido:** ao subir o `PanoramaModule` na V2 sem
 * `ConfigModule` registrado, o spec equivalente falhou com exatamente essa mensagem —
 * `Nest can't resolve dependencies of the PanoramaService (PrismaV2Service, ?,
 * SystemStatusService)`.
 *
 * A distinção certa é entre **resolver** e **executar**. Preview resolve o grafo inteiro,
 * incluindo conferir que cada dependência declarada existe no escopo do módulo — daí pegar o
 * erro acima. O que ele não faz é **rodar** construtor e `onModuleInit`, então o que escapa é
 * falha de runtime: provider que lança ao construir, valor de env inválido, conexão que não abre.
 *
 * Subestimar o alcance de um sensor não é conservador — faz alguém construir um segundo sensor
 * para o que o primeiro já cobre.
 *
 * A outra metade da rede é fora daqui: o deploy confere se o container **continuou de pé** depois
 * do `up -d`, em vez de só reportar que subiu. Ver `infra/rayzen-deploy-webhook.sh`.
 */
describe('a aplicação monta o grafo de módulos', () => {
  // O boot em si leva dezenas de milissegundos; o tempo é a compilação de src inteiro pelo ts-jest,
  // que acontece porque este é o único spec que importa o AppModule de verdade.
  jest.setTimeout(120_000)

  it('AppModule sobe sem ciclo e sem módulo indefinido', async () => {
    const ctx = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
      // Sem isto o Nest chama `process.exit(1)` ao falhar, e o Jest morre sem relatar nada.
      abortOnError: false,
    })

    expect(ctx).toBeDefined()
    await ctx.close()
  })
})
