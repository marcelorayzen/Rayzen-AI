import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface KnowledgeNode {
  id: string
  type: 'decision' | 'problem' | 'idea' | 'artifact' | 'document' | 'wiki' | 'goal' | 'file'
  label: string
  data: Record<string, unknown>
}

export interface KnowledgeEdge {
  id: string
  source: string
  target: string
  label: string
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
}

@Injectable()
export class KnowledgeGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async build(projectId: string): Promise<KnowledgeGraph> {
    const nodes: KnowledgeNode[] = []
    const edges: KnowledgeEdge[] = []
    const edgeSet = new Set<string>()

    const addEdge = (source: string, target: string, label: string) => {
      const key = `${source}→${target}`
      if (edgeSet.has(key)) return
      edgeSet.add(key)
      edges.push({ id: key, source, target, label })
    }

    // ── 1. Eventos relevantes (decisions, problems, ideas, consolidated) ──────
    const events = await this.prisma.event.findMany({
      where: {
        projectId,
        OR: [
          { intent: { in: ['decision', 'problem', 'idea'] } },
          { memoryClass: { in: ['consolidated', 'working'] } },
        ],
        memoryClass: { not: 'archive' },
      },
      orderBy: { ts: 'desc' },
      take: 25,
      select: { id: true, intent: true, content: true, metadata: true, ts: true, memoryClass: true },
    })

    const eventIds = new Set<string>()
    for (const ev of events) {
      const nodeType = (ev.intent as KnowledgeNode['type']) ?? 'decision'
      const id = `ev:${ev.id}`
      eventIds.add(ev.id)
      nodes.push({
        id,
        type: nodeType,
        label: ev.content.slice(0, 70),
        data: { originalId: ev.id, ts: ev.ts, memoryClass: ev.memoryClass, intent: ev.intent },
      })

      // Extrair arquivos do metadata git
      const meta = ev.metadata as Record<string, unknown> | null
      const git = meta?.['git'] as Record<string, unknown> | null
      const files = (git?.['changedFiles'] as string[]) ?? []
      for (const f of files.slice(0, 5)) {
        const fileId = `file:${f}`
        if (!nodes.find(n => n.id === fileId)) {
          nodes.push({ id: fileId, type: 'file', label: f.split(/[\\/]/).pop() ?? f, data: { path: f } })
        }
        addEdge(id, fileId, 'toca')
      }
    }

    // ── 2. Checkpoints / artefatos de síntese ────────────────────────────────
    const artifacts = await this.prisma.sessionArtifact.findMany({
      where: { projectId, type: 'checkpoint' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, content: true, sourceIds: true, createdAt: true },
    })

    for (const art of artifacts) {
      const id = `art:${art.id}`
      const c = art.content as { summary?: string; autoTriggered?: boolean; reason?: string }
      if (!c.summary || c.summary === 'Síntese não disponível') continue
      nodes.push({
        id,
        type: 'artifact',
        label: c.summary.slice(0, 60),
        data: { originalId: art.id, createdAt: art.createdAt, autoTriggered: c.autoTriggered, reason: c.reason },
      })

      // Conectar às fontes de eventos
      const srcIds = (art.sourceIds as string[]) ?? []
      for (const srcId of srcIds) {
        if (eventIds.has(srcId)) addEdge(id, `ev:${srcId}`, 'referencia')
      }
    }

    // ── 3. Documentos do projeto ──────────────────────────────────────────────
    const docs = await this.prisma.projectDocument.findMany({
      where: { projectId },
      select: { id: true, type: true, generatedAt: true, versions: { orderBy: { createdAt: 'desc' }, take: 1, select: { sourceIds: true } } },
    })

    for (const doc of docs) {
      const id = `doc:${doc.id}`
      nodes.push({
        id,
        type: 'document',
        label: doc.type.replace(/_/g, ' '),
        data: { originalId: doc.id, docType: doc.type, generatedAt: doc.generatedAt },
      })

      // Conectar aos eventos fonte da versão mais recente
      const srcIds = (doc.versions[0]?.sourceIds as string[]) ?? []
      for (const srcId of srcIds) {
        if (eventIds.has(srcId)) addEdge(id, `ev:${srcId}`, 'gerado de')
      }
    }

    // ── 4. Wiki pages ─────────────────────────────────────────────────────────
    const wikis = await this.prisma.wikiPage.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, slug: true, title: true, related: true, sources: { select: { document: { select: { id: true, projectId: true } } } } },
    })

    for (const wiki of wikis) {
      const id = `wiki:${wiki.id}`
      nodes.push({
        id,
        type: 'wiki',
        label: wiki.title.slice(0, 60),
        data: { originalId: wiki.id, slug: wiki.slug },
      })

      // wiki → document Brain
      for (const src of wiki.sources) {
        if (src.document.projectId === projectId || src.document.projectId === null) {
          const docId = `brain:${src.document.id}`
          // não adiciona nó Brain para não poluir, mas registra a aresta para docs internos
          // conecta wiki ao document do projeto se existir nó correspondente
          const matchingDoc = docs.find(d => d.id === src.document.id)
          if (matchingDoc) addEdge(id, `doc:${matchingDoc.id}`, 'baseado em')
        }
      }

      // wiki → wiki via related slugs
      for (const relatedSlug of wiki.related) {
        const relatedWiki = wikis.find(w => w.slug === relatedSlug)
        if (relatedWiki) addEdge(id, `wiki:${relatedWiki.id}`, 'relacionado')
      }
    }

    // ── 5. Meta ativa ─────────────────────────────────────────────────────────
    const goal = await this.prisma.projectGoal.findFirst({
      where: { projectId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, successCriteria: true, updatedAt: true },
    })

    if (goal) {
      const id = `goal:${goal.id}`
      const criteria = goal.successCriteria as Array<{ done: boolean }>
      const done = criteria.filter(c => c.done).length
      nodes.push({
        id,
        type: 'goal',
        label: goal.title.slice(0, 60),
        data: { originalId: goal.id, progress: criteria.length > 0 ? Math.round(done / criteria.length * 100) : 0, updatedAt: goal.updatedAt },
      })

      // Conectar checkpoints recentes à meta (criados após a meta)
      for (const art of artifacts) {
        if (art.createdAt >= goal.updatedAt || artifacts.indexOf(art) < 2) {
          addEdge(`goal:${goal.id}`, `art:${art.id}`, 'acompanhado por')
        }
      }
    }

    return { nodes, edges }
  }
}
