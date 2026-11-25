import { readFileSync } from 'node:fs'

const PLANO = 'docs/plano-duas-trilhas.md'

export function lerPlanoVigente(markdown) {
  const bloco = markdown.match(/<!-- rayzen:meta status=(ativa|concluida) -->\s*#\s+([^\n]+)([\s\S]*?)<!-- \/rayzen:meta -->/)
  if (!bloco) return null
  const [, status, titulo, corpo] = bloco
  const criterios = [...corpo.matchAll(/^- \[([ x])\]\s+([\w.-]+)\s+(.+)$/gm)]
    .map(([, marcado, id, text]) => ({ id, text: text.trim(), done: marcado === 'x' }))
  return { status, title: titulo.trim(), successCriteria: criterios }
}

export function tarefasAbertas(markdown) {
  return [...markdown.matchAll(/^- \[ \]\s+\*\*([A-Z]\d[\w.]*)\s+([^*]+)\*\*/gm)]
    .map(([, id, title]) => `${id} ${title.trim()}`)
}

export async function sincronizarPlanoVigente({ filePath, projectId, apiUrl, apiToken }) {
  if (!filePath?.replace(/\\/g, '/').endsWith(PLANO) || !projectId || !apiUrl) return null
  const markdown = readFileSync(filePath, 'utf8')
  const meta = lerPlanoVigente(markdown)
  if (!meta) return { skipped: 'sem_bloco' }
  const headers = { 'Content-Type': 'application/json', ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}) }
  const atual = await fetch(`${apiUrl}/projects/${encodeURIComponent(projectId)}/graph/goal`, { headers }).then((r) => r.ok ? r.json() : null)
  const goal = atual?.goal ?? atual
  if (meta.status === 'concluida' && goal?.id) {
    await fetch(`${apiUrl}/projects/${encodeURIComponent(projectId)}/graph/goal/${encodeURIComponent(goal.id)}/status`, {
      method: 'PATCH', headers, body: JSON.stringify({ status: 'achieved' }),
    })
  } else if (meta.status === 'ativa') {
    const url = goal?.id
      ? `${apiUrl}/projects/${encodeURIComponent(projectId)}/graph/goal/${encodeURIComponent(goal.id)}`
      : `${apiUrl}/projects/${encodeURIComponent(projectId)}/graph/goal`
    await fetch(url, { method: goal?.id ? 'PATCH' : 'POST', headers, body: JSON.stringify({ title: meta.title, successCriteria: meta.successCriteria }) })
  }
  const body = { source: PLANO, status: meta.status, nextSteps: tarefasAbertas(markdown) }
  await fetch(`${apiUrl}/projects/${encodeURIComponent(projectId)}/state/plano-vigente`, { method: 'PUT', headers, body: JSON.stringify(body) })
  return body
}
