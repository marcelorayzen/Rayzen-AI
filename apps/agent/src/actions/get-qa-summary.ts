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

export async function getQaSummary(payload: {
  projectId?: string
  type?: 'summary' | 'patterns' | 'flaky' | 'trend'
  days?: number
  runs?: number
}): Promise<unknown> {
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''
  const pid = payload.projectId ? `?project_id=${payload.projectId}` : ''
  const type = payload.type ?? 'summary'

  switch (type) {
    case 'patterns':
      return fetchApi(apiUrl, token, `/qa/patterns${pid}${payload.runs ? `${pid ? '&' : '?'}runs=${payload.runs}` : ''}`)
    case 'flaky':
      return fetchApi(apiUrl, token, `/qa/flaky${pid}`)
    case 'trend':
      return fetchApi(apiUrl, token, `/qa/trend${pid}${payload.days ? `${pid ? '&' : '?'}days=${payload.days}` : ''}`)
    default:
      return fetchApi(apiUrl, token, `/qa/summary${pid}`)
  }
}
