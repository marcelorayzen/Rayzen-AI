import { Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { garantirProjeto } from '../../common/garantir-projeto'
import OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { randomUUID, createHash } from 'crypto'
import { HealthScoreService } from '../health/health.service'
import { EventService } from '../event/event.service'
import { CacheService } from '../cache/cache.service'
import { MetricsService } from '../metrics/metrics.service'
import { RayzenConfigService } from '../configuration/configuration.service'
import {
  ECO_ESCRITA, ECO_LEITURA, TELEMETRIA_HOOK, TOKEN_ARQUIVO,
  ehTextoDerivadoDeEvento, textoLimpo, ehStageValido, STAGES_VALIDOS,
} from './event-derived-text.const'

/**
 * Comando de diagnóstico/inspeção: execução, não intenção do projeto.
 * Só se aplica a evento `execution` — ver classificarEvento().
 */
const CMD_DIAGNOSTICO = /\b(curl|grep|cat|echo|ssh|scp|ls|head|tail|sed|awk|wc|diff|find|jq|ping|node -e|python3?|printf|sleep|docker compose (ps|logs|exec)|git (status|log|diff|ls-files)|test|testar|check|checar|listar|verificar|ver |conferir|diagnostic|inspecionar)\b/i

/**
 * Caminho de scratchpad: arquivo temporário desta sessão, não artefato do projeto.
 * Medido no Rayzen Commerce em 2026-08-17: `Write: C:\...\AppData\Local\Temp\claude\...`
 * entrava como atividade do projeto.
 *
 * Fica aqui e não no `.const` compartilhado porque só a classificação de EVENTO usa —
 * a V2 não classifica evento, só lê texto já gravado.
 */
const CAMINHO_TEMPORARIO = /AppData[\\/]+Local[\\/]+Temp|[\\/]tmp[\\/]claude/i

export interface Milestone {
  id: string
  title: string
  description?: string
  status: 'pending' | 'active' | 'done'
}

export interface PlanningNode {
  id: string
  title: string
  description?: string
}

export interface GraphLink {
  id: string
  sourceId: string
  targetId: string
  label?: string
}

export interface BacklogItem {
  id: string
  title: string
  priority: 'high' | 'medium' | 'low'
}

export interface ProjectStateData {
  objective: string
  stage: string
  blockers: PlanningNode[]
  recentDecisions: string[]
  nextSteps: PlanningNode[]
  risks: string[]
  docGaps: string[]
  riskLevel: 'low' | 'medium' | 'high'
  milestones: Milestone[]
  graphLinks: GraphLink[]
  backlog: BacklogItem[]
  activeFocus: string
  definitionOfDone: string
}

@Injectable()
export class ProjectStateService implements OnModuleInit {
  private readonly logger = new Logger(ProjectStateService.name)
  private llm: OpenAI

  onModuleInit() {
    if (process.env.STATE_BACKFILL_ENABLED === 'false') return
    // Roda só sobre linhas com contentChangedAt nulo, então é idempotente e barato
    // depois da primeira passagem. Fire-and-forget: não deve atrasar a subida da app.
    void this.backfillContentChangedAt().catch(e =>
      this.logger.warn(`Backfill de contentChangedAt falhou: ${e instanceof Error ? e.message : String(e)}`),
    )
  }

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private healthScore: HealthScoreService,
    private eventService: EventService,
    private cache: CacheService,
    private readonly metrics: MetricsService,
    private readonly rayzenConfig: RayzenConfigService,
  ) {
    this.llm = createLlmClient('project-state', {
      apiKey:  this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
    })
  }

  /**
   * Backfill único de `contentChangedAt`, a partir do histórico já gravado.
   *
   * Sem ele todo projeto nasceria com `contentChangedAt = agora` e o sinal ficaria
   * calado por semanas — inclusive no Commerce, que é o caso que motivou a coluna.
   * `conversation_messages` guarda a saída de cada refresh (939 só do Rayzen AI), então
   * "quando o conteúdo mudou pela última vez" é reconstruível.
   *
   * Reconstrói pelo **objetivo**, não pelo hash inteiro: o registro é truncado em 1000
   * chars e `milestones`/`backlog` caem fora do corte. Mas grava o hash **exato** do
   * estado atual — se gravasse um hash parcial, o primeiro refresh seguinte veria
   * diferença onde não houve e zeraria justamente o que o backfill acabou de datar.
   *
   * Sem histórico ou sem casamento, recua para `updatedAt`: conservador, mantém o sinal
   * calado em vez de acusar velhice que não sabe medir.
   */
  async backfillContentChangedAt(): Promise<{ examinados: number; datados: number }> {
    const pendentes = await this.prisma.projectState.findMany({
      where: { contentChangedAt: null },
    })
    let datados = 0

    for (const estado of pendentes) {
      const objetivoAtual = this.titleKey(this.textoLimpo(estado.objective))
      const hash = this.hashConteudo(
        this.textoLimpo(estado.objective),
        this.normalizeMilestones(estado.milestones),
        this.normalizeBacklog(estado.backlog),
      )

      const historico = await this.prisma.conversationMessage.findMany({
        where: { projectId: estado.projectId, module: 'project-state' },
        orderBy: { createdAt: 'desc' },
        select: { content: true, createdAt: true },
      })

      // Caminha para trás enquanto o objetivo for o mesmo; o primeiro que divergir
      // marca o fim da série — a data procurada é a do último que ainda batia.
      //
      // "não deu para ler o registro" e "leu, e depois da limpeza sobrou vazio" são
      // coisas diferentes, e confundi-las quebrava justamente o caso que motivou a
      // coluna: o objetivo do Commerce é derivado de evento, então `textoLimpo` o
      // zera — e um `if (!objetivo) break` parava na primeira volta, devolvendo
      // `updatedAt` (0 dia) onde a resposta certa era 24/06 (54 dias). Vazio é um
      // valor comparável como outro qualquer; só a extração falha interrompe.
      let marco: Date | null = null
      for (const msg of historico) {
        const bruto = this.extrairObjetivo(msg.content)
        if (!bruto) break
        if (this.titleKey(this.textoLimpo(bruto)) !== objetivoAtual) break
        marco = msg.createdAt
      }

      await this.prisma.projectState.update({
        where: { projectId: estado.projectId },
        data: {
          contentHash: hash,
          contentChangedAt: marco ?? estado.updatedAt,
          // `updatedAt` explícito CONGELA a marca d'água — sem isto o `@updatedAt` do
          // Prisma dispara e o backfill empurra o marco do refresh incremental para
          // agora, fazendo o refresh seguinte **pular todos os eventos** entre a data
          // antiga e este momento. Um backfill que existe para datar o passado não
          // pode apagá-lo de passagem.
          updatedAt: estado.updatedAt,
        },
      })
      if (marco) datados++
    }

    if (pendentes.length) {
      this.logger.log(`Backfill de contentChangedAt: ${pendentes.length} estado(s), ${datados} datado(s) pelo histórico`)
    }
    return { examinados: pendentes.length, datados }
  }

  /** Objetivo da saída bruta de um refresh — o registro pode estar truncado. */
  private extrairObjetivo(content: string): string {
    const m = String(content ?? '').match(/"objective"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    return m ? m[1] : ''
  }

  async get(projectId: string): Promise<ProjectStateData & { id: string; projectId: string; updatedAt: string } | null> {
    type Serialized = ReturnType<ProjectStateService['serialize']>
    const cacheKey = `project-state:${projectId}`
    const cached = await this.cache.get<Serialized>(cacheKey)
    if (cached) return cached

    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) {
      // H2 / C09 — "erro de consulta não vira ausência de conhecimento".
      //
      // Devolver `200 null` para um id que não existe faz "não encontrei" e "não consegui
      // consultar" colapsarem no mesmo silêncio: medido contra o Hermes, perguntar pelo estado
      // de um id inexistente fez ele responder com o estado do projeto DEFAULT, sem aviso.
      //
      // Mas `null` tem significado legítimo aqui — projeto real que ainda não teve estado
      // sintetizado —, e quatro consumidores dependem dele (context-hook, as duas pontas do
      // MCP e a web). Por isso a distinção é entre PROJETO inexistente (404, id errado) e
      // estado ainda não gerado (`null`, como antes). A query extra só roda no caminho em que
      // já não havia estado.
      await garantirProjeto(this.prisma, projectId)
      return null
    }
    const result = this.serialize(state)
    await this.cache.set(cacheKey, result, 600)  // 10 min
    return result
  }

  async refresh(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    // Estado atual primeiro — define se este refresh é incremental (anchor no estado
    // existente, só novos eventos desde updatedAt) ou full-synthesis (primeira vez).
    const existing = await this.prisma.projectState.findUnique({ where: { projectId } })
    const isIncremental = Boolean(existing)

    // Coletar contexto: eventos recentes + artefatos de síntese + documentos gerados + meta ativa
    const [events, artifacts, docs, activeGoal] = await Promise.all([
      this.prisma.event.findMany({
        where: isIncremental ? { projectId, ts: { gt: existing!.updatedAt } } : { projectId },
        orderBy: { ts: 'desc' },
        take: 120,
      }),
      this.prisma.sessionArtifact.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        // Incremental: artefatos antigos servem só de contexto narrativo de fundo,
        // não de fonte de verdade pra blockers/nextSteps (esse papel é do `existing`
        // agora) — por isso a janela é bem menor que antes (era 10).
        take: isIncremental ? 3 : 10,
      }),
      this.prisma.projectDocument.findMany({
        where: { projectId },
      }),
      this.prisma.projectGoal.findFirst({
        // Só 'active'. `not: 'achieved'` incluía paused E cancelled — com a meta atual
        // fechada, o objetivo do projeto voltava a ser derivado de uma meta pausada
        // meses antes (observado em 2026-08-07: caiu numa meta de junho). Pausada
        // significa deixada de lado, cancelada significa abandonada; nenhuma das duas
        // é o norte atual. Outros 6 pontos do código já usavam 'active'.
        where: { projectId, status: 'active' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const classificados = events.map(e => ({ evento: e, tier: this.classificarEvento(e) }))
    const eventosIntencao = classificados.filter(c => c.tier === 'intencao').map(c => c.evento)
    const eventosAtividade = classificados.filter(c => c.tier === 'atividade').map(c => c.evento)
    const ruidoCount = classificados.filter(c => c.tier === 'ruido').length

    const eventsText = eventosIntencao
      .slice(0, 80)
      .map(e => {
        const meta = e.metadata as Record<string, unknown> | null
        const modules = (meta?.['graphify'] as { modules?: string[] } | null)?.modules
        const modulePart = modules?.length ? ` [módulos:${modules.join(',')}]` : ''
        return `[${e.ts.toISOString().slice(0, 16)}] [${e.intent ?? e.type}]${modulePart} ${e.content}`
      })
      .join('\n')
      + (ruidoCount > 0 ? `\n(${ruidoCount} comandos operacionais/diagnóstico omitidos — não são sinal estratégico)` : '')

    // Atividade entra AGREGADA e rotulada, nunca como linha de prosa — ver
    // classificarEvento(). Diz onde o trabalho tocou; não enuncia intenção.
    const atividadeText = this.resumirAtividade(eventosAtividade)

    // Módulos mais ativos recentemente (derivado do metadata graphify dos eventos)
    const moduleCounts: Record<string, number> = {}
    for (const e of events) {
      const meta = e.metadata as Record<string, unknown> | null
      const modules = (meta?.['graphify'] as { modules?: string[] } | null)?.modules ?? []
      for (const m of modules) moduleCounts[m] = (moduleCounts[m] ?? 0) + 1
    }
    const activeModules = Object.entries(moduleCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([m, n]) => `${m} (${n} eventos)`)
      .join(', ')

    const artifactsText = artifacts
      .map(a => {
        const c = a.content as Record<string, unknown>
        const decisions = (c['decisions'] as string[] ?? []).slice(0, 3).join('; ')
        const steps = (c['next_steps'] as string[] ?? []).slice(0, 3).join('; ')
        return `Síntese ${a.createdAt.toISOString().slice(0, 10)}: decisões=[${decisions}] próximos=[${steps}]`
      })
      .join('\n')

    const docTypes = docs.map(d => d.type).join(', ')

    // Foco derivado de evento não volta para o prompt: realimentá-lo é o que mantém
    // `Análise da estrutura do projeto` vivo em marcelorayzen-site desde junho.
    const existingFocus = this.textoLimpo(existing?.activeFocus)
    const existingDod = existing?.definitionOfDone ?? ''

    // Estado atual serializado — âncora da atualização incremental. Sem isso, cada
    // refresh regenerava do zero a partir de eventos+sínteses e "ressuscitava" itens
    // já resolvidos (sínteses antigas pesavam igual a sinal novo).
    let currentStateText = ''
    if (existing) {
      const currentBlockers = this.normalizePlanningNodes(existing.blockers, 'blocker').map(b => `- ${b.title}`).join('\n')
      const currentNextSteps = this.normalizePlanningNodes(existing.nextSteps, 'next').map(n => `- ${n.title}`).join('\n')
      const currentDecisions = ((existing.recentDecisions as string[]) ?? []).map(d => `- ${d}`).join('\n')
      const currentRisks = ((existing.risks as string[]) ?? []).map(r => `- ${r}`).join('\n')
      const currentBacklog = this.normalizeBacklog(existing.backlog).map(b => `- ${b.title}`).join('\n')
      currentStateText = `ESTADO ATUAL (gerado em ${existing.updatedAt.toISOString().slice(0, 16)} — esta é a base, você está ATUALIZANDO, não recriando do zero):
Fase atual (stage): ${existing.stage ?? 'não definida'}
Blockers atuais:
${currentBlockers || '(nenhum)'}
Próximos passos atuais:
${currentNextSteps || '(nenhum)'}
Decisões recentes atuais:
${currentDecisions || '(nenhuma)'}
Riscos atuais:
${currentRisks || '(nenhum)'}
Backlog atual:
${currentBacklog || '(nenhum)'}`
    }

    // Meta ativa do Goal Graph — âncora estratégica primária (não sofre com ruído de eventos)
    let goalText = ''
    if (activeGoal) {
      const criteria = (activeGoal.successCriteria as Array<{ text: string; done: boolean }> | null) ?? []
      const pending = criteria.filter(c => !c.done).map(c => `- [ ] ${c.text}`).join('\n')
      const doneC = criteria.filter(c => c.done).map(c => `- [x] ${c.text}`).join('\n')
      goalText = `META ATIVA (Goal Graph): ${activeGoal.title}
${activeGoal.description ?? ''}
Critérios já concluídos:
${doneC || '(nenhum)'}
Critérios pendentes:
${pending || '(nenhum)'}`
    }

    const prompt = `${isIncremental ? 'Atualize o estado deste projeto de software com base no que mudou e retorne JSON estruturado.' : 'Analise o estado atual deste projeto de software e retorne JSON estruturado.'}

Projeto: ${project.name}
Descrição: ${project.description ?? 'não informada'}

${goalText || `Goals: ${project.goals ?? 'não informados'}`}

${currentStateText ? `${currentStateText}\n` : ''}
${activeModules ? `Módulos mais ativos recentemente (por nº de eventos):\n${activeModules}\n` : ''}
${isIncremental ? 'NOVOS eventos de INTENÇÃO desde a última atualização' : 'Eventos de INTENÇÃO recentes'} (mais novo primeiro — decisões, aprendizados e conclusões; é daqui que sai o que o projeto QUER):
${eventsText || (isIncremental ? 'nenhum evento novo desde a última atualização' : 'nenhum evento registrado')}
${atividadeText ? `
ATIVIDADE — arquivos tocados no período, por nº de edições:
${atividadeText}
Isto é evidência de ONDE o trabalho aconteceu. NÃO é enunciado de intenção: um arquivo muito editado indica foco de esforço, jamais o objetivo, o milestone ou o activeFocus do projeto.
` : ''}
${isIncremental ? 'Sínteses antigas (contexto histórico de fundo — NÃO são o estado atual, não derive blockers/nextSteps delas)' : 'Sínteses de sessões anteriores'}:
${artifactsText || 'nenhuma síntese disponível'}

Documentos gerados: ${docTypes || 'nenhum'}

Foco ativo atual: ${existingFocus || 'não definido'}
Critério de done atual: ${existingDod || 'não definido'}

Retorne APENAS JSON válido neste formato (sem markdown, sem texto extra):
{
  "objective": "objetivo atual em uma frase clara e específica",
  "stage": "discovery|building|stabilizing|maintaining|paused",
  "blockers": ["bloqueio 1", "bloqueio 2"],
  "recentDecisions": ["decisão recente 1", "decisão recente 2"],
  "nextSteps": ["próximo passo 1", "próximo passo 2", "próximo passo 3"],
  "risks": ["risco 1", "risco 2"],
  "docGaps": ["documentação faltando 1", "documentação faltando 2"],
  "riskLevel": "low|medium|high",
  "milestones": [{ "title": "...", "status": "pending|active|done" }],
  "backlog": [{ "title": "...", "priority": "high|medium|low" }],
  "activeFocus": "o que está sendo trabalhado agora (string curta) ou vazio",
  "definitionOfDone": "critério de aceite do milestone atual ou vazio"
}

Regras:
- PROIBIDO em objective, activeFocus, milestones, backlog, nextSteps e blockers: nome de arquivo, lista de arquivos, caminho de diretório, ou qualquer frase que apenas repita o que uma ferramenta fez. "Realizar alterações nos arquivos orders.ts, package.json e schema.prisma", "Editar o arquivo CLAUDE.md" e "Análise da estrutura do projeto" são exemplos REAIS de saídas erradas deste mesmo prompt — todas descrevem a ferramenta, nenhuma descreve o porquê. Se você só sabe QUE um arquivo mudou, mas não POR QUE, o campo fica vazio.
- Todo campo responde "por que este trabalho existe", nunca "que comando foi rodado". Prefira o vocabulário da meta e das decisões ao vocabulário do editor de texto.
- objective: ${activeGoal
    ? 'há META ATIVA — o objetivo do projeto é a meta, e quem grava já cuida disso. Devolva o título da meta neste campo e NÃO tente melhorá-lo com o que aconteceu recentemente; os eventos mostram o PROGRESSO rumo à meta, não a substituem.'
    : 'não há meta ativa — derive das DECISÕES, nunca da atividade de arquivo nem de comandos operacionais.'}
- IGNORE descrições de comandos de diagnóstico/inspeção como objetivo ou próximo passo (ex: "testar API", "verificar X", "pegar id via SSH" são execução, não intenção do projeto)
- stage: um de ${STAGES_VALIDOS.join(' | ')}, e nada fora dessa lista.${isIncremental
    ? ' MANTENHA a fase atual mostrada acima, a menos que um evento NOVO mostre transição real de fase — lançamento, congelamento, retomada, entrada em manutenção. Ritmo de trabalho não é mudança de fase: um dia intenso não faz um projeto sair de `building`, e um dia parado não o faz entrar em `maintaining`. Na dúvida, repita a fase atual.'
    : ' derive da atividade observada.'}
- blockers: apenas impedimentos ATIVOS identificados nos eventos recentes
- nextSteps: ${isIncremental
    ? 'NÃO resampleie da lista inteira de critérios pendentes a cada chamada — isso muda a lista mesmo sem progresso real. Só troque/adicione um critério pendente como next-step se um evento NOVO mostra que ele está ativamente sendo trabalhado agora; do contrário, mantenha os next-steps do ESTADO ATUAL.'
    : 'derive dos critérios PENDENTES da meta ativa + eventos/sínteses recentes — não repita itens já concluídos nem liste comandos de diagnóstico'}
- riskLevel: "high" se há blockers críticos, "medium" se há riscos mas progresso, "low" se tudo flui
- milestones: entregas com significado para o projeto, máximo 5 — derive dos CRITÉRIOS da meta ativa e das decisões, nunca de uma edição de arquivo isolada. Se um marco não sobrevive à pergunta "isso é uma entrega ou é um comando?", não é milestone. Marque "done" os que aparecem concluídos nos eventos de intenção
- backlog: itens pendentes derivados das decisões e critérios pendentes, máximo 10; NÃO repita o mesmo item com outras palavras
- NÃO invente campo "id" em lugar nenhum — a identidade é atribuída por quem grava
- activeFocus: o tema do trabalho atual, em vocabulário de projeto (ex: "Onboarding de projeto novo"), não o arquivo aberto. REAVALIE a cada atualização: o "Foco ativo atual" mostrado acima é referência do que valia antes, não a resposta — se os eventos de intenção mais recentes apontam outro trabalho, TROQUE. Se nada recente indica foco algum, devolva vazio em vez de repetir o anterior por inércia
- Máximo 5 itens por array (exceto backlog)
- Se não há dados suficientes para uma categoria, retorne array vazio ou string vazia${isIncremental ? `

REGRAS DE ATUALIZAÇÃO INCREMENTAL (importante — você está editando o ESTADO ATUAL acima, não escrevendo do zero):
- Para cada blocker/next-step ATUAL: se os NOVOS eventos mostram que foi resolvido/concluído/decidido, REMOVA-o da lista de saída — não o repita.
- Itens ATUAIS sem evidência de mudança nos novos eventos permanecem EXATAMENTE como estão (copie-os para a saída). Isto vale para blockers/nextSteps/risks/backlog — NÃO vale para activeFocus nem objective, que são reavaliados a cada atualização.
- Adicione um item novo SOMENTE se há evidência clara nos NOVOS eventos — não infira a partir de sínteses antigas.
- Se não há eventos novos, retorne blockers/nextSteps/recentDecisions/risks/backlog praticamente idênticos ao estado atual (mude só o que houver evidência concreta de ter mudado).
- Um evento de decisão que diga explicitamente "X está resolvido/concluído" é evidência suficiente para remover X — confie nisso, não exija confirmação adicional.` : ''}`

    const llmStart = Date.now()
    const premiumEnabled = (() => { try { return this.rayzenConfig.getConfig().premiumStateRefresh ?? false } catch { return false } })()
    let model = premiumEnabled ? 'gpt-4o-premium' : 'gpt-4o'
    let res = await this.llm.chat.completions.create({
      model,
      temperature: isIncremental ? 0.1 : 0.2,
      messages: [{ role: 'user', content: prompt }],
    }).catch(async (err: unknown) => {
      const status = (err as { status?: number })?.status
      if (status === 429) {
        this.logger.warn(`${model} rate limited — fallback para gpt-4o-mini`)
        model = 'gpt-4o-mini'
        return this.llm.chat.completions.create({
          model,
          temperature: isIncremental ? 0.1 : 0.2,
          messages: [{ role: 'user', content: prompt }],
        })
      }
      throw err
    })

    const raw = res.choices[0].message.content ?? '{}'
    const psTokens = res.usage?.total_tokens ?? 0
    this.metrics.llmTokensTotal.inc({ module: 'project-state', model }, psTokens)
    this.metrics.llmRequestDuration.observe({ module: 'project-state', model }, (Date.now() - llmStart) / 1000)
    this.prisma.conversationMessage.create({
      data: {
        sessionId: `ps-${randomUUID().slice(0, 8)}`,
        module: 'project-state',
        projectId,
        role: 'assistant',
        content: raw.slice(0, 1000),
        tokensUsed: psTokens,
      },
    }).catch(() => null)
    const derived = this.parseSintese(raw)
    if (!derived) {
      // Síntese que não parseou NÃO é síntese vazia — é ausência de síntese.
      //
      // Até 2026-09-06 este `catch` era silencioso e substituía TUDO por vazio:
      // objective '', nextSteps [], milestones [], backlog []. Como
      // `normalizePlanningNodes([])` devolve `[]` (a âncora `previous` só recunha id,
      // não preserva item), o vazio descia intacto até o `upsert` e apagava o
      // planejamento inteiro.
      //
      // Foi o que aconteceu com o Rayzen AI nesta madrugada: em 23/08 o `nextSteps`
      // tinha 4 itens, nenhum refresh rodou até 05/09, e às 00:36 do dia 06 os quatro
      // campos estavam zerados — enquanto as 7 sínteses gravadas em
      // `conversation_messages` mostravam itens. O LLM produziu; o parse falhou; o vazio
      // foi persistido. Nada deu erro, nada apareceu em log, e a perda só foi notada por
      // acaso, duas semanas depois.
      //
      // Agora falha alto e NÃO escreve. Estado velho é infinitamente melhor que estado
      // apagado: velho ainda descreve o projeto, apagado afirma que não há nada.
      this.logger.error(
        `Síntese do ProjectState não parseou para ${projectId} — estado preservado, nada foi gravado. ` +
        `${raw.length} chars, começa com ${JSON.stringify(raw.slice(0, 80))}`,
      )
      if (existing) return this.serialize(existing)
      throw new Error(`Síntese do ProjectState não parseou e não há estado anterior para preservar (projeto ${projectId})`)
    }

    // Com meta ativa, o objetivo NÃO passa pelo LLM — é a meta.
    //
    // A regra "quando há META ATIVA, o objetivo DEVE refletir a meta" já estava no
    // prompt e foi ignorada 105 vezes: medido sobre os 939 refreshes reais do Rayzen
    // AI, o objetivo teve **105 núcleos distintos em 85 dias**, e 76,8% das trocas
    // substituíam a primeira oração inteira — `Corrigir a inicialização dos módulos
    // agent-session e Telegram` é tarefa do momento, não norte do projeto. Havia meta
    // ativa em praticamente todo o período.
    //
    // Mesma lição do `id`: o que tem dono determinístico não se pede ao modelo. Aqui
    // não é só qualidade de texto — é o que viabiliza medir frescor. Com o objetivo
    // seguindo a última tarefa, um hash de conteúdo mudava em 39,5% dos refreshes
    // (~a cada 5h30 no Rayzen AI) e nenhum limiar de dias chegaria a disparar.
    //
    // Sem meta ativa, a cadeia de recuo de antes: síntese limpa, senão o objetivo já
    // gravado (se ele próprio não for derivado de evento), senão vazio — que é honesto,
    // melhor que afirmar que o objetivo do projeto é editar três arquivos.
    const objetivoFinal =
      this.textoLimpo(activeGoal?.title)
      || this.textoLimpo(derived.objective)
      || this.textoLimpo(existing?.objective)
    // activeFocus não recua para o valor anterior: ele é reavaliado a cada refresh, e
    // herdar o anterior é exatamente o que trava `Desenvolvimento do QA Scientist` por
    // semanas. Vazio significa "não há foco declarado agora".
    const focoFinal = this.textoLimpo(derived.activeFocus)

    // `stage` ia CRU do LLM para o banco. Valor fora do enum agora recua para o que já
    // estava gravado — a fase anterior é sempre um palpite melhor que uma string
    // inventada. Mesma família do `hipotese_com_tasktype_valido`.
    const stageFinal = ehStageValido(derived.stage)
      ? derived.stage
      : (ehStageValido(existing?.stage) ? existing.stage : 'building')

    if (derived.stage && !ehStageValido(derived.stage)) {
      this.logger.warn(`Stage inválido descartado (projeto ${projectId}): ${String(derived.stage).slice(0, 60)}`)
    }

    if (derived.objective && !objetivoFinal) {
      this.logger.warn(`Objetivo derivado de evento descartado (projeto ${projectId}): ${String(derived.objective).slice(0, 120)}`)
    }

    // `existing` como âncora de id: a síntese devolve os itens sem id (o prompt só
    // mostra títulos), então sem isso todo refresh recunhava o id e quebrava quem
    // depende de id estável — ver titleKey(). Com `existing` nulo o parâmetro fica
    // undefined e o comportamento é o da criação, então uma chamada serve às duas.
    const blockersFinais = this.normalizePlanningNodes(derived.blockers, 'blocker', existing?.blockers)
    const nextStepsFinais = this.normalizePlanningNodes(derived.nextSteps, 'next', existing?.nextSteps)
    const milestonesFinais = this.normalizeMilestones(derived.milestones, existing?.milestones)
    const backlogFinal = this.normalizeBacklog(derived.backlog, existing?.backlog)

    const hashNovo = this.hashConteudo(objetivoFinal, milestonesFinais, backlogFinal)
    const conteudoMudou = existing?.contentHash !== hashNovo
    const contentChangedAt = conteudoMudou ? new Date() : existing?.contentChangedAt ?? new Date()

    const camposComuns = {
      objective: objetivoFinal,
      stage: stageFinal,
      blockers: blockersFinais as object,
      recentDecisions: derived.recentDecisions as object,
      nextSteps: nextStepsFinais as object,
      risks: derived.risks as object,
      docGaps: derived.docGaps as object,
      riskLevel: derived.riskLevel,
      milestones: milestonesFinais as object,
      backlog: backlogFinal as object,
      activeFocus: focoFinal || null,
      definitionOfDone: derived.definitionOfDone || null,
      contentHash: hashNovo,
      contentChangedAt,
    }

    const state = await this.prisma.projectState.upsert({
      where: { projectId },
      create: { projectId, graphLinks: [], ...camposComuns },
      update: { graphLinks: (existing?.graphLinks ?? []) as object, ...camposComuns },
    })

    // Background: compute health score + promote stale events (Fase 12 & 13)
    this.healthScore.compute(projectId).catch(() => null)
    this.eventService.promoteStaleEvents(projectId).catch(() => null)

    const result = this.serialize(state)
    await this.cache.set(`project-state:${projectId}`, result, 600)
    return result
  }

  async resume(projectId: string): Promise<{
    lastState: ReturnType<ProjectStateService['serialize']> | null
    recentActivity: string[]
    blockers: string[]
    nextBestStep: string
    inactiveSince: string | null
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const [state, recentEvents, lastArtifact] = await Promise.all([
      this.prisma.projectState.findUnique({ where: { projectId } }),
      this.prisma.event.findMany({
        where: { projectId },
        orderBy: { ts: 'desc' },
        take: 15,
      }),
      this.prisma.sessionArtifact.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const serialized = state ? this.serialize(state) : null

    // Calcular inatividade
    const lastEventTs = recentEvents[0]?.ts ?? null
    const inactiveSince = lastEventTs ? lastEventTs.toISOString() : null

    // Resumo de atividade recente
    const recentActivity = recentEvents.slice(0, 8).map(e =>
      `[${e.ts.toISOString().slice(0, 16)}] ${e.content.slice(0, 120)}`
    )

    // Blockers do estado atual
    const blockers = (serialized?.blockers ?? []).map(b => b.title)

    // Next best step: activeFocus > primeiro nextStep > primeiro backlog item
    const nextBestStep = serialized?.activeFocus
      ?? serialized?.nextSteps?.[0]?.title
      ?? ((serialized?.backlog as BacklogItem[])?.[0]?.title ?? '')

    // Se há artefato recente de síntese, usar para enriquecer o brief
    if (lastArtifact) {
      const c = lastArtifact.content as Record<string, unknown>
      const artifactSteps = (c['next_steps'] as string[] ?? []).slice(0, 3)
      const artifactDecisions = (c['decisions'] as string[] ?? []).slice(0, 3)
      recentActivity.push(
        ...artifactDecisions.map(d => `[decisão] ${d}`),
        ...artifactSteps.map(s => `[próximo] ${s}`),
      )
    }

    return {
      lastState: serialized,
      recentActivity,
      blockers,
      nextBestStep,
      inactiveSince,
    }
  }

  async updatePlanning(
    projectId: string,
    patch: {
      milestones?: Milestone[]
      backlog?: BacklogItem[]
      activeFocus?: string
      definitionOfDone?: string
      blockers?: Array<string | PlanningNode>
      nextSteps?: Array<string | PlanningNode>
      graphLinks?: GraphLink[]
    },
  ) {
    const state = await this.prisma.projectState.findUnique({ where: { projectId } })
    if (!state) throw new NotFoundException('Estado do projeto não encontrado')

    // Todos ancorados no estado atual: este patch vem do `rayzen_update_planning`,
    // e sem âncora um update de nextSteps recunharia o id de tudo mais.
    const milestones = patch.milestones !== undefined ? this.normalizeMilestones(patch.milestones, state.milestones) : undefined
    const backlog = patch.backlog !== undefined ? this.normalizeBacklog(patch.backlog, state.backlog) : undefined
    const blockers = patch.blockers !== undefined ? this.normalizePlanningNodes(patch.blockers, 'blocker', state.blockers) : undefined
    const nextSteps = patch.nextSteps !== undefined ? this.normalizePlanningNodes(patch.nextSteps, 'next', state.nextSteps) : undefined
    const graphLinks = patch.graphLinks !== undefined ? this.normalizeGraphLinks(patch.graphLinks) : undefined

    // Edição manual de milestone/backlog é mudança de conteúdo tanto quanto a síntese,
    // e passa pelo mesmo hash — senão `rayzen_update_planning` mexeria no planejamento
    // sem que o sinal de frescor tomasse conhecimento.
    const hashNovo = this.hashConteudo(
      this.textoLimpo(state.objective),
      milestones ?? this.normalizeMilestones(state.milestones),
      backlog ?? this.normalizeBacklog(state.backlog),
    )
    const contentChangedAt = state.contentHash !== hashNovo
      ? new Date()
      : state.contentChangedAt ?? new Date()

    const updated = await this.prisma.projectState.update({
      where: { projectId },
      data: {
        contentHash: hashNovo,
        contentChangedAt,
        ...(milestones !== undefined ? { milestones: milestones as object } : {}),
        ...(backlog !== undefined ? { backlog: backlog as object } : {}),
        ...(patch.activeFocus !== undefined ? { activeFocus: patch.activeFocus || null } : {}),
        ...(patch.definitionOfDone !== undefined ? { definitionOfDone: patch.definitionOfDone || null } : {}),
        ...(blockers !== undefined ? { blockers: blockers as object } : {}),
        ...(nextSteps !== undefined ? { nextSteps: nextSteps as object } : {}),
        ...(graphLinks !== undefined ? { graphLinks: graphLinks as object } : {}),
      },
    })

    await this.cache.del(`project-state:${projectId}`)
    return this.serialize(updated)
  }

  serialize(state: {
    id: string
    projectId: string
    objective: string | null
    stage: string | null
    blockers: unknown
    recentDecisions: unknown
    nextSteps: unknown
    risks: unknown
    docGaps: unknown
    riskLevel: string
    milestones: unknown
    graphLinks?: unknown
    backlog: unknown
    activeFocus: string | null
    definitionOfDone: string | null
    updatedAt: Date
    contentChangedAt?: Date | null
  }) {
    return {
      id: state.id,
      projectId: state.projectId,
      // Limpo também na LEITURA, pelo mesmo motivo do backlog abaixo: o objetivo
      // derivado de evento do Commerce está gravado desde 03/06 e é injetado em todo
      // contexto. Assim ele para de ser servido já, e a primeira escrita seguinte grava
      // a versão corrigida — sem migração.
      objective: this.textoLimpo(state.objective),
      stage: state.stage ?? 'building',
      blockers: this.normalizePlanningNodes(state.blockers, 'blocker'),
      recentDecisions: (state.recentDecisions as string[]) ?? [],
      nextSteps: this.normalizePlanningNodes(state.nextSteps, 'next'),
      risks: (state.risks as string[]) ?? [],
      docGaps: (state.docGaps as string[]) ?? [],
      riskLevel: state.riskLevel as 'low' | 'medium' | 'high',
      milestones: this.normalizeMilestones(state.milestones),
      graphLinks: this.normalizeGraphLinks(state.graphLinks),
      // Normalizado também na LEITURA: o que já está gravado com `uuid-curto` sai
      // limpo daqui sem precisar de migração, e a primeira escrita seguinte grava
      // a versão corrigida.
      backlog: this.normalizeBacklog(state.backlog),
      activeFocus: this.textoLimpo(state.activeFocus),
      definitionOfDone: state.definitionOfDone ?? '',
      updatedAt: state.updatedAt.toISOString(),
      // Recua para updatedAt enquanto o backfill não passou: é a resposta conservadora
      // (finge que o conteúdo é tão novo quanto a escrita), então o sinal fica calado
      // em vez de acusar velhice que não sabe medir.
      contentChangedAt: (state.contentChangedAt ?? state.updatedAt).toISOString(),
    }
  }

  /**
   * Três tiers, não dois — e a classificação é pela FORMA do conteúdo, não pelo campo.
   *
   * O `isNoise` anterior decidia por `type`/`intent`, e por isso deixava passar como
   * sinal máximo justamente o que mais poluía. Medido no Rayzen AI em 2026-08-17, em
   * 7 dias: **292 ecos de ferramenta** (`Edit: <caminho>`, `Write: <caminho>`), **137**
   * `Workspace alterado:` e **48** `hook-timing`. Nenhum era filtrado — `type: 'note'`
   * escapava pela linha `if (e.type !== 'execution') return false`, e **20 dos 292
   * chegavam com `intent: 'decision'`**, que a primeira linha tratava como o sinal mais
   * forte do pipeline. A ordem estava invertida: eco de caminho de arquivo valia mais
   * que decisão de arquitetura.
   *
   * O prompt então perguntava "qual é o objetivo deste projeto?" exibindo 80 linhas de
   * caminho de arquivo, e o modelo respondia honestamente ao que via:
   * `Realizar alterações nos arquivos orders.ts, package.json e schema.prisma` virou o
   * objetivo do Rayzen Commerce em 03/06 e **ficou 75 dias congelado ali**;
   * `Editar o arquivo CLAUDE.md` virou milestone do próprio Rayzen AI.
   *
   * Eco de escrita **não é ruído** — diz ONDE o trabalho tocou, e isso é útil. O que ele
   * nunca faz é ENUNCIAR INTENÇÃO, então vira agregado (resumirAtividade), nunca prosa.
   */
  private classificarEvento(e: { type: string; intent: string | null; content: string }): 'ruido' | 'atividade' | 'intencao' {
    const content = String(e.content ?? '')

    if (TELEMETRIA_HOOK.test(content)) return 'ruido'
    if (ECO_LEITURA.test(content)) return 'ruido'

    // Temp é checado DENTRO do eco de escrita, não solto: uma decisão em prosa que
    // mencione um caminho continua sendo decisão.
    if (ECO_ESCRITA.test(content)) {
      return CAMINHO_TEMPORARIO.test(content) ? 'ruido' : 'atividade'
    }

    if (e.type === 'execution' && CMD_DIAGNOSTICO.test(content)) return 'ruido'

    return 'intencao'
  }

  /**
   * Atividade vira contagem por arquivo, não lista de linhas.
   *
   * 230 linhas de `Edit: .../CLAUDE.md` afogam qualquer enunciado de intenção pelo
   * simples volume; `CLAUDE.md (230×)` diz a mesma coisa em uma linha e não se parece
   * com uma frase que o modelo possa copiar como objetivo.
   */
  private resumirAtividade(events: Array<{ content: string }>): string {
    if (!events.length) return ''

    const contagem = new Map<string, number>()
    for (const e of events) {
      const content = String(e.content ?? '')
      // `Workspace alterado: slug [main@sha] — a.ts, b.ts` traz a lista depois do travessão.
      const lista = content.includes('—') ? content.slice(content.lastIndexOf('—') + 1) : content
      const arquivos = lista.match(TOKEN_ARQUIVO) ?? []
      for (const bruto of arquivos) {
        const nome = bruto.split(/[\\/]/).pop() ?? bruto
        contagem.set(nome, (contagem.get(nome) ?? 0) + 1)
      }
    }
    if (!contagem.size) return ''

    return [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([nome, n]) => `${nome} (${n}×)`)
      .join(', ')
  }

  /**
   * O cinto da síntese, delegado a `event-derived-text.const`.
   *
   * A regra mora lá porque a **V2 precisa da mesma**: o `V1BridgeService` lê a linha
   * crua do Prisma e nunca passa por `serialize()`, então o mesmo ProjectState
   * respondia duas coisas diferentes conforme quem perguntava. Permanece exposto como
   * método privado para não mudar a superfície que os testes já exercitam.
   */
  private ehTextoDerivadoDeEvento(value: unknown): boolean {
    return ehTextoDerivadoDeEvento(value)
  }

  /**
   * Digest dos campos que descrevem O QUE o projeto é — a base de `contentChangedAt`.
   *
   * O escopo foi **medido**, não escolhido: rodando o hash sobre os 1.039 refreshes
   * reais gravados em `conversation_messages`, cada candidato contribuiu assim (Rayzen
   * AI, 939 refreshes em 84 dias):
   *
   *   objetivo ancorado na meta ......   8 mudanças  → 1 a cada ~10 dias  ✅
   *   stage .......................... 92 mudanças  → 1 a cada ~0,9 dia   ❌
   *
   * `stage` é um enum de cinco valores que o LLM re-escolhe a cada refresh e que
   * oscila entre `building` e `stabilizing` sem que nada tenha acontecido: sozinho ele
   * respondia por 92 dos 99 movimentos restantes e derrubava qualquer limiar de dias.
   * Está fora.
   *
   * `activeFocus` está fora por um motivo diferente e mais forte: ele passou a ser
   * **reavaliado a cada refresh e nunca herdado**, de propósito, para não travar em
   * "Desenvolvimento do QA Scientist" por semanas. Um campo desenhado para se mover não
   * pode compor um hash que pergunta "o conteúdo parou?".
   *
   * `recentDecisions` está fora porque é fluxo, não descrição — era ruído por definição.
   *
   * Ordenado para ser insensível a reordenação (trocar dois milestones de lugar não é
   * mudança de conteúdo) e normalizado por titleKey, que já absorve acento, caixa e
   * pontuação. O status do milestone ENTRA: pending→done é progresso real.
   */
  private hashConteudo(objective: string, milestones: Milestone[], backlog: BacklogItem[]): string {
    const partes = [
      `o:${this.titleKey(objective)}`,
      ...milestones.map(m => `m:${this.titleKey(m.title)}:${m.status}`),
      ...backlog.map(b => `b:${this.titleKey(b.title)}`),
    ]
    partes.sort()
    return createHash('sha1').update(partes.join('\n')).digest('hex').slice(0, 16)
  }

  /** Texto que sobrevive ao cinto, ou vazio. */
  private textoLimpo(value: unknown): string {
    return textoLimpo(value)
  }

  private normalizeMilestones(value: unknown, previous?: unknown): Milestone[] {
    if (!Array.isArray(value)) return []

    const idByTitle = this.idsAnteriores(previous)
    // Pré-populado com os ids reancorados: um item novo cunhado nesta passada não pode
    // devolver um id que um item reancorado já está usando. Ver `cunharId`.
    const usados = new Set<string>(idByTitle.values())
    const vistos = new Set<string>()

    return value
      .map((item, index): Milestone | null => {
        const raw = typeof item === 'string'
          ? { title: item } as Record<string, unknown>
          : (item && typeof item === 'object' ? item as Record<string, unknown> : null)
        if (!raw) return null

        const title = typeof raw.title === 'string' ? raw.title.trim() : ''
        if (!title) return null
        // `Editar o arquivo CLAUDE.md` não é marco de projeto — ver ehTextoDerivadoDeEvento.
        if (this.ehTextoDerivadoDeEvento(title)) return null

        const key = this.titleKey(title)
        if (vistos.has(key)) return null
        vistos.add(key)

        const status = raw.status === 'active' || raw.status === 'done' ? raw.status : 'pending'
        const description = typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined

        const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
        const id = rawId && !this.ehIdPlaceholder(rawId)
          ? rawId
          : idByTitle.get(key) ?? this.cunharId('milestone', title, index, usados)
        usados.add(id)

        return { id, title, ...(description ? { description } : {}), status }
      })
      .filter((item): item is Milestone => Boolean(item))
  }

  /**
   * Backlog tem o mesmo tratamento de blocker e next-step: dedup por título e id
   * ancorado no estado anterior.
   *
   * Era o único array que ia cru para o banco — daí os dez itens com o mesmo
   * `uuid-curto` e duas duplicatas exatas ("Filtro seguro e name LIKE..." e "Medir
   * o que o Rayzen entrega hoje" apareceram duas vezes cada) medidos em 2026-08-17.
   */
  private normalizeBacklog(value: unknown, previous?: unknown): BacklogItem[] {
    if (!Array.isArray(value)) return []

    const idByTitle = this.idsAnteriores(previous)
    const usados = new Set<string>(idByTitle.values())
    const vistos = new Set<string>()

    return value
      .map((item, index): BacklogItem | null => {
        const raw = typeof item === 'string'
          ? { title: item } as Record<string, unknown>
          : (item && typeof item === 'object' ? item as Record<string, unknown> : null)
        if (!raw) return null

        const title = typeof raw.title === 'string' ? raw.title.trim() : ''
        if (!title) return null
        if (this.ehTextoDerivadoDeEvento(title)) return null

        const key = this.titleKey(title)
        if (vistos.has(key)) return null
        vistos.add(key)

        const priority = raw.priority === 'high' || raw.priority === 'low' ? raw.priority : 'medium'

        const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
        const id = rawId && !this.ehIdPlaceholder(rawId)
          ? rawId
          : idByTitle.get(key) ?? this.cunharId('backlog', title, index, usados)
        usados.add(id)

        return { id, title, priority }
      })
      .filter((item): item is BacklogItem => Boolean(item))
  }

  /** Id já gravado para cada título, para que o refresh não recunhe identidade. */
  private idsAnteriores(previous: unknown): Map<string, string> {
    const idByTitle = new Map<string, string>()
    if (!Array.isArray(previous)) return idByTitle

    for (const item of previous) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      if (typeof raw.id !== 'string' || typeof raw.title !== 'string') continue
      const id = raw.id.trim()
      if (!id || this.ehIdPlaceholder(id)) continue   // não reancorar no lixo já gravado
      const key = this.titleKey(raw.title)
      if (key && !idByTitle.has(key)) idByTitle.set(key, id)
    }
    return idByTitle
  }

  /**
   * @param previous estado anterior do mesmo campo — usado para reancorar o id de um
   *        item que voltou da síntese sem id (ver comentário em titleKey).
   */
  /**
   * Lê a síntese do LLM, ou devolve `null` — nunca um objeto vazio.
   *
   * A distinção é o ponto. Até 2026-09-06 o `catch` deste parse substituía tudo por
   * vazio (`objective: ''`, `nextSteps: []`, `milestones: []`, `backlog: []`) e seguia
   * adiante. Como `normalizePlanningNodes([])` devolve `[]` — a âncora `previous` só
   * recunha id, não preserva item — o vazio descia intacto até o `upsert` e **apagava o
   * planejamento inteiro**, sem log e sem erro.
   *
   * `null` obriga quem chama a decidir; o objeto vazio decidia sozinho, e decidia errado.
   *
   * O `strip` de code fences continua: Claude não suporta `response_format: json_object`,
   * então cerca a resposta com ```json de vez em quando.
   */
  private parseSintese(raw: string): ProjectStateData | null {
    try {
      const stripped = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()
      const match = stripped.match(/\{[\s\S]*\}/)
      const parsed = JSON.parse(match ? match[0] : stripped) as unknown
      // `JSON.parse('"texto"')` e `JSON.parse('[]')` não lançam e não são uma síntese.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return parsed as ProjectStateData
    } catch {
      return null
    }
  }

  private normalizePlanningNodes(value: unknown, prefix: 'blocker' | 'next', previous?: unknown): PlanningNode[] {
    if (!Array.isArray(value)) return []

    const idByTitle = this.idsAnteriores(previous)
    const usados = new Set<string>(idByTitle.values())
    const seenTitles = new Set<string>()
    return value
      .map((item, index): PlanningNode | null => {
        const raw = typeof item === 'string'
          ? { title: item } as Record<string, unknown>
          : (item && typeof item === 'object' ? item as Record<string, unknown> : null)
        if (!raw) return null

        const title = typeof raw.title === 'string' ? raw.title.trim() : ''
        if (!title) return null
        if (this.ehTextoDerivadoDeEvento(title)) return null

        const key = this.titleKey(title)
        if (seenTitles.has(key)) return null
        seenTitles.add(key)

        const description = typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined

        const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
        const id = rawId && !this.ehIdPlaceholder(rawId)
          ? rawId
          : idByTitle.get(key) ?? this.cunharId(prefix, title, index, usados)
        usados.add(id)

        return { id, title, ...(description ? { description } : {}) }
      })
      .filter((item): item is PlanningNode => Boolean(item))
  }

  /**
   * Chave de identidade por título, tolerante a acento/caixa/pontuação.
   *
   * A síntese mostra ao LLM só os TÍTULOS do estado atual (os ids ficam de fora do
   * prompt), então todo item que o LLM devolve volta sem id e ganhava um `legacyId`
   * novo a cada refresh. Para itens comuns isso é invisível; para os que têm id
   * semântico — `confirmar-<criteriaId>`, criado por warnPendingGoalProposals — era
   * corrupção: perdido o id, o dedup do próximo checkpoint não encontrava o passo e
   * criava um segundo, e `removeConfirmNextStep` nunca conseguia limpar o órfão.
   * Reancorar pelo título mantém o id estável sem precisar mudar o prompt.
   */
  private titleKey(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  private normalizeGraphLinks(value: unknown): GraphLink[] {
    if (!Array.isArray(value)) return []
    return value
      .map((item, index) => {
        if (!item || typeof item !== 'object') return null
        const raw = item as Record<string, unknown>
        const sourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim() : ''
        const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : ''
        if (!sourceId || !targetId || sourceId === targetId) return null
        const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined
        return {
          id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `link-${index}-${sourceId}-${targetId}`,
          sourceId,
          targetId,
          ...(label ? { label } : {}),
        }
      })
      .filter((item): item is GraphLink => Boolean(item))
  }

  /**
   * O modelo copia o placeholder do schema como se fosse valor.
   *
   * Observado em 2026-08-17: o `backlog` do ProjectState voltou com DEZ itens e
   * **todos** com `id: "uuid-curto"` — o placeholder literal do prompt. Item de
   * backlog deixa de ser endereçável: nada consegue apontar para UM item porque
   * todos respondem pela mesma chave.
   *
   * Não é caso isolado: `uuid1`/`uuid2`/`uuid3` de versões anteriores do prompt
   * ainda estão gravados (o banco-imob tem os quatro). Mesma família do invariante
   * `hipotese_com_tasktype_valido`, onde o LLM gravou
   * `"classify|summarize|context_synthesis|null"` como taskType.
   *
   * A defesa de verdade é o prompt não pedir `id` — identidade é responsabilidade
   * de quem persiste, não de quem redige. Isto aqui é o cinto: cobre o que já está
   * no banco e um modelo que resolva inventar o campo mesmo sem ser pedido.
   */
  private ehIdPlaceholder(id: string): boolean {
    return /^(uuid-curto|uuid-?\d*|id|<id>|\.\.\.)$/i.test(id.trim())
  }

  private legacyId(prefix: string, title: string, index: number) {
    const slug = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32)
    return `${prefix}-${index}-${slug || 'item'}`
  }

  /**
   * Cunha o id de um item novo garantindo que ele n\u00e3o colide com nenhum j\u00e1 em uso NESTA
   * passada \u2014 nem os reancorados, nem os que este mesmo `normalize*` j\u00e1 cunhou antes dele.
   *
   * `legacyId` usa a POSI\u00c7\u00c3O do item no array como parte do id, e essa posi\u00e7\u00e3o n\u00e3o \u00e9 um
   * contador est\u00e1vel: \u00e9 relativa ao array de CADA chamada, e a composi\u00e7\u00e3o muda a cada
   * s\u00edntese. Um item reancorado (`idsAnteriores`) carrega o \u00edndice de QUANDO foi cunhado
   * originalmente \u2014 pode ser de uma rodada de semanas atr\u00e1s; um item genuinamente novo
   * ganha o \u00edndice de HOJE. Os dois podem coincidir.
   *
   * Medido em produ\u00e7\u00e3o em 11/09: `next-3-implementar-medicao-de-volume-de` (reancorado,
   * cunhado numa rodada antiga) e `next-3-medir-latencia-real-de-modelos-l` (novo, cunhado
   * hoje na posi\u00e7\u00e3o 3) coexistindo no mesmo `nextSteps` \u2014 o QA Scientist (`gpt-local`)
   * notou o prefixo repetido e abriu uma recomenda\u00e7\u00e3o `consistency` sobre isso. As duas
   * strings completas n\u00e3o eram id\u00eanticas (a colis\u00e3o parou no prefixo, por sorte de os
   * slugs divergirem), mas o mecanismo que produziu isso continuava podendo gerar id
   * ID\u00caNTICO na pr\u00f3xima rodada, se um slug de 32 chars por acaso coincidisse.
   *
   * A cura n\u00e3o muda o FORMATO do id \u2014 nenhuma migra\u00e7\u00e3o \u00e9 necess\u00e1ria para o que j\u00e1 est\u00e1
   * gravado \u2014 s\u00f3 garante que um id novo nunca reutiliza um que j\u00e1 est\u00e1 em jogo. `usados`
   * chega pr\u00e9-populado com todo id reancorado desta passada; um item novo que cairia na
   * mesma posi\u00e7\u00e3o avan\u00e7a para a pr\u00f3xima livre.
   */
  private cunharId(prefix: string, title: string, index: number, usados: ReadonlySet<string>): string {
    let i = index
    let id = this.legacyId(prefix, title, i)
    while (usados.has(id)) {
      i++
      id = this.legacyId(prefix, title, i)
    }
    return id
  }
}
