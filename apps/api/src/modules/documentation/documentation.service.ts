import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ProjectStateService } from '../project-state/project-state.service'
import { ProjectState } from '@prisma/client'
import OpenAI from 'openai'
import { createLlmClient } from '../../common/llm-client'
import { randomUUID } from 'crypto'
import { MetricsService } from '../metrics/metrics.service'

export type DocType =
  | 'project_state'
  | 'decisions_log'
  | 'next_actions'
  | 'work_journal'
  | 'test_evidence'

type LlmDocType = 'project_state' | 'decisions_log' | 'next_actions' | 'work_journal'

/**
 * Piso entre regenerações do mesmo documento.
 *
 * Até 2026-09-06 não havia piso nenhum: `generate()` sempre ia ao LLM, e `force`
 * só ignorava a proteção de "revisado à mão". O caminho automático
 * (`SmartCheckpointService`, a cada 10min) passava `force: true` — que ele de fato
 * precisa, para sobrescrever documento revisado — e levava o bypass de frescor de
 * carona. **Um flag respondendo duas perguntas diferentes.**
 *
 * O desequilíbrio que o piso corrige: estes documentos são um rollup de **30 dias**
 * de artefatos + 60 eventos + estado + meta. Em 10 minutos entram ~5 eventos numa
 * janela de 60 — **~92% da entrada é a mesma** — e o documento é reescrito inteiro.
 *
 * Uma hora, e não "só grave se mudou": medido em 7 dias, `project_state` teve **74
 * versões e ZERO byte-idênticas**. O LLM reformula sempre, mesmo sem informação
 * nova, então a chamada é justamente o que descobriria que não mudou. Piso de tempo
 * é o único gate que evita a chamada.
 *
 * Furado por `ignorarFrescor`, que só duas coisas usam: pedido humano (`?force=true`
 * na rota) e gatilho `decision_detected` — decisão precisa chegar no `decisions_log`
 * na hora.
 */
const PISO_DE_REGENERACAO_MS = 60 * 60 * 1000

const DOC_PROMPTS: Record<LlmDocType, (ctx: string) => string> = {
  project_state: (ctx) => `Com base no contexto abaixo, escreva um documento markdown "Estado do Projeto".

IMPORTANTE: A seção "## Estado atual do projeto" contém o estado mais recente e preciso — use-a como fonte primária. Os eventos recentes complementam com detalhes das últimas ações.

Estrutura:
- Status atual (fase e objetivo agora)
- O que foi concluído recentemente (baseado nos eventos recentes)
- Foco ativo e próximos marcos
- Bloqueios ou riscos ativos

${ctx}

Seja objetivo, use marcadores. Máximo 400 palavras.`,

  decisions_log: (ctx) => `Com base no histórico abaixo, escreva um documento markdown "Log de Decisões" listando todas as decisões técnicas e de produto identificadas, no formato:

## [Data] Título da decisão
**Contexto:** ...
**Decisão:** ...
**Motivo:** ...

${ctx}

Liste apenas decisões reais identificadas no histórico. Se não houver data precisa, use "Recente".`,

  next_actions: (ctx) => `Com base no contexto abaixo, escreva um documento markdown "Próximas Ações".

REGRAS ESTRITAS:
1. A "## Meta ativa (Goal Graph)" e seus "Critérios pendentes" são a fonte primária — derive as próximas ações deles e dos "Próximos passos" do Estado atual.
2. NUNCA transforme descrição de comando/diagnóstico em ação (ex: "Testar API", "Pegar id via SSH", "Confirmar imports", "Diagnosticar X"). Esses são execução passada, não intenção do projeto.
3. Sínteses contêm itens frequentemente JÁ CONCLUÍDOS. Só reutilize se aparecer também no estado atual/meta como pendente.
4. Se um tema aparece nos eventos como feito (ex: "Edit: arquivo.ts", "Bash: deploy"), trate como concluído — não liste.
5. Não inclua itens genéricos sem evidência de que estão pendentes agora.

${ctx}

Formato:
## Área
- [ ] Ação específica e acionável

Máximo 8 ações. Remove duplicatas. Ordena por impacto real no momento atual.`,

  work_journal: (ctx) => `Com base no contexto abaixo, escreva um documento markdown "Diário de Trabalho".

IMPORTANTE:
- Ordene as entradas do MAIS RECENTE para o MAIS ANTIGO (ordem cronológica inversa — último trabalho no topo).
- Use os eventos recentes (seção "## Eventos recentes") como fonte principal — eles já estão ordenados do mais novo para o mais antigo.
- Cada entrada deve ter cabeçalho com a data real dos eventos (ex: "## 20/05/2026"). Não invente datas.
- Não misture datas: uma entrada por data/sessão distinta.

${ctx}

Formato:
## DD/MM/AAAA — [tema da sessão]
Narrativa técnica do que foi feito, decidido e aprendido nessa data.

Tom técnico e direto. Máximo 600 palavras.`,
}

