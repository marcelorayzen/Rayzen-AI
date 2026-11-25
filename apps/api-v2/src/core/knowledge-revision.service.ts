import { Injectable } from '@nestjs/common'

/**
 * One invalidation signal for every context read derived from governed knowledge.
 * The cache remains an implementation detail of ContextEngine; its key includes
 * this revision, so an approval can never keep serving a stale context entry.
 */
@Injectable()
export class KnowledgeRevisionService {
  private readonly revisions = new Map<string, number>()

  current(scopeKey: string): number {
    return this.revisions.get(scopeKey) ?? 0
  }

  bump(scopeKey: string): number {
    const next = this.current(scopeKey) + 1
    this.revisions.set(scopeKey, next)
    return next
  }
}
