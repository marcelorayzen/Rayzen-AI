import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Migrado por consistência: `container` vem de `SERVER_API_CONTAINER`, uma variável de
 * ambiente do OPERADOR, não de payload externo — quem já controla o ambiente do agent tem
 * acesso equivalente por outros meios, então o risco aqui sempre foi bem menor que
 * `git.ts`/`prisma.ts`/`run-tests.ts`. Migrado mesmo assim: mesma regra para todo lugar é
 * mais fácil de manter do que uma exceção "este aqui é seguro porque...".
 */
export async function restartApi(payload: { dryRun?: boolean }) {
  if (process.env.AGENT_ROLE !== 'server') {
    return { ok: false, skipped: true, reason: 'jarvis:restart_api só executa no agente da VPS (AGENT_ROLE=server)' }
  }

  const container = process.env.SERVER_API_CONTAINER ?? 'rayzen-ai-api-1'
  const command = `docker restart ${container}`

  if (payload.dryRun) {
    return { ok: true, dryRun: true, container, command }
  }

  const r = await executarPrograma('executavel', 'docker', ['restart', container], {
    cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 120_000,
  })

  if (r.code === 0) return { ok: true, container, output: r.stdout.trim() }
  return { ok: false, container, error: `exit ${r.code}`, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}
