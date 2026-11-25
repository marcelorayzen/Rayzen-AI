import { guardianAnalyze } from '../guardian-analyze'

/**
 * Achado da varredura de 2026-09-12: `jarvis:guardian_analyze` estava whitelisted e registrado
 * como skill, mas sem handler em `executor.ts` — qualquer despacho real batia em
 * `Handler não implementado`. Este arquivo cobre o handler novo; a consistência
 * whitelist↔executor está em `__tests__/executor-cobre-whitelist.spec.ts`.
 */
describe('guardianAnalyze — falha fechado sem workdir conhecido', () => {
  it('projectId sem checkout local conhecido recusa, nunca cai para process.cwd()', async () => {
    const original = process.env.AGENT_TOKEN
    delete process.env.AGENT_TOKEN // resolverWorkdir devolve null sem chamar rede nenhuma
    try {
      await expect(
        guardianAnalyze({ projectId: 'projeto-que-nao-existe-9x7', changedFiles: ['a.ts'] }),
      ).rejects.toThrow(/não tem checkout local conhecido/)
    } finally {
      if (original !== undefined) process.env.AGENT_TOKEN = original
    }
  })
})
