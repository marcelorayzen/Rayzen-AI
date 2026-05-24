import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { ProjectStateService } from '../project-state/project-state.service'
import { ProjectState } from '@prisma/client'
import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import { MetricsService } from '../metrics/metrics.service'

export type DocType =
  | 'project_state'
  | 'decisions_log'
  | 'next_actions'
  | 'work_journal'
  | 'test_evidence'
  | 'data_map'
  | 'ropa'
  | 'quality_report'

type LlmDocType = 'project_state' | 'decisions_log' | 'next_actions' | 'work_journal'

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
1. A seção "## Estado atual do projeto" é a fonte primária e mais confiável — use seus "Próximos passos" como lista base.
2. Sínteses de sessão contêm itens frequentemente JÁ CONCLUÍDOS. Só reutilize um item de síntese se ele TAMBÉM aparece no estado atual ou há evidência nos eventos recentes de que ainda está pendente.
3. Se um tema aparece nos eventos recentes como algo feito (ex: "Edit: synthesis.service.ts", "Bash: deploy"), trate como concluído — não coloque na lista.
4. Não inclua itens genéricos ou vagas como "Testar integração" sem evidência de que está pendente agora.

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
    this.llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })
  }

  async generate(
    projectId: string,
    type: DocType,
    opts: { force?: boolean; _preloadedState?: ProjectState | null } = {},
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

    // Se não foi chamado pelo generateAll (que já fez um refresh único), auto-refresh aqui
    if (!opts._preloadedState) {
      await this.projectStateService.refresh(projectId).catch(() => {})
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    // Coletar contexto com IDs rastreáveis
    const [artifacts, events, projectState] = await Promise.all([
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
        take: 50,
      }),
      opts._preloadedState !== undefined
        ? Promise.resolve(opts._preloadedState)
        : this.prisma.projectState.findUnique({ where: { projectId } }),
    ])

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
      .filter(e => e.type !== 'message')
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

    const context = [
      `# Projeto: ${project.name}`,
      project.goals && `**Objetivos:** ${project.goals}`,
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

  async generateAll(projectId: string, opts: { force?: boolean } = {}) {
    // Pula refresh se state foi atualizado há menos de 15min
    const existingState = await this.prisma.projectState.findUnique({ where: { projectId } })
    const isRecent = existingState && (Date.now() - existingState.updatedAt.getTime() < 15 * 60 * 1000)
    if (!isRecent) {
      await this.projectStateService.refresh(projectId).catch(() => {})
    }
    const freshState = await this.prisma.projectState.findUnique({ where: { projectId } })

    const types: DocType[] = ['project_state', 'decisions_log', 'next_actions', 'work_journal', 'test_evidence']
    const results = await Promise.allSettled(
      types.map(t => this.generate(projectId, t, { ...opts, _preloadedState: freshState })),
    )
    return types.map((type, i) => {
      const r = results[i]
      return r.status === 'fulfilled'
        ? { type, ok: true, generatedAt: r.value.generatedAt }
        : { type, ok: false, error: (r.reason as Error).message }
    })
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

  // ── LGPD / Compliance Documents ───────────────────────────────────────────

  async generateDataMap(projectId: string): Promise<{ id: string; type: string; content: string; generatedAt: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const assets = await this.prisma.dataAsset.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    })

    const piiAssets = assets.filter(a => a.containsPII)

    const lines = piiAssets.map(a => {
      const fields = (a.piiFields as string[] | null)?.join(', ') ?? 'não especificado'
      return `| ${a.name} | ${a.type} | ${fields} | ${a.owner ?? '—'} | ${a.sensitivity} | ${a.source ?? '—'} |`
    })

    const content = [
      `# Mapeamento de Dados Pessoais — ${project.name}`,
      `**Gerado em:** ${new Date().toLocaleDateString('pt-BR')}`,
      `**Total de assets:** ${assets.length} | **Com dados pessoais (PII):** ${piiAssets.length}`,
      '',
      '## Ativos com dados pessoais',
      '',
      '| Dataset | Tipo | Campos PII | Responsável | Sensibilidade | Origem |',
      '|---|---|---|---|---|---|',
      ...lines,
      '',
      `## Ativos sem dados pessoais (${assets.length - piiAssets.length})`,
      assets.filter(a => !a.containsPII).map(a => `- **${a.name}** (${a.type}) — ${a.sensitivity}`).join('\n'),
    ].join('\n')

    const doc = await this.prisma.projectDocument.upsert({
      where: { projectId_type: { projectId, type: 'data_map' } },
      create: { projectId, type: 'data_map', content },
      update: { content, generatedAt: new Date(), reviewedAt: null },
    })

    return { id: doc.id, type: doc.type, content: doc.content, generatedAt: doc.generatedAt.toISOString() }
  }

  async generateROPA(projectId: string): Promise<{ id: string; type: string; content: string; generatedAt: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const assets = await this.prisma.dataAsset.findMany({
      where: { projectId, containsPII: true },
      orderBy: { name: 'asc' },
    })

    const sections = assets.map(a => {
      const fields = (a.piiFields as string[] | null)?.join(', ') ?? 'não especificado'
      const consumers = (a.consumers as string[] | null)?.join(', ') ?? 'não especificado'
      return [
        `### ${a.name}`,
        `- **Tipo:** ${a.type}`,
        `- **Responsável:** ${a.owner ?? 'não definido'}`,
        `- **Finalidade:** ${a.description ?? 'não declarada'}`,
        `- **Campos pessoais:** ${fields}`,
        `- **Compartilhado com:** ${consumers}`,
        `- **Origem:** ${a.source ?? 'não declarada'}`,
        `- **Frequência de atualização:** ${a.updateFreq ?? 'não declarada'}`,
        `- **Sensibilidade:** ${a.sensitivity}`,
        `- **Base legal LGPD:** _a preencher_`,
        `- **Prazo de retenção:** _a preencher_`,
      ].join('\n')
    })

    const content = [
      `# ROPA — Registro de Atividades de Tratamento`,
      `**Projeto:** ${project.name}`,
      `**Gerado em:** ${new Date().toLocaleDateString('pt-BR')}`,
      `**Referência:** Art. 37 LGPD / Art. 30 GDPR`,
      '',
      '> Este documento lista os tratamentos de dados pessoais identificados no catálogo de dados.',
      '> Campos marcados com "_a preencher_" requerem revisão manual do responsável pelo tratamento (DPO ou gestor).',
      '',
      '## Atividades de Tratamento',
      '',
      sections.join('\n\n---\n\n'),
      '',
      `## Resumo`,
      `- **Total de atividades:** ${assets.length}`,
      `- **Dados confidenciais:** ${assets.filter(a => a.sensitivity === 'confidential' || a.sensitivity === 'restricted').length}`,
    ].join('\n')

    const doc = await this.prisma.projectDocument.upsert({
      where: { projectId_type: { projectId, type: 'ropa' } },
      create: { projectId, type: 'ropa', content },
      update: { content, generatedAt: new Date(), reviewedAt: null },
    })

    return { id: doc.id, type: doc.type, content: doc.content, generatedAt: doc.generatedAt.toISOString() }
  }

  async generateQualityReport(projectId: string): Promise<{ id: string; type: string; content: string; generatedAt: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const rules = await this.prisma.dataQualityRule.findMany({
      where: { projectId, active: true },
      include: {
        results: {
          orderBy: { checkedAt: 'desc' },
          take: 1,
        },
      },
    })

    const byDataset: Record<string, typeof rules> = {}
    for (const r of rules) {
      if (!byDataset[r.dataset]) byDataset[r.dataset] = []
      byDataset[r.dataset].push(r)
    }

    const WEIGHTS: Record<string, number> = { critical: 3, warning: 2, info: 1 }

    const datasetSections = Object.entries(byDataset).map(([ds, dsRules]) => {
      let weightedSum = 0, weightTotal = 0, failing = 0

      const ruleLines = dsRules.map(rule => {
        const latest = rule.results[0]
        const score = latest?.score ?? 1.0
        const passed = latest?.passed ?? true
        const w = WEIGHTS[rule.severity] ?? 1
        weightedSum += score * w
        weightTotal += w
        if (!passed) failing++

        const status = !latest ? '⚠️ nunca executada'
          : passed ? `✅ OK (score: ${Math.round(score * 100)}%)`
          : `❌ FALHOU (score: ${Math.round(score * 100)}%)`
        const field = rule.field ? ` › ${rule.field}` : ''
        return `  - [${rule.severity.toUpperCase()}] \`${rule.ruleType}\`${field} — ${status}`
      })

      const dsScore = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 100
      const emoji = dsScore >= 90 ? '🟢' : dsScore >= 70 ? '🟡' : '🔴'

      return [
        `### ${emoji} ${ds} — Score: ${dsScore}/100`,
        `${failing} de ${dsRules.length} regras falhando`,
        ...ruleLines,
      ].join('\n')
    })

    const totalFailing = rules.filter(r => r.results[0] && !r.results[0].passed).length
    const avgScore = rules.length > 0
      ? Math.round(rules.reduce((s, r) => {
          const score = r.results[0]?.score ?? 1.0
          return s + score
        }, 0) / rules.length * 100)
      : 100

    const content = [
      `# Relatório de Qualidade de Dados — ${project.name}`,
      `**Gerado em:** ${new Date().toLocaleDateString('pt-BR')}`,
      `**Score médio:** ${avgScore}/100 | **Regras ativas:** ${rules.length} | **Falhando:** ${totalFailing}`,
      '',
      '## Por Dataset',
      '',
      datasetSections.join('\n\n'),
    ].join('\n')

    const doc = await this.prisma.projectDocument.upsert({
      where: { projectId_type: { projectId, type: 'quality_report' } },
      create: { projectId, type: 'quality_report', content },
      update: { content, generatedAt: new Date(), reviewedAt: null },
    })

    return { id: doc.id, type: doc.type, content: doc.content, generatedAt: doc.generatedAt.toISOString() }
  }
}
