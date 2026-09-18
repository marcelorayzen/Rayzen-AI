import { readdir, mkdir, rename, stat } from 'fs/promises'
import { join, extname, resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

const EXT_MAP: Record<string, string> = {
  '.pdf': 'PDFs', '.doc': 'Docs', '.docx': 'Docs', '.txt': 'Docs',
  '.jpg': 'Imagens', '.jpeg': 'Imagens', '.png': 'Imagens',
  '.mp4': 'Videos', '.mov': 'Videos',
  '.zip': 'Arquivos', '.rar': 'Arquivos',
  '.exe': 'Instaladores', '.dmg': 'Instaladores',
}

export async function organizeDownloads(payload: { path: string; dryRun?: boolean }) {
  const dir = resolve(payload.path)
  // Achado da varredura de 2026-09-12: esta função nunca teve checagem de safe-root — QUALQUER
  // path era aceito, e o resultado é MOVER/RENOMEAR arquivos ali (não só ler). É a ação com
  // maior potencial de dano das três que a varredura achou sem checagem nenhuma.
  if (!isUnderSafeRoot(dir)) {
    throw new Error(`Caminho não permitido: ${dir}`)
  }
  const entries = await readdir(dir)
  const moves: Array<{ from: string; to: string }> = []
  for (const name of entries) {
    const filePath = join(dir, name)
    const s = await stat(filePath)
    if (s.isDirectory()) continue
    const folder = EXT_MAP[extname(name).toLowerCase()] ?? 'Outros'
    const destPath = join(dir, folder, name)
    if (!payload.dryRun) {
      await mkdir(join(dir, folder), { recursive: true })
      await rename(filePath, destPath)
    }
    moves.push({ from: filePath, to: destPath })
  }
  return { dryRun: payload.dryRun ?? false, moved: moves.length, moves }
}
