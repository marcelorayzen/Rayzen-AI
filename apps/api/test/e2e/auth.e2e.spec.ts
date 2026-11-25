import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { JwtService } from '@nestjs/jwt'
import { createTestApp, TEST_ADMIN_PASSWORD, TEST_JWT_SECRET } from './setup'

describe('Auth E2E — POST /auth/login', () => {
  let app: NestFastifyApplication

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('retorna 200 + token com senha correta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: TEST_ADMIN_PASSWORD },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('token')
    expect(typeof body.token).toBe('string')
  })

  it('token gerado é válido e contém role admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: TEST_ADMIN_PASSWORD },
    })
    const { token } = JSON.parse(res.body)
    const jwt = new JwtService({ secret: TEST_JWT_SECRET })
    const payload = jwt.verify(token) as { sub: string; role: string }
    expect(payload.sub).toBe('admin')
    expect(payload.role).toBe('admin')
  })

  it('retorna 401 com senha incorreta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: 'senha-errada' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('retorna 400 sem body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('retorna 400 com senha vazia (ValidationPipe rejeita antes do serviço)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { password: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})
