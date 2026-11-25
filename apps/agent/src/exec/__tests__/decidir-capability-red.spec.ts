/**
 * Fase 7, caso 3 do plano: "capability válida + workdir válido + risco `red` sem aprovação →
 * recusada". Nenhuma capability real tem risco `red` hoje (o primeiro lote da Fase 2 é todo
 * `none`) — mas a Fase 5 introduziu `red` como o teto acima de `high`, e `decidir()` precisa
 * tratar `red` como tier de aprovação para CAPABILITY também, não só para o texto livre.
 *
 * Isolado num arquivo próprio porque precisa mockar o registro de capabilities — mockar em
 * `composicao-de-camadas.spec.ts` quebraria os outros casos daquele arquivo, que dependem das
 * capabilities REAIS (`docker.*`).
 */
jest.mock('../capabilities.const', () => {
  const real = jest.requireActual('../capabilities.const')
  return {
    ...real,
    encontrarCapability: (id: string) =>
      id === 'teste.capability_red'
        ? { id: 'teste.capability_red', programa: 'echo', argv: () => ['oi'], params: {}, risco: 'red', descricao: 'sintética, só para este teste' }
        : real.encontrarCapability(id),
  }
})
jest.mock('../../security/whitelist', () => {
  const real = jest.requireActual('../../security/whitelist')
  return { ...real, ALLOWED_CAPABILITIES: new Set([...real.ALLOWED_CAPABILITIES, 'teste.capability_red']) }
})
jest.mock('../../role-policy', () => {
  const real = jest.requireActual('../../role-policy')
  return { ...real, isCapabilityAllowedForRole: (role: string, id: string) => id === 'teste.capability_red' ? true : real.isCapabilityAllowedForRole(role, id) }
})

import { decidir } from '../decidir'

describe('decidir() — capability com risco red (Fase 7, caso 3)', () => {
  const original = process.env.AGENT_TOKEN
  afterEach(() => { if (original === undefined) delete process.env.AGENT_TOKEN; else process.env.AGENT_TOKEN = original })

  it('sem AGENT_TOKEN (sem como pedir aprovação), recusa — nunca executa por confiar no workdir', async () => {
    delete process.env.AGENT_TOKEN
    const decisao = await decidir({ role: 'desktop', capability: 'teste.capability_red', params: {} })

    expect(decisao.risco).toBe('red')
    expect(decisao.requerAprovacao).toBe(true)
    expect(decisao.permitido).toBe(false)
  })

  it('dryRun não consome aprovação, mas reporta requerAprovacao corretamente', async () => {
    const decisao = await decidir({ role: 'desktop', capability: 'teste.capability_red', params: {}, dryRun: true })

    expect(decisao.requerAprovacao).toBe(true)
    expect(decisao.permitido).toBe(true) // dryRun nunca bloqueia — é preview
  })
})
