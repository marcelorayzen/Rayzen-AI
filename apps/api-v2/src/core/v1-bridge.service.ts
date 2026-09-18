import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

// V2 nunca escreve no schema public. Apenas lê dados V1.
@Injectable()
export class V1BridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly prismaV1: PrismaClient

  constructor() {
    this.prismaV1 = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    })
  }

  async onModuleInit() {
    await this.prismaV1.$connect()
  }

  async onModuleDestroy() {
    await this.prismaV1.$disconnect()
  }

  async getProject(id: string) {
    return this.prismaV1.project.findUnique({ where: { id } })
  }

  async getProjectState(projectId: string) {
    return this.prismaV1.projectState.findFirst({ where: { projectId } })
  }

  /**
   * Quantos eventos entraram desde um marco — a medida de "quanta realidade se
   * acumulou" que o sinal de frescor do ProjectState usa para separar projeto PARADO
   * (poucos eventos, estado certo) de estado ATRASADO (muitos eventos, descrição
   * ficou para trás).
   */
  async countEventsSince(projectId: string, since: Date): Promise<number> {
    return this.prismaV1.event.count({ where: { projectId, ts: { gt: since } } })
  }

  async getRecentEvents(projectId: string, take = 20) {
    return this.prismaV1.event.findMany({
      where: { projectId },
      orderBy: { ts: 'desc' },
      take,
      select: { id: true, type: true, source: true, content: true, ts: true, metadata: true },
    })
  }

  async getProjectGoal(projectId: string) {
    return this.prismaV1.projectGoal.findFirst({
      // Só 'active'. `not: 'achieved'` incluía paused E cancelled — com a meta atual
      // fechada, o objetivo do projeto voltava a ser derivado de uma meta pausada
      // meses antes (observado em 2026-08-07: caiu numa meta de junho). Pausada
      // significa deixada de lado, cancelada significa abandonada; nenhuma das duas
      // é o norte atual. Outros 6 pontos do código já usavam 'active'.
      where: { projectId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Documentos de aprendizado indexados pelo `captureLearning` da V1.
   *
   * A V2 precisa deles porque o ciclo de vida (`memory_meta`) mora aqui, e quem
   * grava o aprendizado é a V1 — os dois lados nunca se falaram, então em
   * 2026-08-16 havia 20 aprendizados no Brain com ZERO linha de ciclo de vida.
   * Consequência prática: caíam no default `inbox` e, em modo `architecture`,
   * recebiam boost 0 contra +0.20 de `consolidated`. As decisões rankeavam abaixo
   * de tudo justamente no modo onde decisão importa mais.
   *
   * `metadata.learningType` vem do `captureLearning` e é o que permite derivar o
   * `memoryType` sem adivinhar pelo texto.
   */
  async listLearningDocuments(projectId?: string) {
    return this.prismaV1.document.findMany({
      where: {
        sourcePath: { startsWith: 'learning/' },
        ...(projectId ? { projectId } : {}),
      },
      select: { id: true, projectId: true, sourcePath: true, metadata: true },
      take: 500,
    })
  }

  async listProjects() {
    return this.prismaV1.project.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, repoSlug: true, description: true },
      orderBy: { updatedAt: 'desc' },
    })
  }

  /**
   * Horas desde a última execução de teste do projeto. `null` = nunca houve.
   *
   * Alimenta o sinal `semTesteRodado` do Guardian. Medido em 2026-08-13: das 112
   * execuções registradas, 104 vêm do CI (github-actions) — então isto responde
   * "o CI já validou o que está aí?", não "você rodou jest local".
   */
  async horasDesdeUltimoTeste(projectId: string): Promise<number | null> {
    const ultimo = await this.prismaV1.testRun.findFirst({
      where:   { projectId },
      orderBy: { executedAt: 'desc' },
      select:  { executedAt: true },
    })
    if (!ultimo) return null
    return (Date.now() - ultimo.executedAt.getTime()) / 3_600_000
  }

  /**
   * Registros sem dono no schema `public` — evento e documento com `project_id` nulo.
   *
   * Duas origens, e as duas importam. **Nascer órfão**: o hook não resolveu o
   * `repoSlug` e gravou sem projeto — é a assinatura observável de a resolução ter
   * quebrado. **Ficar órfão**: `Event` e `Document` são `onDelete: SetNull`, então
   * apagar um projeto preserva o dado e some com o dono.
   *
   * Nos dois casos o registro fica invisível para toda consulta com escopo de
   * projeto — que é o Rayzen inteiro — e continua ocupando o Brain.
   *
   * `recentes` é a janela que interessa ao sensor: responde "está acontecendo
   * agora?" em vez de "já aconteceu alguma vez".
   */
  async registrosSemProjeto(desde: Date): Promise<{
    eventos: number; eventosRecentes: number
    documentos: number; documentosRecentes: number
  }> {
    // ── Conversa geral NAO e registro orfao ──────────────────────────────────
    //
    // Decisao de Marcelo em 17/09: conversa sem projeto vinculado e o **contexto geral**, e e
    // deliberada — o HUB vai abrir assim, sem pedir selecao. `source: 'chat'` com `projectId`
    // nulo e exatamente essa marca: o orquestrador SEMPRE passa `projectId`, ele so vem
    // `undefined` quando a conversa nao tem projeto.
    //
    // Contar isso como orfao conflundia duas coisas opostas: trabalho que PERDEU o dono (hook
    // fora de repositorio registrado, indexacao sem escopo) e conversa que nunca teve dono por
    // escolha. O invariante existe para a primeira.
    //
    // Excluir por `source` e nao por um campo novo porque a distincao JA ESTAVA no dado — criar
    // marcador seria inventar mecanismo para algo que o schema ja dizia.
    //
    // `hub` entrou em 18/09, no dia em que a conversa do HUB passou a chegar aqui: ela nasce sem
    // projeto porque o HUB abre **sem pedir escopo** — é literalmente o contexto geral que a
    // decisão de 17/09 tornou deliberado. Deixar de fora seria contar como defeito a coisa que a
    // decisão chamou de certa. A lista é de CANAIS DE CONVERSA, e cresce quando nasce um canal —
    // não quando nasce um módulo.
    // ── A lista de canais saiu em 18/09, e o motivo e o conserto ser melhor ──
    //
    // Ela existia porque "sem projeto" era AUSENCIA, e ausencia nao distingue "geral deliberado"
    // de "perdeu o dono" — entao o `source` fazia as vezes de marcador, e a lista crescia a cada
    // canal novo (`chat`, depois `hub`...). Pior: `Document` nao tem `source`, entao la a
    // distincao nem existia.
    //
    // Com o contexto geral virando um Project de verdade (`common/escopo-geral.const.ts`), o
    // registro geral TEM dono. O que sobra sem dono e so o que de fato perdeu — que e a pergunta
    // que este invariante sempre quis fazer.
    const soPerdeuDono = { projectId: null }

    const [eventos, eventosRecentes, documentos, documentosRecentes] = await Promise.all([
      this.prismaV1.event.count({ where: soPerdeuDono }),
      this.prismaV1.event.count({ where: { ...soPerdeuDono, ts: { gte: desde } } }),
      this.prismaV1.document.count({ where: { projectId: null } }),
      this.prismaV1.document.count({ where: { projectId: null, createdAt: { gte: desde } } }),
    ])
    return { eventos, eventosRecentes, documentos, documentosRecentes }
  }

  /**
   * Caminhos indexados no Brain, para auditar o acervo por `sourcePath`.
   *
   * Existe para o invariante `segredo_nao_indexado`, e a escolha de trazer **só o
   * caminho** é deliberada: para responder "há credencial no acervo?" basta o nome, e
   * carregar o `content` significaria puxar o segredo para dentro de outro processo,
   * de outro log e de outra mensagem de erro. O sensor não precisa ver o que denuncia.
   *
   * Sem `projectId` varre o acervo inteiro — segredo indexado sob o dono errado
   * continua sendo segredo indexado, e em 2026-08-22 mediu-se que 194 documentos
   * estavam justamente sob o projeto errado.
   */
  async listarCaminhosIndexados(projectId?: string, take = 5000) {
    return this.prismaV1.document.findMany({
      where:  {
        sourcePath: { not: null },
        ...(projectId ? { projectId } : {}),
      },
      select:  { id: true, projectId: true, sourcePath: true },
      orderBy: { createdAt: 'desc' },
      take,
    })
  }

}
