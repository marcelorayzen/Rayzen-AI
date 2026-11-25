import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { JwtAuthGuard } from '../auth.guard'

function context(authorization?: string): ExecutionContext & { request: Record<string, unknown> } {
  const request = { headers: { authorization } }
  return {
    request,
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext & { request: Record<string, unknown> }
}

describe('JwtAuthGuard', () => {
  const originalAgentToken = process.env.AGENT_TOKEN

  afterEach(() => {
    if (originalAgentToken === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = originalAgentToken
    delete process.env.AGENT_TOKEN_PREVIOUS
    jest.restoreAllMocks()
  })

  function build(isPublic = false) {
    const jwt = { verify: jest.fn() } as unknown as JwtService
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    } as unknown as Reflector
    return { guard: new JwtAuthGuard(jwt, reflector), jwt, reflector }
  }

  it('libera somente rota marcada explicitamente como publica', () => {
    const { guard, jwt, reflector } = build(true)

    expect(guard.canActivate(context())).toBe(true)
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'isPublic',
      expect.arrayContaining([expect.any(Function)]),
    )
    expect(jwt.verify).not.toHaveBeenCalled()
  })

  it('recusa requisicao sem bearer token', () => {
    const { guard } = build()
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException)
  })

  it('aceita JWT valido', () => {
    const { guard, jwt } = build()
    jest.spyOn(jwt, 'verify').mockReturnValue({ sub: 'marcelo' })
    const ctx = context('Bearer jwt-valido')

    expect(guard.canActivate(ctx)).toBe(true)
    expect(jwt.verify).toHaveBeenCalledWith('jwt-valido')
    expect(ctx.request.authPrincipal).toEqual({ kind: 'human', subject: 'marcelo', role: undefined })
  })

  it('classifica AGENT_TOKEN como servico mesmo quando ele tambem e um JWT valido', () => {
    process.env.AGENT_TOKEN = 'jwt-do-agent'
    const { guard, jwt } = build()
    jest.spyOn(jwt, 'verify').mockReturnValue({ sub: 'admin', role: 'admin' })
    const ctx = context('Bearer jwt-do-agent')

    expect(guard.canActivate(ctx)).toBe(true)
    expect(jwt.verify).not.toHaveBeenCalled()
    expect(ctx.request.authPrincipal).toEqual({ kind: 'service', subject: 'agent' })
  })

  it('classifica AGENT_TOKEN_PREVIOUS como servico durante a rotacao', () => {
    process.env.AGENT_TOKEN = 'token-novo'
    process.env.AGENT_TOKEN_PREVIOUS = 'token-anterior'
    const { guard, jwt } = build()
    const ctx = context('Bearer token-anterior')

    expect(guard.canActivate(ctx)).toBe(true)
    expect(jwt.verify).not.toHaveBeenCalled()
    expect(ctx.request.authPrincipal).toEqual({ kind: 'service', subject: 'agent' })
  })

  it('recusa token invalido e nunca aceita AGENT_TOKEN ausente', () => {
    delete process.env.AGENT_TOKEN
    const { guard, jwt } = build()
    jest.spyOn(jwt, 'verify').mockImplementation(() => { throw new Error('jwt invalido') })

    expect(() => guard.canActivate(context('Bearer undefined'))).toThrow(UnauthorizedException)
  })
})
