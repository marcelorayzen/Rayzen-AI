import { relative, resolve } from 'path'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

export const SAFE_ROOTS = [
  resolve(HOME, 'Downloads'),
  resolve(HOME, 'Documents'),
  resolve(HOME, 'Desktop'),
  resolve(HOME, 'Projects'),
]

export function isUnderSafeRoot(target: string): boolean {
  const resolved = resolve(target)
  return SAFE_ROOTS.some((root) => {
    const rel = relative(root, resolved)
    return !rel.startsWith('..') && !rel.startsWith('/')
  })
}
