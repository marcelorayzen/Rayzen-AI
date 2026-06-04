import WebSocket from 'ws'

export type WsEventHandler = (event: unknown) => void

export class RayzenWsClient {
  private ws: WebSocket | null = null
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private alive = false

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly projectId: string,
    private readonly onEvent: WsEventHandler,
  ) {}

  connect() {
    if (this.ws) { this.ws.terminate(); this.ws = null }

    try {
      this.ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.token}` } })
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      this.alive = true
      // Subscribe to project events
      this.ws?.send(JSON.stringify({ type: 'subscribe', projectIds: [this.projectId] }))
    })

    this.ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString())
        this.onEvent(event)
      } catch { /* ignore */ }
    })

    this.ws.on('close', () => {
      this.alive = false
      this.scheduleReconnect()
    })

    this.ws.on('error', () => {
      this.alive = false
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connect(), 5000)
  }

  get connected() { return this.alive }

  destroy() {
    clearTimeout(this.reconnectTimer)
    this.ws?.terminate()
  }
}
