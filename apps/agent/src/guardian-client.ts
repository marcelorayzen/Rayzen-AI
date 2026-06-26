import axios from 'axios'
import { readdirSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const GUARDABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'generated'])

function collectFiles(dir: string, depth = 0): string[] {
  if (depth > 4) return []
  const result: string[] = []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return result }

  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      result.push(...collectFiles(full, depth + 1))
    } else if (GUARDABLE_EXTENSIONS.has(extname(e.name))) {
      result.push(full.replace(/\\/g, '/'))
    }
  }
  return result
}

export interface GuardianAnalysisResult {
  id:              string
  riskLevel:       string
  riskScore:       number
  deployRecommend: string
  summary:         string
  filesWithoutTests: string[]
}

export async function triggerGuardianAnalysis(params: {
  projectId: string
  repoPath:  string
  changedFiles: string[]
  apiV2Url:  string
  apiToken:  string
}): Promise<GuardianAnalysisResult | null> {
  if (process.env.AGENT_GUARDIAN_ENABLED === 'false') return null

  try {
    const allFiles = collectFiles(params.repoPath)
    const api = axios.create({
      baseURL: params.apiV2Url,
      headers: { Authorization: `Bearer ${params.apiToken}` },
      timeout: 5000,
    })

    const { data } = await api.post<GuardianAnalysisResult>('/v2/guardian/analyze', {
      projectId:    params.projectId,
      repoPath:     params.repoPath,
      changedFiles: params.changedFiles,
      allFiles,
    })

    const threshold = process.env.AGENT_GUARDIAN_RISK_THRESHOLD ?? 'medium'
    const levels    = ['low', 'medium', 'high', 'critical']
    const meetsThreshold = levels.indexOf(data.riskLevel) >= levels.indexOf(threshold)

    if (meetsThreshold) {
      console.log(`[guardian] ${data.riskLevel.toUpperCase()} (${data.riskScore}) — ${data.summary}`)
    }

    // Webhook notification for high/critical — fire-and-forget
    const webhookUrl   = process.env.GUARDIAN_WEBHOOK_URL
    const webhookToken = process.env.GUARDIAN_WEBHOOK_TOKEN
    if (webhookUrl && (data.riskLevel === 'high' || data.riskLevel === 'critical')) {
      axios.post(
        webhookUrl,
        {
          source:            'rayzen-guardian',
          riskLevel:         data.riskLevel,
          riskScore:         data.riskScore,
          summary:           data.summary,
          filesWithoutTests: data.filesWithoutTests,
          deployRecommend:   data.deployRecommend,
          changedFiles:      params.changedFiles.slice(0, 5),
          projectId:         params.projectId,
        },
        {
          headers: webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {},
          timeout: 3000,
        },
      ).catch(() => null)
    }

    // Escreve cache local no tmpdir do agent — o context-hook lê daqui.
    // A api-v2 escreve no tmpdir do container Docker (inacessível ao hook).
    // Sem isso, riskLevel nunca chegaria ao contexto do Claude Code.
    writeGuardianCache(params.projectId, data)

    return data
  } catch {
    return null
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000

function writeGuardianCache(projectId: string, report: GuardianAnalysisResult): void {
  try {
    const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 8)
    const file = join(tmpdir(), `rayzen-guardian-${hash}.json`)
    writeFileSync(file, JSON.stringify({ report, expiresAt: Date.now() + CACHE_TTL_MS }))
  } catch { /* non-critical */ }
}
