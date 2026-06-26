import axios from 'axios'
import { readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

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

    return data
  } catch {
    return null
  }
}
