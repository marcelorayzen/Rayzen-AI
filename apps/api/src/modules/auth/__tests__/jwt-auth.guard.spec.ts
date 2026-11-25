import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from '../jwt-auth.guard'

function contexto(token?: string) {
  const request = { headers: token ? { authorization: `Bearer ${token}` } : {} }
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext
  return { context, request }
}

describe('JwtAuthGuard V1 - identidade de servico', () => {
  const original = process.env.AGENT_TOKEN

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = original
    delete process.env.AGENT_TOKEN_PREVIOUS
    jest.restoreAllMocks()
  })

  function build() {
    const auth = { principalFromToken: jest.fn() }
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }
    return { guard: new JwtAuthGuard(auth as never, reflector as unknown as Reflector), auth }
  }

  it('classifica o token configurado antes de tentar valida-lo como JWT humano', () => {
    process.env.AGENT_TOKEN = 'jwt-legado-do-servico'
    const { guard, auth } = build()
    const { context, request } = contexto('jwt-legado-do-servico')
    expect(guard.canActivate(context)).toBe(true)
    expect(auth.principalFromToken).not.toHaveBeenCalled()
    expect(request).toMatchObject({ rayzenPrincipal: { id: 'service:agent', type: 'service' } })
  })

  it('aceita o token anterior durante a janela de rotacao', () => {
    process.env.AGENT_TOKEN = 'token-novo'
    process.env.AGENT_TOKEN_PREVIOUS = 'token-anterior'
    const { guard, auth } = build()

    const { context, request } = contexto('token-anterior')
    expect(guard.canActivate(context)).toBe(true)
    expect(auth.principalFromToken).not.toHaveBeenCalled()
    expect(request).toMatchObject({ rayzenPrincipal: { id: 'service:agent', type: 'service' } })
  })

  it('recusa credencial que nao e servico nem JWT valido', () => {
    process.env.AGENT_TOKEN = 'token-novo'
    const { guard, auth } = build()
    auth.principalFromToken.mockReturnValue(null)

    expect(() => guard.canActivate(contexto('invalido').context)).toThrow(UnauthorizedException)
  })

  it('anexa o subject verificado ao request, sem aceitar um principal do body', () => {
    const { guard, auth } = build()
    auth.principalFromToken.mockReturnValue({ id: 'marcelo', type: 'human' })
    const { context, request } = contexto('jwt-humano')

    expect(guard.canActivate(context)).toBe(true)
    expect(request).toMatchObject({ rayzenPrincipal: { id: 'marcelo', type: 'human' } })
  })
})
