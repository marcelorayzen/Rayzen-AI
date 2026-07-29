import { UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiKeyGuard } from '../api-key.guard'

function makeContext(authHeader?: string, isPublic = false) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader !== undefined ? { authorization: authHeader } : {},
      }),
    }),
    getHandler: () => ({ __isPublic: isPublic }),
    getClass: () => ({}),
  } as any
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard
  let reflector: Reflector
  const VALID_KEY = 'valid-catalog-guardian-key-abc123'

  beforeEach(() => {
    reflector = new Reflector()
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((_key, [handler]: any) => handler.__isPublic)
    guard = new ApiKeyGuard(reflector)
    process.env.CATALOG_GUARDIAN_API_KEY = VALID_KEY
  })

  afterEach(() => {
    delete process.env.CATALOG_GUARDIAN_API_KEY
    jest.restoreAllMocks()
  })

  it('retorna true para chave válida no cabeçalho Bearer', () => {
    const ctx = makeContext(`Bearer ${VALID_KEY}`)
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('retorna true sem checar header quando a rota é @Public()', () => {
    const ctx = makeContext(undefined, true)
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('lança UnauthorizedException quando CATALOG_GUARDIAN_API_KEY não está configurado', () => {
    delete process.env.CATALOG_GUARDIAN_API_KEY
    const ctx = makeContext(`Bearer ${VALID_KEY}`)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para chave errada', () => {
    const ctx = makeContext('Bearer chave-errada')
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException quando não há header Authorization', () => {
    const ctx = makeContext(undefined)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para scheme não-Bearer', () => {
    const ctx = makeContext(`Basic ${VALID_KEY}`)
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('lança UnauthorizedException para header Bearer sem chave', () => {
    const ctx = makeContext('Bearer ')
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })
})
