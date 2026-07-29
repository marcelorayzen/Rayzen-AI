import { PingController } from '../ping.controller'
import { IS_PUBLIC_KEY } from '../auth/public.decorator'

describe('PingController', () => {
  it('responde o payload de health check esperado', () => {
    const controller = new PingController()
    expect(controller.ping()).toEqual({ ok: true, service: 'catalog-guardian' })
  })

  it('carrega metadata @Public() — regressão: sem isto, ApiKeyGuard passa a exigir chave e derruba health check', () => {
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, PingController.prototype.ping)
    expect(isPublic).toBe(true)
  })
})