// Diff simples linha a linha: retorna linhas adicionadas (+) e removidas (-)
function computeDiff(oldText: string, newText: string): string {
  const oldLines = new Set(oldText.split('\n').map(l => l.trim()).filter(Boolean))
  const newLines = new Set(newText.split('\n').map(l => l.trim()).filter(Boolean))

  const removed = [...oldLines].filter(l => !newLines.has(l)).map(l => `- ${l}`)
  const added   = [...newLines].filter(l => !oldLines.has(l)).map(l => `+ ${l}`)

  if (removed.length === 0 && added.length === 0) return '(sem alterações significativas)'
  return [...removed, ...added].slice(0, 60).join('\n')
}

@Injectable()
export class DocumentationService {
  private llm: OpenAI

  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private readonly projectStateService: ProjectStateService,
    private readonly metrics: MetricsService,
  ) {
    this.llm = createLlmClient('documentation', {
      apiKey:  this.config.get('LITELLM_MASTER_KEY') ?? 'sk-rayzen',
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
    })
  }

  async generate(
    projectId: string,
    type: DocType,
    opts: { force?: boolean; ignorarFrescor?: boolean; _preloadedState?: ProjectState | null } = {},
  ): Promise<{ id: string; type: string; content: string; generatedAt: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    // Verificar proteção de revisão manual
    const existing = await this.prisma.projectDocument.findUnique({
      where: { projectId_type: { projectId, type } },
    })

    if (existing?.reviewedAt && !opts.force) {
      throw new BadRequestException(
        'Este documento foi revisado manualmente. Use force=true para regenerar.',
      )
    }

    if (!opts.ignorarFrescor && existing && Date.now() - existing.generatedAt.getTime() < PISO_DE_REGENERACAO_MS) {
      return {
        id:          existing.id,
        type:        existing.type,
        content:     existing.content,
        generatedAt: existing.generatedAt.toISOString(),
      }
    }

    // Se não foi chamado pelo generateAll (que já fez um refresh único), auto-refresh aqui
    if (!opts._preloadedState) {
      await this.projectStateService.refresh(projectId).catch(() => {})
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Coletar contexto com IDs rastreáveis
    const [artifacts, events, projectState, activeGoal] = await Promise.all([
      this.prisma.sessionArtifact.findMany({
        where: { projectId, createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.event.findMany({
        where: {
          projectId,
          memoryClass: { in: ['consolidated', 'working', 'inbox'] },
        },
        orderBy: { ts: 'desc' },
        take: 60,
      }),
      opts._preloadedState !== undefined
        ? Promise.resolve(opts._preloadedState)
        : this.prisma.projectState.findUnique({ where: { projectId } }),
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

    // Ruído operacional: comandos de diagnóstico não viram "próximas ações"
    const NOISE_CMD = /\b(curl|grep|cat|echo|ssh|scp|ls|head|tail|sed|awk|wc|diff|find|jq|ping|node -e|python3?|printf|sleep|docker compose (ps|logs|exec)|git (status|log|diff|ls-files)|test|testar|check|checar|listar|verificar|ver |conferir|diagnostic|inspecionar)\b/i
    const isNoise = (e: typeof events[number]): boolean =>
      e.intent !== 'decision' && e.type === 'execution' && NOISE_CMD.test(String(e.content))

    const sourceIds = [
      ...artifacts.map(a => a.id),
      ...events.map(e => e.id),
    ]

    // Montar contexto
    const synthLines = artifacts.map(a => {
      const c = a.content as { summary?: string; decisions?: string[]; next_steps?: string[]; learnings?: string[] }
      return [
        `### Sessão ${new Date(a.createdAt).toLocaleDateString('pt-BR')}`,
        c.summary && `**Resumo:** ${c.summary}`,
        c.decisions?.length && `**Decisões:** ${c.decisions.join('; ')}`,
        c.next_steps?.length && `**Próximos passos:** ${c.next_steps.join('; ')}`,
        c.learnings?.length && `**Aprendizados:** ${c.learnings.join('; ')}`,
      ].filter(Boolean).join('\n')
    }).join('\n\n')

    const eventLines = events
      .filter(e => e.type !== 'message' && !isNoise(e))
      .slice(0, 40)
      .map(e => `- [${new Date(e.ts).toLocaleDateString('pt-BR')}] [${e.intent ?? e.source}/${e.type}] ${e.content}`)
      .join('\n')

    // Estado atual do projeto (fonte mais confiável do que está acontecendo agora)
    const stateLines = projectState ? [
      `**Fase:** ${projectState.stage ?? ''}`,
      `**Objetivo atual:** ${projectState.objective ?? ''}`,
      projectState.activeFocus ? `**Foco ativo:** ${projectState.activeFocus}` : '',
      (projectState.recentDecisions as string[] ?? []).length
        ? `**Decisões recentes:** ${(projectState.recentDecisions as string[]).join('; ')}` : '',
      (projectState.nextSteps as Array<{title:string}> ?? []).length
        ? `**Próximos passos:** ${(projectState.nextSteps as Array<{title:string}>).map(s => s.title ?? s).join('; ')}` : '',
      (projectState.blockers as Array<{title:string}> ?? []).length
        ? `**Blockers:** ${(projectState.blockers as Array<{title:string}>).map(b => b.title ?? b).join('; ')}` : '',
    ].filter(Boolean).join('\n') : ''

    // Meta ativa do Goal Graph — âncora das próximas ações (critérios pendentes)
    let goalLines = ''
    if (activeGoal) {
      const criteria = (activeGoal.successCriteria as Array<{ text: string; done: boolean }> | null) ?? []
      const pending = criteria.filter(c => !c.done).map(c => `- [ ] ${c.text}`).join('\n')
      goalLines = [
        `**Meta:** ${activeGoal.title}`,
        pending && `**Critérios pendentes (base para próximas ações):**\n${pending}`,
      ].filter(Boolean).join('\n')
    }

    const context = [
      `# Projeto: ${project.name}`,
      goalLines ? `## Meta ativa (Goal Graph)\n${goalLines}` : (project.goals && `**Objetivos:** ${project.goals}`),
      stateLines && `## Estado atual do projeto\n${stateLines}`,
      synthLines && `## Sínteses de sessão\n${synthLines}`,
      eventLines && `## Eventos recentes\n${eventLines}`,
    ].filter(Boolean).join('\n\n')

    if (type === 'test_evidence') {
      return this.generateTestEvidence(projectId)
    }

    const promptFn = DOC_PROMPTS[type as LlmDocType]
    if (!promptFn) throw new BadRequestException(`Tipo inválido: ${type}`)

    const llmStart = Date.now()
    const res = await this.llm.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [{ role: 'user', content: promptFn(context) }],
    })

    const newContent = res.choices[0].message.content ?? ''
    const docTokens = res.usage?.total_tokens ?? 0
    this.metrics.llmTokensTotal.inc({ module: 'documentation', model: 'gpt-4o-mini' }, docTokens)
    this.metrics.llmRequestDuration.observe({ module: 'documentation', model: 'gpt-4o-mini' }, (Date.now() - llmStart) / 1000)
    this.prisma.conversationMessage.create({
      data: {
        sessionId: `doc-${randomUUID().slice(0, 8)}`,
        module: 'documentation',
        projectId,
        role: 'assistant',
        content: newContent.slice(0, 1000),
        tokensUsed: docTokens,
      },
    }).catch(() => null)

    // Salvar versão anterior antes de sobrescrever
    if (existing) {
      const diff = computeDiff(existing.content, newContent)
      await this.prisma.projectDocumentVersion.create({
        data: {
          documentId: existing.id,
          content: existing.content,
          previousContent: null, // esta versão era a "anterior"
          diff,
          reason: opts.force ? 'force_regenerated' : 'regenerated',
          sourceIds: sourceIds as object,
        },
      })
    }

    const doc = await this.prisma.projectDocument.upsert({
      where: { projectId_type: { projectId, type } },
      create: { projectId, type, content: newContent },
      update: { content: newContent, generatedAt: new Date(), reviewedAt: null },
    })

    return { id: doc.id, type: doc.type, content: doc.content, generatedAt: doc.generatedAt.toISOString() }
  }

  async generateAll(projectId: string, opts: { force?: boolean; ignorarFrescor?: boolean } = {}) {
    // Pula refresh se state foi atualizado há menos de 15min
    const existingState = await this.prisma.projectState.findUnique({ where: { projectId } })
    const isRecent = existingState && (Date.now() - existingState.updatedAt.getTime() < 15 * 60 * 1000)
    if (!isRecent) {
      await this.projectStateService.refresh(projectId).catch(() => {})
    }
    const freshState = await this.prisma.projectState.findUnique({ where: { projectId } })

    const types: DocType[] = ['project_state', 'decisions_log', 'next_actions', 'work_journal', 'test_evidence']

    // EM SÉRIE, não em paralelo — e o motivo é medido, não estilístico.
    //
    // Com `Promise.allSettled` os quatro documentos partiam no mesmo instante, e cada um
    // carrega um rollup de **30 dias**. Quatro prompts grandes no mesmo segundo estouram o
    // limite de **tokens por minuto** do free tier da Groq, não o de requisições — por isso
    // o sintoma era 429 em rajada, e não latência.
    //
    // Medido em 2026-09-08, 36h, já descontada a sonda: `rayzen:v1:documentation` fez 68
    // chamadas a `gpt-4o-mini` e **40 falharam**, todas por cota. No mesmo grupo e na mesma
    // janela, a sonda fez 86 chamadas com **zero** erro — o provedor estava bem; quem não
    // cabia era a rajada.
    //
    // Em série o trabalho total é o mesmo; só deixa de chegar todo de uma vez. Não há perda
    // de tempo de parede que importe: este caminho é fire-and-forget desde a origem
    // (`SmartCheckpointService`), e ninguém espera por ele.
    const resultados: Array<{ type: DocType; ok: boolean; generatedAt?: string; error?: string }> = []
    for (const type of types) {
      try {
        const r = await this.generate(projectId, type, { ...opts, _preloadedState: freshState })
        resultados.push({ type, ok: true, generatedAt: r.generatedAt })
      } catch (e) {
        // Um tipo que falha NÃO interrompe os outros — era a única coisa que o
        // `allSettled` garantia, e ela se preserva.
        resultados.push({ type, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return resultados
  }

  async list(projectId: string) {
    return this.prisma.projectDocument.findMany({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
      select: { id: true, type: true, content: true, generatedAt: true, reviewedAt: true },
    })
  }

  async getVersions(projectId: string, type: DocType) {
    const doc = await this.prisma.projectDocument.findUnique({
      where: { projectId_type: { projectId, type } },
    })
    if (!doc) return []

    return this.prisma.projectDocumentVersion.findMany({
      where: { documentId: doc.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        content: true,
        diff: true,
        reason: true,
        sourceIds: true,
        createdAt: true,
      },
    })
  }

  async markReviewed(projectId: string, type: DocType) {
    return this.prisma.projectDocument.update({
      where: { projectId_type: { projectId, type } },
      data: { reviewedAt: new Date() },
    })
  }

  async generateTestEvidence(projectId: string): Promise<{ id: string; type: string; content: string; generatedAt: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const events = await this.prisma.event.findMany({
      where: { projectId, source: 'execution', type: 'note' },
      orderBy: { ts: 'desc' },
      take: 100,
    })

    const evidence = events
      .map((event) => ({ event, metadata: (event.metadata ?? {}) as Record<string, unknown> }))
      .filter(({ metadata }) => metadata.kind === 'evidence' && metadata.evidenceType === 'screenshot')

    const categoryLabels: Record<string, string> = {
      api_test: 'Testes de API',
      manual_test: 'Testes manuais',
      bug: 'Bugs encontrados',
      fix: 'Evidências de correção',
      general: 'Gerais',
    }

    const byCategory = new Map<string, Array<{ event: typeof events[number]; metadata: Record<string, unknown> }>>()
    for (const item of evidence) {
      const category = typeof item.metadata.category === 'string' ? item.metadata.category : 'general'
      const current = byCategory.get(category) ?? []
      current.push(item)
      byCategory.set(category, current)
    }

    const lines = [...byCategory.entries()].map(([category, items]) => {
      const entries = items.map(({ event, metadata }) => {
      const description =
        typeof metadata.description === 'string' && metadata.description.trim()
          ? metadata.description
          : typeof metadata.prompt === 'string' && metadata.prompt.trim()
            ? metadata.prompt
            : 'Screenshot sem descrição'
      const remotePath = typeof metadata.remotePath === 'string' ? metadata.remotePath.replace(/\\/g, '/') : null
      const evidenceLink = remotePath ? `[Abrir screenshot](/evidence/file/${remotePath})` : '_arquivo ainda não sincronizado_'
      const localPath = typeof metadata.path === 'string' ? metadata.path : null
      const testRunId = typeof metadata.testRunId === 'string' ? metadata.testRunId : null

      return [
        `### ${new Date(event.ts).toLocaleString('pt-BR')}`,
        `**Descrição:** ${description}`,
        `**Evidência:** ${evidenceLink}`,
        testRunId ? `**TestRun vinculado:** \`${testRunId}\`` : null,
        localPath ? `**Arquivo local:** \`${localPath}\`` : null,
      ].filter(Boolean).join('\n')
      })

      return [
        `## ${categoryLabels[category] ?? category}`,
        entries.join('\n\n'),
      ].join('\n\n')
    })

    const content = [
      `# Evidências de Teste — ${project.name}`,
      `**Gerado em:** ${new Date().toLocaleString('pt-BR')}`,
      `**Total de evidências:** ${evidence.length}`,
      '',
      evidence.length > 0 ? lines.join('\n\n---\n\n') : '_Nenhuma evidência visual registrada ainda._',
    ].join('\n')

    const doc = await this.prisma.projectDocument.upsert({
      where: { projectId_type: { projectId, type: 'test_evidence' } },
      create: { projectId, type: 'test_evidence', content },
      update: { content, generatedAt: new Date(), reviewedAt: null },
    })

    return { id: doc.id, type: doc.type, content: doc.content, generatedAt: doc.generatedAt.toISOString() }
  }

}
