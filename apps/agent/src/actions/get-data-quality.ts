import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

async function fetchApi(apiUrl: string, token: string, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(`${apiUrl}${path}`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request
    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

function buildQs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? '?' + parts.join('&') : ''
}

export async function getDataQuality(payload: {
  projectId?: string
  dataset?: string
  type?: 'summary' | 'score' | 'history' | 'rules' | 'results'
  ruleId?: string
  days?: number
}): Promise<unknown> {
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''
  const type = payload.type ?? 'summary'

  const qs = buildQs({
    project_id: payload.projectId,
    dataset: payload.dataset,
    days: payload.days,
    rule_id: payload.ruleId,
  })

  switch (type) {
    case 'score':
      return fetchApi(apiUrl, token, `/data-quality/score${qs}`)
    case 'history':
      return fetchApi(apiUrl, token, `/data-quality/score/history${qs}`)
    case 'rules':
      return fetchApi(apiUrl, token, `/data-quality/rules${qs}`)
    case 'results':
      return fetchApi(apiUrl, token, `/data-quality/results${qs}`)
    default:
      return fetchApi(apiUrl, token, `/data-quality/summary${qs}`)
  }
}
