import { resolve } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Migrado na Fase 1: `execSync(\`code "${resolved}"\`)` → `executarPrograma('entrypointJs', ...)`.
 * `resolved` já passa pelo `path-guard` antes de chegar aqui, mas nome de arquivo dentro de um
 * safe root ainda pode ter espaço e aspas — o vetor evita a necessidade de escapar isso à mão.
 */
const OPCOES = { cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 15_000 } as const

export async function openVscode(payload: { path?: string }): Promise<{ opened: string }> {
  if (!payload.path) {
    await executarPrograma('entrypointJs', 'code', [], OPCOES)
    return { opened: '(novo)' }
  }

  const resolved = resolve(payload.path)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Caminho não permitido: ${resolved}`)
  }

  if (!existsSync(resolved)) {
    throw new Error(`Pasta não encontrada: ${resolved}`)
  }

  await executarPrograma('entrypointJs', 'code', [resolved], OPCOES)
  return { opened: resolved }
}
