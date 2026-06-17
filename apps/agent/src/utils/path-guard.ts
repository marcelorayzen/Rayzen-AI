import { isAbsolute, relative, resolve } from 'path'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

export const SAFE_ROOTS = [
  resolve(HOME, 'Downloads'),
  resolve(HOME, 'Documents'),
  resolve(HOME, 'Desktop'),
  resolve(HOME, 'Projects'),
  ...(process.env.AGENT_PROJECT_ROOT ? [resolve(process.env.AGENT_PROJECT_ROOT)] : []),
]

export function isUnderSafeRoot(target: string): boolean {
  const resolved = resolve(target)
  return SAFE_ROOTS.some((root) => {
    const rel = relative(root, resolved)
    // rel === '' means target IS the root; !startsWith('..') blocks traversal up;
    // !isAbsolute(rel) blocks Windows absolute paths returned by relative() on different drives
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}
