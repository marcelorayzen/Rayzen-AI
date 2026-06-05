import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync, mkdirSync } from 'fs'
import { resolve, extname, dirname } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

const MAX_READ_BYTES  = 512_000  // 500 KB
const MAX_WRITE_BYTES = 200_000  // 200 KB

// Extensões de texto permitidas para leitura e escrita
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml', '.env',
  '.md', '.txt', '.csv', '.sql',
  '.html', '.css', '.scss',
  '.sh', '.bat', '.ps1',
  '.prisma', '.graphql',
  '.py', '.rb', '.java', '.go', '.rs',
  '.xml', '.config', '.conf', '.ini',
])

// Arquivos que NUNCA podem ser escritos (apenas lidos)
const WRITE_BLOCKED = ['.env', '.pem', '.key', '.p12', '.pfx', '.secret']

function validatePath(filePath: string, forWrite = false): string {
  const resolved = resolve(filePath)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Caminho não permitido: ${resolved}`)
  }

  // Bloqueia path traversal explícito
  if (filePath.includes('../')) {
    throw new Error('Path traversal não permitido')
  }

  const ext = extname(resolved).toLowerCase()

  if (forWrite) {
    if (WRITE_BLOCKED.includes(ext)) {
      throw new Error(`Escrita não permitida em arquivos ${ext}`)
    }
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '') {
      throw new Error(`Extensão não suportada para escrita: ${ext}`)
    }
  } else {
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '') {
      throw new Error(`Extensão não suportada para leitura: ${ext}`)
    }
  }

  return resolved
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function fileRead(payload: {
  path: string
  lines?: { start: number; end?: number }  // leitura parcial
}): Promise<{ path: string; content: string; lines: number; truncated: boolean }> {
  const resolved = validatePath(payload.path)

  if (!existsSync(resolved)) {
    throw new Error(`Arquivo não encontrado: ${resolved}`)
  }

  const stat = statSync(resolved)
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`Arquivo muito grande (${Math.round(stat.size / 1024)}KB, limite 500KB)`)
  }

  let content = readFileSync(resolved, 'utf-8')
  const allLines = content.split('\n')
  let truncated = false

  if (payload.lines) {
    const start = Math.max(0, payload.lines.start - 1)
    const end   = payload.lines.end ? payload.lines.end : allLines.length
    content     = allLines.slice(start, end).join('\n')
    truncated   = end < allLines.length
  }

  return {
    path:     resolved,
    content,
    lines:    allLines.length,
    truncated,
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function fileWrite(payload: {
  path:    string
  content: string
  dryRun?: boolean
}): Promise<{ path: string; bytes: number; dryRun: boolean }> {
  const resolved = validatePath(payload.path, true)

  const bytes = Buffer.byteLength(payload.content, 'utf-8')
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`Conteúdo muito grande (${Math.round(bytes / 1024)}KB, limite 200KB)`)
  }

  if (payload.dryRun) {
    return { path: resolved, bytes, dryRun: true }
  }

  // Cria diretório se não existir
  const dir = dirname(resolved)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(resolved, payload.content, 'utf-8')
  return { path: resolved, bytes, dryRun: false }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function fileDelete(payload: {
  path:    string
  dryRun?: boolean
}): Promise<{ path: string; deleted: boolean; dryRun: boolean }> {
  const resolved = validatePath(payload.path, true)

  if (!existsSync(resolved)) {
    throw new Error(`Arquivo não encontrado: ${resolved}`)
  }

  if (payload.dryRun) {
    return { path: resolved, deleted: false, dryRun: true }
  }

  unlinkSync(resolved)
  return { path: resolved, deleted: true, dryRun: false }
}
