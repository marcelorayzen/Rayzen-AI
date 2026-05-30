#!/usr/bin/env node
/**
 * Gerador do catálogo de ações do Agent + matriz de risco (auditoria A-008).
 *
 * Fonte de verdade: apps/agent/src/security/whitelist.ts (ações permitidas)
 * Metadata:         apps/api-v2/src/skill-engine/skill-registry.ts (risk, category, runtime)
 *
 * Cruza as duas fontes, detecta drift (ação sem metadata, ou metadata órfã)
 * e gera docs/agent-actions.md. Rode: pnpm gen:catalog
 *
 * NÃO edite docs/agent-actions.md à mão — ele é regenerado a partir do código.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WHITELIST_PATH = join(ROOT, 'apps/agent/src/security/whitelist.ts')
const REGISTRY_PATH  = join(ROOT, 'apps/api-v2/src/skill-engine/skill-registry.ts')
const OUT_PATH       = join(ROOT, 'docs/agent-actions.md')

// 1. Whitelist — ações + categoria inferida do comentário de seção
function parseWhitelist() {
  const lines = readFileSync(WHITELIST_PATH, 'utf8').split('\n')
  const actions = []
  let section = 'Outros'
  for (const line of lines) {
    const comment = line.match(/^\s*\/\/\s*(.+)$/)
    if (comment) { section = comment[1].trim(); continue }
    const action = line.match(/'(jarvis:[a-z_]+)'/)
    if (action) actions.push({ id: action[1], section })
  }
  return actions
}

// 2. Skill Registry V2 — metadata por ação (uma linha por skill)
function parseRegistry() {
  const text = readFileSync(REGISTRY_PATH, 'utf8')
  const meta = new Map()
  for (const line of text.split('\n')) {
    const id = line.match(/id:\s*'([^']+)'/)
    if (!id) continue
    const pick = (k) => (line.match(new RegExp(`${k}:\\s*'([^']+)'`)) ?? [])[1] ?? null
    meta.set(id[1], {
      name:     pick('name'),
      category: pick('category'),
      risk:     pick('risk'),
      runtime:  pick('runtime'),
    })
  }
  return meta
}

const RISK_BADGE = { none: '🟢 none', low: '🟢 low', medium: '🟡 medium', high: '🔴 high' }

function main() {
  const actions = parseWhitelist()
  const registry = parseRegistry()

  const rows = actions.map((a) => {
    const m = registry.get(a.id)
    return {
      id: a.id,
      section: a.section,
      name: m?.name ?? '—',
      category: m?.category ?? '—',
      risk: m?.risk ?? null,
      runtime: m?.runtime ?? '—',
      hasMeta: Boolean(m),
    }
  })

  // Drift: skills no registry que NÃO estão na whitelist
  const whitelistIds = new Set(actions.map((a) => a.id))
  const orphanRegistry = [...registry.keys()].filter((id) => !whitelistIds.has(id))

  // Ações sem metadata no registry (ex: supervised_session)
  const missingMeta = rows.filter((r) => !r.hasMeta)

  // Contagem por risco
  const byRisk = { high: 0, medium: 0, low: 0, none: 0, undef: 0 }
  for (const r of rows) {
    if (!r.risk) byRisk.undef++
    else byRisk[r.risk] = (byRisk[r.risk] ?? 0) + 1
  }

  const now = new Date().toISOString()
  const lines = []
  lines.push('# Catálogo de Ações do Agent — Matriz de Risco')
  lines.push('')
  lines.push('> 🤖 **GERADO AUTOMATICAMENTE** por `scripts/gen-agent-catalog.mjs` — não edite à mão.')
  lines.push('> Fonte de verdade: `whitelist.ts` · Metadata: `skill-registry.ts` (V2)')
  lines.push(`> Gerado em: ${now}`)
  lines.push('')
  lines.push(`**Total: ${rows.length} ações** · 🔴 ${byRisk.high} high · 🟡 ${byRisk.medium} medium · 🟢 ${byRisk.low} low · 🟢 ${byRisk.none} none · ⚠️ ${byRisk.undef} sem metadata`)
  lines.push('')
  lines.push('| Ação | Nome | Risco | Runtime | Categoria | Metadata |')
  lines.push('|---|---|---|---|---|---|')
  for (const r of rows) {
    const risk = r.risk ? (RISK_BADGE[r.risk] ?? r.risk) : '⚠️ indefinido'
    const meta = r.hasMeta ? '✓' : '**ausente no registry**'
    lines.push(`| \`${r.id}\` | ${r.name} | ${risk} | ${r.runtime} | ${r.category} | ${meta} |`)
  }
  lines.push('')

  if (missingMeta.length) {
    lines.push('## ⚠️ Ações sem definição no Skill Registry V2')
    lines.push('')
    lines.push('Estas ações existem na whitelist mas não têm metadata (risco/runtime) no registry. Adicionar em `apps/api-v2/src/skill-engine/skill-registry.ts`:')
    lines.push('')
    for (const r of missingMeta) lines.push(`- \`${r.id}\` (seção: ${r.section})`)
    lines.push('')
  }

  if (orphanRegistry.length) {
    lines.push('## ⚠️ Metadata órfã (registry sem whitelist)')
    lines.push('')
    lines.push('Skills definidas no registry mas ausentes na whitelist — ação não executável:')
    lines.push('')
    for (const id of orphanRegistry) lines.push(`- \`${id}\``)
    lines.push('')
  }

  if (!missingMeta.length && !orphanRegistry.length) {
    lines.push('✅ Sem drift: whitelist e registry estão sincronizados.')
    lines.push('')
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8')

  // Resumo no console
  console.log(`✓ Catálogo gerado: docs/agent-actions.md`)
  console.log(`  ${rows.length} ações · 🔴 ${byRisk.high} · 🟡 ${byRisk.medium} · 🟢 ${byRisk.low + byRisk.none} · ⚠️ ${byRisk.undef} sem metadata`)
  if (missingMeta.length) console.log(`  ⚠️  ${missingMeta.length} ação(ões) sem metadata: ${missingMeta.map((r) => r.id).join(', ')}`)
  if (orphanRegistry.length) console.log(`  ⚠️  ${orphanRegistry.length} metadata órfã(s): ${orphanRegistry.join(', ')}`)
}

main()
