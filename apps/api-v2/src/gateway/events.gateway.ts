import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets'
import { WebSocket, Server } from 'ws'
import { RayzenEvent } from './events.service'

interface TaggedSocket extends WebSocket {
  projectIds?: Set<string>
  isAlive?: boolean
}

@WebSocketGateway(3104, { path: '/ws' })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  private clients = new Set<TaggedSocket>()
  private heartbeat?: ReturnType<typeof setInterval>

  afterInit(server: Server) {
    this.heartbeat = setInterval(() => {
      server.clients.forEach((ws: TaggedSocket) => {
        if (ws.isAlive === false) { ws.terminate(); return }
        ws.isAlive = false
        ws.ping()
      })
    }, 30_000)
  }

  handleConnection(client: TaggedSocket) {
    client.isAlive = true
    client.projectIds = new Set()
    this.clients.add(client)

    client.on('pong', () => { client.isAlive = true })

    client.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; projectIds?: string[] }
        if (msg.type === 'subscribe' && Array.isArray(msg.projectIds)) {
          msg.projectIds.forEach((id) => client.projectIds?.add(id))
        }
      } catch { /* ignore malformed */ }
    })
  }

  handleDisconnect(client: TaggedSocket) {
    this.clients.delete(client)
  }

  broadcast(event: RayzenEvent) {
    const payload = JSON.stringify(event)
    this.clients.forEach((ws: TaggedSocket) => {
      if (ws.readyState !== 1) return
      if (event.projectId && ws.projectIds?.size && !ws.projectIds.has(event.projectId)) return
      ws.send(payload)
    })
  }
}
