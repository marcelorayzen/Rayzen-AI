import { execSync } from 'node:child_process'

export async function restartApi(payload: { dryRun?: boolean }) {
  if (process.env.AGENT_ROLE !== 'server') {
    return { ok: false, skipped: true, reason: 'jarvis:restart_api só executa no agente da VPS (AGENT_ROLE=server)' }
  }

  const container = process.env.SERVER_API_CONTAINER ?? 'rayzen-ai-api-1'
  const command = `docker restart ${container}`

  if (payload.dryRun) {
    return { ok: true, dryRun: true, container, command }
  }

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, container, output: output.trim() }
  } catch (err: unknown) {
    const e = err as { message?: string; stdout?: string; stderr?: string }
    return {
      ok: false,
      container,
      error: e.message,
      stdout: e.stdout?.trim(),
      stderr: e.stderr?.trim(),
    }
  }
}
