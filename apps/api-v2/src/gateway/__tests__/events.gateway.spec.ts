import { EventsGateway } from '../events.gateway'
import type { RayzenEvent } from '../events.service'

/**
 * O gateway entregava evento de TODOS os projetos para QUALQUER cliente.
 *
 * `handleConnection` não validava token nenhum, e o filtro por projeto só valia se o
 * cliente mandasse `subscribe` — quem não mandasse tinha `projectIds.size === 0` e
 * recebia tudo. O padrão inseguro era também o padrão de quem não fizesse nada.
 *
 * E o gateway está exposto duas vezes: direto na LAN (`0.0.0.0:3104`, como o widget
 * conecta) e publicamente pelo Caddy através do túnel.
 */
describe('EventsGateway — autenticação e escopo', () => {
  const TOKEN_OK  = 'token-valido'
  const TOKEN_RUIM = 'token-invalido'

  function build() {
    const jwt = {
      verify: jest.fn().mockImplementation((t: string) => {
        if (t !== TOKEN_OK) throw new Error('invalid')
        return { sub: 'u1' }
      }),
    }
    return { gateway: new EventsGateway(jwt as never), jwt }
  }

  /** Socket falso que registra o que foi enviado e como foi fechado. */
  function socket() {
    const handlers: Record<string, (arg: Buffer) => void> = {}
    return {
      readyState: 1,
      enviados: [] as string[],
      fechado: null as null | { code: number; reason: string },
      on(ev: string, cb: (arg: Buffer) => void) { handlers[ev] = cb },
      send(p: string) { this.enviados.push(p) },
      close(code: number, reason: string) { this.fechado = { code, reason } },
      terminate() { /* noop */ },
      /** dispara uma mensagem do cliente */
      recebe(msg: unknown) { handlers.message?.(Buffer.from(JSON.stringify(msg))) },
    }
  }

  const evento = (projectId: string): RayzenEvent =>
    ({ type: 'mission_update', projectId, payload: { id: 'm1' } })

  afterEach(() => jest.useRealTimers())

  it('cliente que não se identifica NÃO recebe evento', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    gateway.broadcast(evento('p1'))

    expect(ws.enviados).toHaveLength(0)
  })

  it('subscribe sem token derruba a conexão', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    ws.recebe({ type: 'subscribe', projectIds: ['p1'] })

    expect(ws.fechado?.code).toBe(4401)
  })

  it('subscribe com token inválido derruba a conexão', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_RUIM })

    expect(ws.fechado?.code).toBe(4401)
    expect(ws.enviados).toHaveLength(0)
  })

  it('subscribe com token válido passa a receber o projeto assinado', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_OK })
    gateway.broadcast(evento('p1'))

    expect(ws.fechado).toBeNull()
    expect(ws.enviados).toHaveLength(1)
  })

  /**
   * O vazamento original: sem `subscribe`, `projectIds.size === 0` fazia o filtro ser
   * pulado e o cliente recebia o trabalho de todos os projetos.
   */
  it('autenticado NÃO recebe projeto que não assinou', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_OK })
    gateway.broadcast(evento('OUTRO-PROJETO'))

    expect(ws.enviados).toHaveLength(0)
  })

  /** O widget manda `Authorization: Bearer` no handshake — Node `ws` permite header. */
  it('aceita token no header do handshake, como o widget já envia', () => {
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never, { headers: { authorization: `Bearer ${TOKEN_OK}` } })

    // Sem token na mensagem: já veio autenticado pelo header.
    ws.recebe({ type: 'subscribe', projectIds: ['p1'] })
    gateway.broadcast(evento('p1'))

    expect(ws.fechado).toBeNull()
    expect(ws.enviados).toHaveLength(1)
  })

  it('conexão que não se autentica no prazo é derrubada', () => {
    jest.useFakeTimers()
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)

    jest.advanceTimersByTime(10_001)

    expect(ws.fechado?.code).toBe(4401)
  })

  it('conexão autenticada sobrevive ao prazo', () => {
    jest.useFakeTimers()
    const { gateway } = build()
    const ws = socket()
    gateway.handleConnection(ws as never)
    ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_OK })

    jest.advanceTimersByTime(10_001)

    expect(ws.fechado).toBeNull()
  })

  describe('limites — sem eles o gateway aberto é DoS trivial', () => {
    it('recusa conexão acima do teto', () => {
      const { gateway } = build()
      for (let i = 0; i < 50; i++) gateway.handleConnection(socket() as never)

      const excedente = socket()
      gateway.handleConnection(excedente as never)

      expect(excedente.fechado?.code).toBe(1013)
    })

    it('derruba cliente que estoura o rate limit', () => {
      const { gateway } = build()
      const ws = socket()
      gateway.handleConnection(ws as never)

      for (let i = 0; i < 25; i++) ws.recebe({ type: 'ruido' })

      expect(ws.fechado?.code).toBe(4429)
    })

    it('tráfego normal não é derrubado', () => {
      const { gateway } = build()
      const ws = socket()
      gateway.handleConnection(ws as never)

      ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_OK })
      for (let i = 0; i < 5; i++) ws.recebe({ type: 'subscribe', projectIds: ['p1'], token: TOKEN_OK })

      expect(ws.fechado).toBeNull()
    })
  })
})
