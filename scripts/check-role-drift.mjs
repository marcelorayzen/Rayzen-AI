#!/usr/bin/env node
/**
 * Anti-drift check (ADR-004): garante que toda ação da whitelist do Agent
 * tem exatamente uma entrada em ACTION_ROLE (execution.service.ts, V1) e que
 * o role atribuído lá é aceito pelo role-policy.ts correspondente.
 *
 * Sem isso, uma ação pode ficar sem `targetRole` — o dispatch pula o
 * fail-fast de heartbeat e a task vira uma race entre agents (era o bug de
 * get_qa_summary/get_data_quality antes do ADR-004; ADR-001/002/003 cobriram
 * casos anteriores da mesma classe).
 *
 * Fontes: apps/agent/src/security/whitelist.ts (45 ações, verdade)
 *         apps/api/src/modules/execution/execution.service.ts (ACTION_ROLE)
 *         apps/agent/src/role-policy.ts (DESKTOP_ACTIONS / SERVER_ACTIONS)
 *
 * Rode: pnpm check:role-drift
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WHITELIST_PATH    = join(ROOT, 'apps/agent/src/security/whitelist.ts')
const EXECUTION_PATH    = join(ROOT, 'apps/api/src/modules/execution/execution.service.ts')
const ROLE_POLICY_PATH  = join(ROOT, 'apps/agent/src/role-policy.ts')

function parseWhitelist() {
  const text = readFileSync(WHITELIST_PATH, 'utf8')
  const ids = [...text.matchAll(/'jarvis:([a-z_]+)'/g)].map((m) => m[1])
  return new Set(ids)
}

function extractBlock(text, startMarker) {
  const start = text.indexOf(startMarker)
  if (start === -1) throw new Error(`Marcador não encontrado: ${startMarker}`)
  const end = text.indexOf('\n}', start)
  if (end === -1) throw new Error(`Fechamento de bloco não encontrado após: ${startMarker}`)
  return text.slice(start, end)
}

function parseActionRole() {
  const text = readFileSync(EXECUTION_PATH, 'utf8')
  const block = extractBlock(text, 'const ACTION_ROLE')
  const map = new Map()
  for (const m of block.matchAll(/([a-z_]+):\s*'(desktop|server)'/g)) {
    map.set(m[1], m[2])
  }
  return map
}

function parseSet(text, startMarker) {
  const block = extractBlock(text, startMarker)
  return new Set([...block.matchAll(/'jarvis:([a-z_]+)'/g)].map((m) => m[1]))
}

function parseRolePolicy() {
  const text = readFileSync(ROLE_POLICY_PATH, 'utf8')
  return {
    desktop: parseSet(text, 'const DESKTOP_ACTIONS'),
    server: parseSet(text, 'const SERVER_ACTIONS'),
  }
}

function main() {
  const whitelist = parseWhitelist()
  const actionRole = parseActionRole()
  const rolePolicy = parseRolePolicy()

  const errors = []

  const missingFromActionRole = [...whitelist].filter((a) => !actionRole.has(a))
  if (missingFromActionRole.length) {
    errors.push(
      `Ações na whitelist sem entrada em ACTION_ROLE (execution.service.ts) — dispatch pula o fail-fast de heartbeat:\n` +
      missingFromActionRole.map((a) => `  - jarvis:${a}`).join('\n'),
    )
  }

  const orphanActionRole = [...actionRole.keys()].filter((a) => !whitelist.has(a))
  if (orphanActionRole.length) {
    errors.push(
      `Entradas em ACTION_ROLE sem correspondente na whitelist (ação não executável):\n` +
      orphanActionRole.map((a) => `  - ${a}`).join('\n'),
    )
  }

  for (const [action, role] of actionRole) {
    const allowedSet = role === 'desktop' ? rolePolicy.desktop : rolePolicy.server
    if (!allowedSet.has(action)) {
      errors.push(
        `ACTION_ROLE atribui '${action}' -> '${role}', mas role-policy.ts não permite 'jarvis:${action}' em ${role === 'desktop' ? 'DESKTOP_ACTIONS' : 'SERVER_ACTIONS'} — role-policy rejeitaria a task no agent.`,
      )
    }
  }

  if (errors.length) {
    console.error('✗ Drift detectado entre whitelist / ACTION_ROLE / role-policy:\n')
    console.error(errors.join('\n\n'))
    process.exit(1)
  }

  console.log(`✓ Sem drift: ${whitelist.size} ações na whitelist, todas com ACTION_ROLE consistente com role-policy.ts.`)
}

main()
