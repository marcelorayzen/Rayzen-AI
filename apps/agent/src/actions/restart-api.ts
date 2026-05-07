import { execSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT   = join(__dirname, '..', '..', '..', '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'restart-api.ps1')

export async function restartApi(payload: { branch?: string; dryRun?: boolean }) {
  const branch  = payload.branch  ?? 'local/marcelo'
  const dryRun  = payload.dryRun  ?? false

  if (dryRun) {
    return { ok: true, dryRun: true, script: SCRIPT, branch }
  }

  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT}" -Branch "${branch}"`

  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: output.trim() }
  } catch (err: unknown) {
    const e = err as { message?: string; stdout?: string; stderr?: string }
    return {
      ok: false,
      error: e.message,
      stdout: e.stdout?.trim(),
      stderr: e.stderr?.trim(),
    }
  }
}
