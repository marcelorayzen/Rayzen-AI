import { triggerGuardianAnalysis, type GuardianAnalysisResult } from '../guardian-client'
import { resolverWorkdir } from '../exec/workdir'

/**
 * Achado da varredura de 2026-09-12: `jarvis:guardian_analyze` está whitelisted
 * (`security/whitelist.ts`), tem escopo de role (`role-policy.ts`) e está registrado como
 * skill em `apps/api-v2/src/skill-engine/skill-registry.ts` (oferecido a specialists) — mas
 * `executor.ts` nunca teve um `case` para ele. Qualquer despacho real caía no
 * `default: throw new Error('Handler não implementado: ...')`. `triggerGuardianAnalysis()`
 * (`guardian-client.ts`) já existe e já é usado pelo `workspace-watcher.ts` (ciclo automático
 * de 30s) — este arquivo é o handler que faltava para o despacho SOB DEMANDA (via `jarvis:*`,
 * chamável por um specialist), reaproveitando a mesma função em vez de duplicá-la.
 *
 * `repoPath` não é parâmetro do skill (inputSchema declara só `projectId`/`changedFiles`) —
 * resolvido via `resolverWorkdir()` (Fase 3), a mesma fonte que a capability de `run_command`
 * usa. Sem checkout local conhecido, falha fechado — nunca cai para `process.cwd()`.
 */
export async function guardianAnalyze(payload: {
  projectId: string
  changedFiles: string[]
}): Promise<GuardianAnalysisResult> {
  const repoPath = await resolverWorkdir(payload.projectId)
  if (!repoPath) {
    throw new Error(`Projeto "${payload.projectId}" não tem checkout local conhecido nesta máquina.`)
  }

  const apiV2Url = process.env.AGENT_API_V2_URL ?? (() => {
    try {
      const u = new URL(process.env.AGENT_API_URL ?? '')
      return `${u.protocol}//${u.hostname}:3103`
    } catch { return null }
  })()
  if (!apiV2Url) {
    throw new Error('AGENT_API_V2_URL não configurado e AGENT_API_URL não é uma URL válida para derivar a porta v2.')
  }

  const resultado = await triggerGuardianAnalysis({
    projectId: payload.projectId,
    repoPath,
    changedFiles: payload.changedFiles,
    apiV2Url,
    apiToken: process.env.AGENT_TOKEN ?? '',
  })

  if (!resultado) {
    throw new Error('Guardian analyze falhou ou está desabilitado (AGENT_GUARDIAN_ENABLED=false) — ver log do agent.')
  }
  return resultado
}
