#!/usr/bin/env node
/**
 * rayzen-init — registra um novo projeto no Rayzen AI e gera .claude/rayzen-config.json
 *
 * Uso:
 *   node scripts/rayzen-init.mjs                   # no diretório do projeto
 *   node scripts/rayzen-init.mjs --name "Meu App"  # força um nome
 *
 * O que faz:
 *   1. Detecta o nome do projeto via git remote ou diretório
 *   2. Verifica se já existe no Rayzen AI (GET /projects)
 *   3. Se não existe, cria via POST /projects
 *   4. Grava .claude/rayzen-config.json no diretório atual
 *   5. Copia .claude/settings.json se não existir
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:https'
import { request as httpRequest } from 'node:http'

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'project-template')

// ── Config do Rayzen AI (lê do hook.config.mjs do repositório principal) ───────

const HOOK_CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../apps/agent/src/hooks/hook.config.mjs')

async function loadRayzenConfig() {
  if (existsSync(HOOK_CONFIG_PATH)) {
    try {
      const mod = await import(new URL(`file:///${HOOK_CONFIG_PATH.replace(/\\/g, '/')}`).href)
      return mod.default ?? {}
    } catch { /* fallback */ }
  }
  return {
    apiUrl: process.env.RAYZEN_API_URL ?? 'http://localhost:3101',
    apiToken: process.env.RAYZEN_API_TOKEN ?? '',
  }
}

// ── Detecção do nome do projeto ───────────────────────────────────────────────

function detectProjectName() {
  // Argumento explícito
  const nameArg = process.argv.find((a, i) => process.argv[i - 1] === '--name')
  if (nameArg) return nameArg

  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (match?.[1]) return match[1]
  } catch { /* sem remote */ }

  return resolve('.').split(/[\\/]/).pop() ?? 'novo-projeto'
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function apiRequest(method, apiUrl, token, path, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(apiUrl)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? request : httpRequest
    const payload = body ? JSON.stringify(body) : null

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch { resolve({ status: res.statusCode, body: data }) }
      })
    })

    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = await loadRayzenConfig()

  if (!cfg.apiToken) {
    console.error('ERRO: apiToken não encontrado. Certifique-se de que apps/agent/src/hooks/hook.config.mjs existe.')
    process.exit(1)
  }

  const projectName = detectProjectName()
  console.log(`\nRayzen AI — Inicializando projeto: "${projectName}"`)
  console.log(`API: ${cfg.apiUrl}\n`)

  // 1. Verifica se já existe
  let projectId = null
  try {
    const res = await apiRequest('GET', cfg.apiUrl, cfg.apiToken, '/projects')
    if (res.status === 200 && Array.isArray(res.body)) {
      const found = res.body.find(p => p.name?.toLowerCase() === projectName.toLowerCase())
      if (found) {
        projectId = found.id
        console.log(`✓ Projeto já existe: ${projectId}`)
      }
    }
  } catch (err) {
    console.error(`ERRO ao buscar projetos: ${err.message}`)
    process.exit(1)
  }

  // 2. Cria se não existe
  if (!projectId) {
    try {
      const res = await apiRequest('POST', cfg.apiUrl, cfg.apiToken, '/projects', {
        name: projectName,
        description: `Projeto criado via rayzen-init em ${new Date().toLocaleDateString('pt-BR')}`,
      })
      if (res.status === 201 && res.body?.id) {
        projectId = res.body.id
        console.log(`✓ Projeto criado: ${projectId}`)
      } else {
        console.error(`ERRO ao criar projeto: ${JSON.stringify(res.body)}`)
        process.exit(1)
      }
    } catch (err) {
      console.error(`ERRO ao criar projeto: ${err.message}`)
      process.exit(1)
    }
  }

  // 3. Garante que .claude/ existe
  const claudeDir = resolve('.claude')
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })

  // 4. Grava rayzen-config.json
  const configPath = join(claudeDir, 'rayzen-config.json')
  writeFileSync(configPath, JSON.stringify({
    apiUrl: cfg.apiUrl,
    apiToken: cfg.apiToken,
    projectId,
  }, null, 2) + '\n')
  console.log(`✓ ${configPath} criado`)

  // 5. Copia settings.json se não existir
  const settingsPath = join(claudeDir, 'settings.json')
  const templateSettings = join(TEMPLATE_DIR, '.claude', 'settings.json')
  if (!existsSync(settingsPath) && existsSync(templateSettings)) {
    copyFileSync(templateSettings, settingsPath)
    console.log(`✓ ${settingsPath} criado (hooks configurados)`)
  } else if (existsSync(settingsPath)) {
    console.log(`→ ${settingsPath} já existe, não sobrescrito`)
  }

  // 6. Adiciona rayzen-config.json ao .gitignore se não estiver
  const gitignorePath = resolve('.gitignore')
  const entry = '.claude/rayzen-config.json'
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf8')
    if (!content.includes(entry)) {
      writeFileSync(gitignorePath, content + `\n# Rayzen AI — credenciais locais\n${entry}\n`)
      console.log(`✓ .gitignore atualizado`)
    }
  } else {
    writeFileSync(gitignorePath, `# Rayzen AI — credenciais locais\n${entry}\n`)
    console.log(`✓ .gitignore criado`)
  }

  console.log(`\n✓ Pronto! Projeto "${projectName}" registrado no Rayzen AI.`)
  console.log(`  ID: ${projectId}`)
  console.log(`  Reinicie o VSCode para ativar os hooks.\n`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
