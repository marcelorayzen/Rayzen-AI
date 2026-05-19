import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

async function postIndex(apiUrl: string, token: string, body: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${apiUrl}/memory/index`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request
    const payload = JSON.stringify(body)
    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload)
    req.end()
  })
}

function runGraphify(cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('graphify', ['.', '--no-viz', '--update', '--backend', 'anthropic'], {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
      shell: true,
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }))
  })
}

export async function runGraphify_action(payload: {
  projectPath?: string
  projectId?: string
  dryRun?: boolean
}): Promise<unknown> {
  if (process.env.AGENT_ROLE === 'server') {
    return { ok: false, skipped: true, reason: 'jarvis:run_graphify só executa no agente desktop (código-fonte local)' }
  }

  const projectPath = payload.projectPath ?? process.cwd()
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''

  if (payload.dryRun) {
    return { ok: true, dryRun: true, projectPath, command: 'graphify . --no-viz --update --backend anthropic' }
  }

  const result = await runGraphify(projectPath)

  const reportPath = join(projectPath, 'graphify-out', 'GRAPH_REPORT.md')
  if (!existsSync(reportPath)) {
    return {
      ok: false,
      exitCode: result.code,
      stdout: result.stdout.slice(-2000),
      stderr: result.stderr.slice(-2000),
      error: 'GRAPH_REPORT.md não encontrado após execução do graphify',
    }
  }

  const reportContent = readFileSync(reportPath, 'utf8')

  const indexed = await postIndex(apiUrl, token, {
    content: reportContent,
    sourcePath: `graphify/${projectPath}`,
    projectId: payload.projectId,
    metadata: { type: 'graphify_report', projectPath, generatedAt: new Date().toISOString() },
  })

  return {
    ok: result.code === 0,
    exitCode: result.code,
    reportPath,
    indexed,
    stdout: result.stdout.slice(-1000),
  }
}
