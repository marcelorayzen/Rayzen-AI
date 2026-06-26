#!/usr/bin/env node
// Instala o pre-push hook do Guardian no repositório atual.
// Uso: pnpm guardian:install-hooks

import { existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const repoRoot   = resolve(__dirname, '..')
const hooksDir   = join(repoRoot, '.git', 'hooks')
const hookTarget = join(hooksDir, 'pre-push')
const hookSrc    = join(repoRoot, 'apps', 'agent', 'src', 'hooks', 'pre-push.mjs')
  .replace(/\\/g, '/')

if (!existsSync(join(repoRoot, '.git'))) {
  console.error('[guardian] Não é um repositório git — abra no diretório raiz do projeto.')
  process.exit(1)
}

if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true })

// Wrapper sh: portável em Linux, macOS e Windows Git Bash
const content = `#!/bin/sh
node "${hookSrc}" "$@"
`
writeFileSync(hookTarget, content, 'utf8')
try { chmodSync(hookTarget, 0o755) } catch { /* no-op no Windows */ }

console.log(`[guardian] pre-push hook instalado: ${hookTarget}`)
console.log(`[guardian] Variáveis necessárias no .env:`)
console.log(`  AGENT_API_V2_URL=http://192.168.0.174:3103`)
console.log(`  AGENT_TOKEN=<jwt>`)
console.log(`  GUARDIAN_PROJECT_ID=<uuid>`)
