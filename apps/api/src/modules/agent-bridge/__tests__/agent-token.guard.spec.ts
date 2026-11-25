import { UnauthorizedException } from '@nestjs/common'
import { AgentTokenGuard } from '../agent-token.guard'

function makeContext(authHeader?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
      }),
    }),
  } as any  
}

describe('AgentTokenGuard', () => {
  let guard: AgentTokenGuard
  const VALID_TOKEN = 'valid-agent-token-abc123'

  beforeEach(() => {
    guard = new AgentTokenGuard()
    process.env.AGENT_TOKEN = VALID_TOKEN
  })

  afterEach(() => {
    delete process.env.AGENT_TOKEN
    delete process.env.AGENT_TOKEN_PREVIOUS
  })

  it('retorna true para token válido no cabeçalho Bearer', () => {
    const ctx = makeContext(`Bearer ${VALID_TOKEN}`)
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('aceita o token anterior somente durante a janela de rotacao', () => {
    process.env.AGENT_TOKEN_PREVIOUS = 'token-anterior'
    expect(guard.canActivate(makeContext('Bearer token-anterior'))).toBe(true)
  })

  it('lança UnauthorizedException quando AGENT_TOKEN não está configurado', () => {
    delete process.env.AGENT_TOKEN
    const ctx = makeContext(`Bearer ${VALID_TOKEN}`)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para token errado', () => {
    const ctx = makeContext('Bearer token-errado')
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException quando não há header Authorization', () => {
    const ctx = makeContext(undefined)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para scheme não-Bearer', () => {
    const ctx = makeContext(`Basic ${VALID_TOKEN}`)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para header Bearer sem token', () => {
    const ctx = makeContext('Bearer ')
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })
})
