import { execSync } from 'child_process'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'

function safeExec(cmd: string, cwd: string): string {
  return execSync(cmd, { encoding: 'utf-8', cwd, timeout: 15000 }).trim()
}

function validatePath(path: string): string {
  const resolved = resolve(path)
  if (!isUnderSafeRoot(resolved)) throw new Error(`Caminho não permitido: ${resolved}`)
  if (!existsSync(resolved)) throw new Error(`Pasta não encontrada: ${resolved}`)
  return resolved
}

export async function gitStatus(payload: { path: string }) {
  const cwd = validatePath(payload.path)
  const output = safeExec('git status --short', cwd)
  const branch = safeExec('git branch --show-current', cwd)
  const lines = output ? output.split('\n').map((l) => l.trim()) : []
  return { branch, changed: lines.length, files: lines }
}

export async function gitLog(payload: { path: string; limit?: number }) {
  const cwd = validatePath(payload.path)
  const limit = Math.min(payload.limit ?? 10, 30)
  const output = safeExec(`git log --oneline -${limit}`, cwd)
  const commits = output.split('\n').filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split(' ')
    return { hash, message: rest.join(' ') }
  })
  return { commits }
}

export async function gitBranch(payload: { path: string; name?: string; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  if (!payload.name) {
    const output = safeExec('git branch', cwd)
    const branches = output.split('\n').map((b) => b.trim().replace(/^\* /, '')).filter(Boolean)
    const current = safeExec('git branch --show-current', cwd)
    return { branches, current }
  }
  const name = payload.name.replace(/[^a-zA-Z0-9_\-/]/g, '-')
  if (payload.dryRun) return { dryRun: true, wouldCreate: name }
  safeExec(`git checkout -b ${name}`, cwd)
  return { created: name }
}

export async function gitDiff(payload: { path: string; staged?: boolean; file?: string }) {
  const cwd = validatePath(payload.path)
  const flag = payload.staged ? '--staged' : ''
  const file = payload.file ? ` -- "${payload.file}"` : ''
  const output = safeExec(`git diff ${flag}${file}`.trim(), cwd)
  return { diff: output.slice(0, 8000), truncated: output.length > 8000 }
}

export async function gitPull(payload: { path: string; rebase?: boolean; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  if (payload.dryRun) {
    try {
      const behind = safeExec('git rev-list HEAD..@{u} --count', cwd)
      return { dryRun: true, commitsBehind: parseInt(behind) || 0 }
    } catch { return { dryRun: true, commitsBehind: 0 } }
  }
  const flag = payload.rebase ? '--rebase' : ''
  const output = safeExec(`git pull ${flag}`.trim(), cwd)
  return { pulled: true, output }
}

export async function gitPush(payload: { path: string; branch?: string; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const current = safeExec('git branch --show-current', cwd)
  if (payload.dryRun) {
    try {
      const ahead = safeExec('git rev-list @{u}..HEAD --count', cwd)
      return { dryRun: true, branch: current, commitsAhead: parseInt(ahead) || 0 }
    } catch { return { dryRun: true, branch: current, commitsAhead: 0 } }
  }
  const target = payload.branch ?? current
  safeExec(`git push origin ${target}`, cwd)
  return { pushed: true, branch: target }
}

export async function gitAdd(payload: { path: string; files: string[]; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const safe = payload.files
    .filter((f) => !f.includes('../') && !f.startsWith('/'))
    .slice(0, 50)
  if (!safe.length) throw new Error('Nenhum arquivo válido para adicionar')
  if (payload.dryRun) return { dryRun: true, files: safe }
  safeExec(`git add ${safe.map((f) => `"${f}"`).join(' ')}`, cwd)
  return { added: true, files: safe }
}

export async function gitCommit(payload: { path: string; message: string; files?: string[]; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const message = payload.message.replace(/"/g, "'").slice(0, 200)

  if (payload.files?.length) {
    const safe = payload.files.filter((f) => !f.includes('../')).slice(0, 50)
    safeExec(`git add ${safe.map((f) => `"${f}"`).join(' ')}`, cwd)
  } else {
    safeExec('git add -A', cwd)
  }

  if (payload.dryRun) {
    const status = safeExec('git status --short', cwd)
    return { dryRun: true, message, files: status.split('\n').filter(Boolean) }
  }
  safeExec(`git commit -m "${message}"`, cwd)
  return { committed: true, message }
}
