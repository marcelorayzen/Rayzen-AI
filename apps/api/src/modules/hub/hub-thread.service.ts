import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { PROJETO_GERAL_ID, ehEscopoGeral } from '../../common/escopo-geral.const'

export type HubScope = { type: 'general'; projectId: null } | { type: 'project'; projectId: string }

type HubThreadRecord = {
  id: string
  principalId: string
  scopeType: string
  scopeKey: string
  projectId: string | null
  hermesSessionId: string | null
  status: string
}

type HubThreadDelegate = {
  upsert(args: unknown): Promise<HubThreadRecord>
}

/**
 * H1 projection: the active thread is durable and resolved only from trusted
 * principal + scope. It deliberately does not create a Hermes session: that
 * network boundary is H2, where it can be correlated with a turn and failure.
 */
@Injectable()
export class HubThreadService {
  constructor(private readonly prisma: PrismaService) {}

  scopeFor(projectId: string | null | undefined): HubScope {
    if (ehEscopoGeral(projectId)) return { type: 'general', projectId: null }
    // `ehEscopoGeral()` already excluded null/undefined above; make the
    // narrowing explicit at this persisted boundary rather than propagating an
    // optional project ID into a project-scoped thread.
    return { type: 'project', projectId: projectId as string }
  }

  async resolveActive(principalId: string, projectId: string | null | undefined): Promise<HubThreadRecord> {
    const scope = this.scopeFor(projectId)
    const scopeKey = scope.type === 'general' ? 'general' : scope.projectId
    const hubThread = (this.prisma as unknown as { hubThread: HubThreadDelegate }).hubThread

    return hubThread.upsert({
      where: { principalId_scopeKey: { principalId, scopeKey } },
      create: {
        principalId,
        scopeType: scope.type,
        scopeKey,
        // The Project row for Geral exists for historical messages, but this
        // projection represents its scope explicitly instead of making NULL a wildcard.
        projectId: scope.type === 'general' ? PROJETO_GERAL_ID : scope.projectId,
      },
      update: { status: 'active' },
    })
  }
}
