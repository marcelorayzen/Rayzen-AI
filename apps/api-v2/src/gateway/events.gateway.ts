import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { WebSocket, Server } from 'ws'
import { RayzenEvent } from './events.service'

interface TaggedSocket extends WebSocket {
  projectIds?: Set<string>
  isAlive?: boolean
  /** Só vira true depois de um `subscribe` com token válido. */
  autenticado?: boolean
  authTimer?: ReturnType<typeof setTimeout>
  /** Janela de rate limit: início e contagem. */
  janelaInicio?: number
  janelaMsgs?: number
}

/**
 * Quanto tempo uma conexão pode ficar sem se identificar antes de ser derrubada.
 *
 * O token vem na mensagem de `subscribe`, não no handshake, porque **navegador não
 * consegue mandar header em WebSocket** — `useRayzenEvents` usa `new WebSocket(url)` e
 * não há como contornar pela API do browser. O widget consegue (e já manda
 * `Authorization: Bearer`), então o header continua sendo aceito como alternativa.
 */
const PRAZO_AUTENTICACAO_MS = 10_000

/** Teto de conexões simultâneas. Sem isto, o gateway aberto é DoS trivial. */
const MAX_CONEXOES = 50

/** Rate limit por cliente: mensagens por janela. */
const JANELA_MS = 10_000
const MAX_MSGS_POR_JANELA = 20

/**
 * Gateway de eventos do Rayzen.
 *
 * ── Por que existe autenticação aqui ───────────────────────────────────────────
 * Até 2026-08-18 o `handleConnection` não validava nada e o filtro por projeto só
 * valia se o cliente mandasse `subscribe`: quem não mandasse recebia **eventos de
 * todos os projetos**. E o gateway está exposto duas vezes — direto na LAN
 * (`0.0.0.0:3104`, que é como o widget conecta) e publicamente pelo Caddy através do
 * túnel. Qualquer cliente que abrisse a conexão via o trabalho de todos os projetos.
 */
@WebSocketGateway(3104, { path: '/ws' })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server

  private readonly logger = new Logger(EventsGateway.name)
  private clients = new Set<TaggedSocket>()
  private heartbeat?: ReturnType<typeof setInterval>

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server) {
    this.heartbeat = setInterval(() => {
      server.clients.forEach((ws: TaggedSocket) => {
        if (ws.isAlive === false) { ws.terminate(); return }
        ws.isAlive = false
        ws.ping()
      })
    }, 30_000)
  }

  handleConnection(client: TaggedSocket, req?: { headers?: Record<string, string | string[] | undefined> }) {
    if (this.clients.size >= MAX_CONEXOES) {
      this.logger.warn(`Conexão recusada — teto de ${MAX_CONEXOES} atingido`)
      client.close(1013, 'too many connections')
      return
    }

    client.isAlive      = true
    client.autenticado  = false
    client.projectIds   = new Set()
    client.janelaInicio = Date.now()
    client.janelaMsgs   = 0
    this.clients.add(client)

    // O widget manda o token no header do handshake (Node `ws` permite). Aceitar
    // aqui evita obrigá-lo a mudar — a web continua pelo `subscribe`.
    const auth = req?.headers?.authorization
    const header = Array.isArray(auth) ? auth[0] : auth
    if (header?.startsWith('Bearer ') && this.tokenValido(header.slice(7))) {
      client.autenticado = true
    }

    // Sem identificação em PRAZO_AUTENTICACAO_MS, a conexão cai. Isso é o que
    // impede uma conexão anônima de ficar pendurada esperando evento.
    client.authTimer = setTimeout(() => {
      if (!client.autenticado) {
        this.logger.warn('Conexão derrubada — não se autenticou no prazo')
        client.close(4401, 'unauthorized')
      }
    }, PRAZO_AUTENTICACAO_MS)

    client.on('pong', () => { client.isAlive = true })

    client.on('message', (raw: Buffer) => {
      if (this.estourouRateLimit(client)) {
        this.logger.warn('Conexão derrubada — rate limit excedido')
        client.close(4429, 'rate limit')
        return
      }

      try {
        const msg = JSON.parse(raw.toString()) as { type: string; projectIds?: string[]; token?: string }
        if (msg.type !== 'subscribe' || !Array.isArray(msg.projectIds)) return

        // `subscribe` é o ponto de autenticação: sem token válido não assina nada.
        if (!client.autenticado) {
          if (!msg.token || !this.tokenValido(msg.token)) {
            client.close(4401, 'unauthorized')
            return
          }
          client.autenticado = true
        }

        msg.projectIds.forEach((id) => client.projectIds?.add(id))
      } catch { /* ignore malformed */ }
    })
  }

  handleDisconnect(client: TaggedSocket) {
    if (client.authTimer) clearTimeout(client.authTimer)
    this.clients.delete(client)
  }

  /**
   * Só entrega a cliente **autenticado e inscrito** no projeto do evento.
   *
   * Antes, `projectIds.size === 0` significava "recebe tudo" — o padrão inseguro era
   * também o padrão de quem não fizesse nada. Agora ausência de inscrição significa
   * ausência de entrega.
   */
  broadcast(event: RayzenEvent) {
    const payload = JSON.stringify(event)
    this.clients.forEach((ws: TaggedSocket) => {
      if (ws.readyState !== 1) return
      if (!ws.autenticado) return
      if (event.projectId && !ws.projectIds?.has(event.projectId)) return
      ws.send(payload)
    })
  }

  private tokenValido(token: string): boolean {
    try {
      this.jwt.verify(token)
      return true
    } catch {
      return false
    }
  }

  private estourouRateLimit(client: TaggedSocket): boolean {
    const agora = Date.now()
    if (agora - (client.janelaInicio ?? 0) > JANELA_MS) {
      client.janelaInicio = agora
      client.janelaMsgs = 0
    }
    client.janelaMsgs = (client.janelaMsgs ?? 0) + 1
    return client.janelaMsgs > MAX_MSGS_POR_JANELA
  }
}
