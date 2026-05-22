import { readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

export async function listDir(payload: { path: string }) {
  const resolved = resolve(payload.path)
  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Diretorio nao permitido: ${resolved}`)
  }
  const entries = await readdir(resolved)
  const details = await Promise.all(
    entries.map(async (name) => {
      const s = await stat(join(resolved, name))
      return { name, isDir: s.isDirectory(), size: s.size, modified: s.mtime }
    }),
  )
  return { path: resolved, entries: details }
}
