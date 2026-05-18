import { execSync } from 'child_process'

function exec(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim()
}

export async function dockerPs() {
  const output = exec('docker ps --format "{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}"')
  const containers = output.split('\n').filter(Boolean).map((line) => {
    const [name, status, image, ports] = line.split('|')
    return { name, status, image, ports }
  })
  return { containers, total: containers.length }
}

export async function dockerStart(payload: { name: string; dryRun?: boolean }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  if (payload.dryRun) return { dryRun: true, wouldStart: name }
  exec(`docker start ${name}`)
  return { started: name }
}

export async function dockerStop(payload: { name: string; dryRun?: boolean }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  if (payload.dryRun) return { dryRun: true, wouldStop: name }
  exec(`docker stop ${name}`)
  return { stopped: name }
}

export async function dockerLogs(payload: { name: string; tail?: number }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  const tail = Math.min(Math.max(payload.tail ?? 100, 1), 500)
  const output = exec(`docker logs --tail ${tail} ${name}`)
  return { name, tail, output: output.slice(-12000) }
}
