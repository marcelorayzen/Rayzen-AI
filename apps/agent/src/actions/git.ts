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

export async function gitCommit(payload: { path: string; message: string; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const message = payload.message.replace(/"/g, "'").slice(0, 200)
  if (payload.dryRun) {
    const status = safeExec('git status --short', cwd)
    return { dryRun: true, message, files: status.split('\n').filter(Boolean) }
  }
  safeExec('git add -A', cwd)
  safeExec(`git commit -m "${message}"`, cwd)
  return { committed: true, message }
}
