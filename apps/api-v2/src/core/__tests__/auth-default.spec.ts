import { Controller, Get, Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { PingController } from '../../ping.controller'
import { JwtAuthGuard } from '../auth.guard'
import { HttpAuthModule } from '../http-auth.module'
import { IS_PUBLIC_KEY } from '../public.decorator'

@Global()
@Module({
  imports: [JwtModule.register({ secret: 'test-secret' })],
  exports: [JwtModule],
})
class TestJwtModule {}

@Controller()
class ProtectedController {
  @Get('protected')
  get() {
    return { ok: true }
  }
}

@Module({
  imports: [TestJwtModule, HttpAuthModule],
  controllers: [PingController, ProtectedController],
})
class TestAppModule {}

function arquivosTypeScript(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return arquivosTypeScript(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

describe('autenticacao HTTP por padrao', () => {
  it('registra JwtAuthGuard como guard global da API V2', () => {
    const providers = Reflect.getMetadata('providers', HttpAuthModule) as Array<{
      provide?: unknown
      useClass?: unknown
    }>

    expect(providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provide: APP_GUARD, useClass: JwtAuthGuard }),
    ]))
  })

  it('mantem apenas o healthcheck ping explicitamente publico', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PingController.prototype.ping)).toBe(true)

    const src = join(__dirname, '..', '..')
    const usos = arquivosTypeScript(src).flatMap((path) => {
      const ocorrencias = readFileSync(path, 'utf8').match(/^\s*@Public\(\)/gm) ?? []
      return ocorrencias.map(() => relative(src, path).replace(/\\/g, '/'))
    })
    expect(usos).toEqual(['ping.controller.ts'])
  })

  describe('aplicacao Nest isolada', () => {
    let app: NestFastifyApplication
    let jwt: JwtService
    const originalAgentToken = process.env.AGENT_TOKEN

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile()
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
      app.setGlobalPrefix('v2')
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      jwt = app.get(JwtService)
    })

    afterAll(async () => {
      if (originalAgentToken === undefined) delete process.env.AGENT_TOKEN
      else process.env.AGENT_TOKEN = originalAgentToken
      await app.close()
    })

    it('deixa ping anonimo e recusa rota comum anonima', async () => {
      const ping = await app.inject({ method: 'GET', url: '/v2/ping' })
      const protectedResponse = await app.inject({ method: 'GET', url: '/v2/protected' })

      expect(ping.statusCode).toBe(200)
      expect(protectedResponse.statusCode).toBe(401)
    })

    it('aceita JWT e token de servico na rota protegida', async () => {
      process.env.AGENT_TOKEN = 'token-do-agent'
      const jwtResponse = await app.inject({
        method: 'GET',
        url: '/v2/protected',
        headers: { authorization: `Bearer ${jwt.sign({ sub: 'marcelo' })}` },
      })
      const agentResponse = await app.inject({
        method: 'GET',
        url: '/v2/protected',
        headers: { authorization: 'Bearer token-do-agent' },
      })

      expect(jwtResponse.statusCode).toBe(200)
      expect(agentResponse.statusCode).toBe(200)
    })
  })
})
