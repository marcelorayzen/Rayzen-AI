import { resolve, join } from 'path'
import { readdir, stat } from 'fs/promises'
import { isUnderSafeRoot } from '../utils/path-guard'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

interface FileResult {
  name: string
  path: string
  sizeKB: number
  modified: string
}

async function searchRecursive(
  dir: string,
  query: string,
  results: FileResult[],
  depth = 0,
  maxResults = 20,
): Promise<void> {
  if (depth > 4 || results.length >= maxResults) return
  try {
    const entries = await readdir(dir)
    for (const name of entries) {
      if (results.length >= maxResults) break
      if (name.startsWith('.') || name === 'node_modules' || name === '.git') continue
      const fullPath = join(dir, name)
      const s = await stat(fullPath)
      if (s.isDirectory()) {
        await searchRecursive(fullPath, query, results, depth + 1, maxResults)
      } else if (name.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          name,
          path: fullPath,
          sizeKB: Math.round(s.size / 1024),
          modified: s.mtime.toISOString().slice(0, 10),
        })
      }
    }
  } catch { /* pasta sem permissão, skip */ }
}

export async function fileSearch(payload: { query: string; path?: string }): Promise<{ results: FileResult[]; total: number }> {
  const root = payload.path ? resolve(payload.path) : (HOME + '\\Projects')
  if (!isUnderSafeRoot(root)) {
    throw new Error(`Caminho não permitido: ${root}`)
  }
  const results: FileResult[] = []
  await searchRecursive(root, payload.query, results)
  return { results, total: results.length }
}
