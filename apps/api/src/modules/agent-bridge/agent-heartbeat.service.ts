import { Injectable } from '@nestjs/common'
import { AgentRole } from '@rayzen/types'

// Última vez que cada role do agent (desktop/server) chamou GET /tasks/pending.
// Em memória só — reinicia zerado a cada deploy do V1, o que é aceitável: o pior
// caso é um falso "offline" nos primeiros segundos após o restart do próprio V1.
@Injectable()
export class AgentHeartbeatService {
  private readonly lastSeenAt = new Map<AgentRole, number>()

  touch(role: AgentRole): void {
    this.lastSeenAt.set(role, Date.now())
  }

  isOnline(role: AgentRole, maxAgeMs = 90_000): boolean {
    const seen = this.lastSeenAt.get(role)
    return seen !== undefined && Date.now() - seen < maxAgeMs
  }

  getLastSeenAt(role: AgentRole): number | null {
    return this.lastSeenAt.get(role) ?? null
  }
}
