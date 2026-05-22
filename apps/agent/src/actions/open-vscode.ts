import { execSync } from 'child_process'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'

export async function openVscode(payload: { path?: string }): Promise<{ opened: string }> {
  if (!payload.path) {
    execSync('code', { stdio: 'ignore' })
    return { opened: '(novo)' }
  }

  const resolved = resolve(payload.path)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Caminho não permitido: ${resolved}`)
  }

  if (!existsSync(resolved)) {
    throw new Error(`Pasta não encontrada: ${resolved}`)
  }

  execSync(`code "${resolved}"`, { stdio: 'ignore' })
  return { opened: resolved }
}
