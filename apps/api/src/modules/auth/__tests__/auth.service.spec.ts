import { Test, TestingModule } from '@nestjs/testing'
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { AuthService } from '../auth.service'
import * as argon2 from 'argon2'

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn(),
}

function makeConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    ADMIN_PASSWORD: 'senha-correta',
    ALLOW_PLAINTEXT_ADMIN_PASSWORD: 'true',
  }
  const map = { ...defaults, ...overrides }
  return {
    get: (key: string, fallback?: string) => map[key] ?? fallback ?? '',
  }
}

describe('AuthService', () => {
  let service: AuthService

  async function build(configOverrides?: Record<string, string>) {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: makeConfig(configOverrides) },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile()
    service = module.get<AuthService>(AuthService)
  }

  describe('login — senha em texto puro', () => {
    beforeEach(() => build())

    it('retorna token para senha correta', async () => {
      const result = await service.login('senha-correta')
      expect(result.token).toBe('mock-jwt-token')
      expect(mockJwt.sign).toHaveBeenCalledWith({ sub: 'admin', role: 'admin' })
    })

    it('lança UnauthorizedException para senha errada', async () => {
      await expect(service.login('senha-errada')).rejects.toThrow(UnauthorizedException)
    })

    it('lança UnauthorizedException quando ADMIN_PASSWORD está vazio', async () => {
      await build({ ADMIN_PASSWORD: '' })
      await expect(service.login('qualquer')).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('login — ALLOW_PLAINTEXT_ADMIN_PASSWORD=false', () => {
    it('rejeita sem verificar quando plaintext está desabilitado e senha não é argon2', async () => {
      await build({ ALLOW_PLAINTEXT_ADMIN_PASSWORD: 'false', ADMIN_PASSWORD: 'senha-plaintext' })
      await expect(service.login('senha-plaintext')).rejects.toThrow(UnauthorizedException)
    })
  })

  /**
   * Argon2 é caro DE PROPÓSITO — é a defesa contra força bruta. Cada `hash()` mais o
   * `verify()` de dentro do `login` passa folgadamente do padrão de 5s do Jest quando a
   * máquina está ocupada: em 2026-09-05 este arquivo levou 11s, 13s e 50s em execuções
   * do `pnpm test` completo (três projetos em paralelo) e ~1s rodando sozinho.
   *
   * Falhava de forma NÃO-DETERMINÍSTICA, que é o pior estado possível para uma suíte:
   * ninguém sabe se o vermelho é regressão ou azar, e o hábito vira reexecutar até
   * passar. O timeout explícito troca isso por um número declarado.
   */
  const TIMEOUT_ARGON2 = 60_000

  describe('login — argon2', () => {
    it('aceita senha com hash argon2 correto', async () => {
      const hash = await argon2.hash('senha-segura')
      await build({ ADMIN_PASSWORD: hash })

      const result = await service.login('senha-segura')
      expect(result.token).toBe('mock-jwt-token')
    }, TIMEOUT_ARGON2)

    it('rejeita senha com hash argon2 incorreto', async () => {
      const hash = await argon2.hash('senha-correta')
      await build({ ADMIN_PASSWORD: hash })

      await expect(service.login('senha-errada')).rejects.toThrow(UnauthorizedException)
    }, TIMEOUT_ARGON2)

    it('usa argon2 quando ADMIN_PASSWORD começa com $argon2, ignorando ALLOW_PLAINTEXT', async () => {
      const hash = await argon2.hash('senha-hash')
      await build({ ADMIN_PASSWORD: hash, ALLOW_PLAINTEXT_ADMIN_PASSWORD: 'false' })

      const result = await service.login('senha-hash')
      expect(result.token).toBe('mock-jwt-token')
    }, TIMEOUT_ARGON2)
  })

  describe('verifyToken', () => {
    beforeEach(() => build())

    it('retorna true para token válido', () => {
      mockJwt.verify.mockReturnValue({ sub: 'admin' })
      expect(service.verifyToken('valid-token')).toBe(true)
    })

    it('retorna false para token inválido', () => {
      mockJwt.verify.mockImplementation(() => { throw new Error('jwt expired') })
      expect(service.verifyToken('invalid-token')).toBe(false)
    })
  })
})
