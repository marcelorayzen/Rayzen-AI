import { Injectable } from '@nestjs/common'
import { EventsGateway } from './events.gateway'

export interface RayzenEvent {
  type:      'mission_update' | 'approval_gate' | 'mission_created' | 'ping'
  projectId: string
  payload:   unknown
}

@Injectable()
export class EventsService {
  constructor(private readonly gateway: EventsGateway) {}

  emit(event: RayzenEvent) {
    this.gateway.broadcast(event)
  }

  missionUpdate(projectId: string, mission: { id: string; title: string; status: string; steps: unknown[] }) {
    this.emit({ type: 'mission_update', projectId, payload: mission })
  }

  approvalGate(projectId: string, gate: { id: string; missionId: string; description: string; type: string }) {
    this.emit({ type: 'approval_gate', projectId, payload: gate })
  }

  missionCreated(projectId: string, mission: { id: string; title: string; objective: string }) {
    this.emit({ type: 'mission_created', projectId, payload: mission })
  }
}
