import { InfraHealthService } from '../infra-health.service'

/**
 * O check de JWT lia `HOOK_JWT_EXPIRES_AT` do `.env` — uma data mantida à mão.
 * Em 2026-08-15 o token foi rotacionado para 14/09 e o painel seguiu anunciando
 * "12 dias para expirar", porque ninguém atualizou a anotação. Painel de saúde
 * que depende de alguém editar um texto informa o que escreveram, não o que é.
 */
describe('InfraHealthService.checkJwt', () => {
  /** JWT sem assinatura válida — aqui só o payload importa. */
  const jwtComExp = (exp: number) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${b64({ alg: 'HS256' })}.${b64({ sub: 'admin', exp })}.assinatura`
  }

  // +60s de folga: `exp` é em segundos inteiros e `daysLeft` usa Math.floor, então
  // sem folga o alvo cai poucos ms antes da marca e o teste vê d-1.
  const emDias = (d: number) => Math.ceil(Date.now() / 1000) + d * 86400 + 60

  function checar(env: Record<string, string>) {
    const config = { get: (k: string, padrao = '') => env[k] ?? padrao }
    const service = new InfraHealthService(
      {} as never, config as never, {} as never,
    )
    return (service as unknown as { checkJwt(): { ok: boolean; error?: string; meta?: Record<string, unknown> } }).checkJwt()
  }

  it('usa o exp do token e ignora a data anotada quando as duas divergem', () => {
    const r = checar({
      AGENT_TOKEN: jwtComExp(emDias(29)),
      HOOK_JWT_EXPIRES_AT: '2026-08-27',   // anotação velha, o caso real de 15/08
    })

    expect(r.ok).toBe(true)
    expect(r.meta?.fonte).toBe('token')
    expect(r.meta?.daysLeft).toBe(29)
  })

  it('avisa quando faltam menos de 14 dias', () => {
    const r = checar({ AGENT_TOKEN: jwtComExp(emDias(10)) })
    expect(r.ok).toBe(true)
    expect(r.meta?.warning).toBe('expira em 10d')
  })

  it('falha quando o token já expirou', () => {
    const r = checar({ AGENT_TOKEN: jwtComExp(emDias(-1)) })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('JWT expirado')
  })

  it('considera token opaco uma credencial de servico sem validade de sessao', () => {
    const r = checar({
      AGENT_TOKEN: '65a4cabca99c38c59478631873b22d308fe7e19137ef20f1',
      HOOK_JWT_EXPIRES_AT: '2026-12-31',
    })
    expect(r.ok).toBe(true)
    expect(r.meta?.fonte).toBe('token-opaco')
    expect(r.meta?.tipo).toBe('service')
  })

  it('sem token, falha em vez de usar uma data anotada', () => {
    const r = checar({})
    expect(r.ok).toBe(false)
    expect(r.error).toBe('AGENT_TOKEN ausente')
  })
})
