import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { IdentityGuard, IdentityRequest } from '../identity.guard'

const SECRET = 'test-identity-secret-abc123'

function makeContext(headers: Record<string, string | undefined>) {
  const req: IdentityRequest = { headers }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any
}

describe('IdentityGuard', () => {
  const jwt = new JwtService({ secret: SECRET })
  const guard = new IdentityGuard(jwt)

  it('token válido com claim sub: anexa identityUserId no request e retorna true', () => {
    const token = jwt.sign({ sub: 'financeiro' })
    const req: IdentityRequest = { headers: { 'x-identity-token': token } }
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as any

    expect(guard.canActivate(ctx)).toBe(true)
    expect(req.identityUserId).toBe('financeiro')
  })

  it('lança UnauthorizedException quando o header X-Identity-Token está ausente', () => {
    const ctx = makeContext({})
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para token assinado com secret diferente', () => {
    const outroJwt = new JwtService({ secret: 'secret-errado' })
    const token = outroJwt.sign({ sub: 'financeiro' })
    const ctx = makeContext({ 'x-identity-token': token })

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para token expirado', () => {
    const token = jwt.sign({ sub: 'financeiro' }, { expiresIn: '-1s' })
    const ctx = makeContext({ 'x-identity-token': token })

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException quando o token é válido mas não tem claim "sub"', () => {
    const token = jwt.sign({ foo: 'bar' })
    const ctx = makeContext({ 'x-identity-token': token })

    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para token malformado (não é um JWT)', () => {
    const ctx = makeContext({ 'x-identity-token': 'nao-e-um-jwt' })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })
})
