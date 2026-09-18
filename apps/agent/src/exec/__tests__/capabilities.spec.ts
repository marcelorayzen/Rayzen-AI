import { CAPABILITIES, encontrarCapability, validarParams } from '../capabilities.const'
import { ALLOWED_CAPABILITIES } from '../../security/whitelist'
import { isCapabilityAllowedForRole } from '../../role-policy'

/**
 * Fase 2 — para cada capability, um caso de parâmetro inválido (rejeita) e um de argv
 * esperado (compara o VETOR, não a string) — é o critério de teste que o próprio plano
 * declara.
 */
describe('capabilities — cada uma existe nas três listas ao mesmo tempo', () => {
  // As três precisam concordar: o registro (forma), a whitelist (existe) e o role-policy
  // (para quem). Divergência aqui é o mesmo defeito que `memory-ranking.spec.ts`/
  // `event-derived-text.spec.ts` já guardam para outras duplicações desta casa.
  it.each(CAPABILITIES.map((c) => c.id))('%s está na whitelist E tem escopo de role', (id) => {
    expect(ALLOWED_CAPABILITIES.has(id)).toBe(true)
    expect(isCapabilityAllowedForRole('desktop', id) || isCapabilityAllowedForRole('server', id)).toBe(true)
  })

  it('toda capability na whitelist existe no registro — não sobra id órfão', () => {
    for (const id of ALLOWED_CAPABILITIES) {
      expect(encontrarCapability(id)).toBeDefined()
    }
  })
})

describe('docker.images', () => {
  const cap = encontrarCapability('docker.images')!

  it('argv esperado: sem parâmetros', () => {
    expect(cap.argv({})).toEqual(['images'])
  })

  it('parâmetro desconhecido é rejeitado', () => {
    expect(() => validarParams(cap, { extra: 'x' })).toThrow(/parâmetro desconhecido "extra"/)
  })
})

describe('docker.stats', () => {
  const cap = encontrarCapability('docker.stats')!

  it('argv esperado: --no-stream, para não ficar em loop', () => {
    expect(cap.argv({})).toEqual(['stats', '--no-stream'])
  })
})

describe('docker.inspect', () => {
  const cap = encontrarCapability('docker.inspect')!

  it('argv esperado: container como elemento próprio do vetor', () => {
    const params = validarParams(cap, { container: 'rayzen-ai-api-1' })
    expect(cap.argv(params)).toEqual(['inspect', 'rayzen-ai-api-1'])
  })

  it('container ausente é rejeitado — obrigatório', () => {
    expect(() => validarParams(cap, {})).toThrow(/parâmetro obrigatório "container" ausente/)
  })

  it('container com metacaractere é rejeitado pelo validador, nunca vira argv', () => {
    expect(() => validarParams(cap, { container: 'x; rm -rf /' })).toThrow(/nome simples/)
  })
})

describe('docker.compose_ps / docker.compose_config', () => {
  it('compose_ps: argv fixo, sem parâmetros', () => {
    expect(encontrarCapability('docker.compose_ps')!.argv({})).toEqual(['compose', 'ps'])
  })

  it('compose_config: argv fixo, sem parâmetros', () => {
    expect(encontrarCapability('docker.compose_config')!.argv({})).toEqual(['compose', 'config'])
  })
})

describe('docker.compose_logs', () => {
  const cap = encontrarCapability('docker.compose_logs')!

  it('sem service: argv não inclui um serviço específico', () => {
    const params = validarParams(cap, {})
    expect(cap.argv(params)).toEqual(['compose', 'logs', '--tail', '100'])
  })

  it('com service: argv inclui o nome validado', () => {
    const params = validarParams(cap, { service: 'api' })
    expect(cap.argv(params)).toEqual(['compose', 'logs', '--tail', '100', 'api'])
  })

  it('service é opcional — ausência não lança', () => {
    expect(() => validarParams(cap, {})).not.toThrow()
  })

  it('service com metacaractere é rejeitado', () => {
    expect(() => validarParams(cap, { service: 'api && whoami' })).toThrow(/nome simples/)
  })
})

describe('validarParams — comportamento geral', () => {
  it('nunca devolve a string bruta sem passar pelo validador do tipo', () => {
    const cap = encontrarCapability('docker.inspect')!
    // Um valor de container com espaço à volta deve ter sido REJEITADO, não aceito cru.
    expect(() => validarParams(cap, { container: '  api  ' })).toThrow(/nome simples/)
  })
})
