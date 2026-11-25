import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface GitEventPayload {
  // GitHub webhook (push)
  ref?: string            // refs/heads/main
  commits?: Array<{
    id: string
    message: string
    author: { name: string }
    modified?: string[]
    added?: string[]
    removed?: string[]
  }>
  repository?: { full_name: string }
  // GitHub webhook (PR)
  action?: string         // opened | closed | merged | synchronize
  pull_request?: {
    title: string
    body?: string
    head: { ref: string }
    base: { ref: string }
    merged?: boolean
    html_url?: string
  }
  projectId?: string
}

export interface GitContext {
  branches: Record<string, number>        // branch → nº de eventos
  recentCommits: Array<{ hash: string; message: string; branch: string; ts: string }>
  mostTouchedFiles: Array<{ file: string; count: number }>
  lastBranch: string | null
  lastCommitHash: string | null
  lastCommitMessage: string | null
  totalGitEvents: number
}

@Injectable()
export class GitService {
  constructor(private readonly prisma: PrismaService) {}

  async fromWebhook(payload: GitEventPayload, projectId?: string): Promise<{ saved: number }> {
    const pid = projectId ?? payload.projectId ?? null
    const events = []

    // Push event
    if (payload.ref && payload.commits) {
      const branch = payload.ref.replace('refs/heads/', '')
      for (const commit of payload.commits.slice(0, 10)) {
        const files = [...(commit.modified ?? []), ...(commit.added ?? []), ...(commit.removed ?? [])]
        events.push({
          projectId: pid,
          source: 'cli' as const,
          type: 'execution' as const,
          intent: null,
          content: `git push: [${branch}] ${commit.message.slice(0, 120)}`,
          metadata: {
            git: {
              branch,
              commitHash: commit.id.slice(0, 8),
              commitMessage: commit.message,
              commitAuthor: commit.author.name,
              changedFiles: files.slice(0, 10),
            },
            repo: payload.repository?.full_name,
            webhookType: 'push',
          } as object,
        })
      }
    }

    // PR event
    if (payload.pull_request) {
      const pr = payload.pull_request
      const isMerge = payload.action === 'closed' && pr.merged
      events.push({
        projectId: pid,
        source: 'cli' as const,
        type: isMerge ? 'decision' as const : 'note' as const,
        intent: isMerge ? 'decision' as const : null,
        content: `PR ${payload.action}: ${pr.title} (${pr.head.ref} → ${pr.base.ref})`,
        metadata: {
          git: {
            branch: pr.head.ref,
            prTitle: pr.title,
            prBody: pr.body?.slice(0, 500),
            prUrl: pr.html_url,
            action: payload.action,
            merged: pr.merged ?? false,
          },
          webhookType: 'pull_request',
        } as object,
      })
    }

    if (events.length === 0) return { saved: 0 }

    await this.prisma.event.createMany({ data: events })
    return { saved: events.length }
  }

  async getProjectContext(projectId: string): Promise<GitContext> {
    // Buscar eventos CLI com metadata git
    const events = await this.prisma.event.findMany({
      where: {
        projectId,
        source: 'cli',
        NOT: { metadata: { equals: {} } },
      },
      orderBy: { ts: 'desc' },
      take: 200,
    })

    // Filtrar apenas os que têm contexto git
    const gitEvents = events.filter(e => {
      const m = e.metadata as Record<string, unknown>
      return m && typeof m['git'] === 'object' && m['git'] !== null
    })

    if (gitEvents.length === 0) {
      return {
        branches: {}, recentCommits: [], mostTouchedFiles: [],
        lastBranch: null, lastCommitHash: null, lastCommitMessage: null,
        totalGitEvents: 0,
      }
    }

    const branches: Record<string, number> = {}
    const recentCommits: GitContext['recentCommits'] = []
    const fileCounts: Record<string, number> = {}
    const seenCommits = new Set<string>()

    for (const ev of gitEvents) {
      const m = ev.metadata as Record<string, unknown>
      const git = m['git'] as Record<string, unknown>
      if (!git) continue

      const branch = String(git['branch'] ?? 'unknown')
      branches[branch] = (branches[branch] ?? 0) + 1

      const hash = String(git['commitHash'] ?? '')
      if (hash && !seenCommits.has(hash) && recentCommits.length < 15) {
        seenCommits.add(hash)
        recentCommits.push({
          hash,
          message: String(git['commitMessage'] ?? git['prTitle'] ?? ''),
          branch,
          ts: ev.ts.toISOString(),
        })
      }

      const files = (git['changedFiles'] as string[]) ?? []
      for (const f of files) {
        if (f) fileCounts[f] = (fileCounts[f] ?? 0) + 1
      }
    }

    const mostTouchedFiles = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([file, count]) => ({ file, count }))

    const firstGit = (gitEvents[0].metadata as Record<string, unknown>)['git'] as Record<string, unknown>

    return {
      branches,
      recentCommits,
      mostTouchedFiles,
      lastBranch: String(firstGit['branch'] ?? ''),
      lastCommitHash: String(firstGit['commitHash'] ?? ''),
      lastCommitMessage: String(firstGit['commitMessage'] ?? firstGit['prTitle'] ?? ''),
      totalGitEvents: gitEvents.length,
    }
  }
}
