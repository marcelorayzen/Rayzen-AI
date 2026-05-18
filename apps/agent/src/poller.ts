import axios from 'axios'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { AgentRole, Task } from '@rayzen/types'
import { executeTask } from './executor'

const AGENT_ROLE: AgentRole = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'

const api = axios.create({
  baseURL: process.env.AGENT_API_URL,
  headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
  timeout: 10_000,
})

export async function poll(): Promise<void> {
  try {
    const { data: tasks } = await api.get<Task[]>(`/tasks/pending?role=${AGENT_ROLE}`)
    for (const task of tasks) {
      await processTask(task)
    }
  } catch (err) {
    // Falha silenciosa — PC pode estar offline temporariamente
    if (process.env.NODE_ENV === 'development') {
      console.error('[poll] erro:', (err as Error).message)
    }
  }
}

async function processTask(task: Task): Promise<void> {
  console.log(`[agent] executando: ${task.module}/${task.action} (${task.id})`)

  // Marca como processing
  await api.patch(`/tasks/${task.id}`, { status: 'processing' }).catch(() => null)

  try {
    const result = await executeTask(task)
    const enrichedResult = await maybeUploadEvidence(task, result)
    await api.patch(`/tasks/${task.id}`, { status: 'done', result: enrichedResult })
    console.log(`[agent] concluído: ${task.id}`)
  } catch (err) {
    const error = (err as Error).message
    await api.patch(`/tasks/${task.id}`, { status: 'failed', error })
    console.error(`[agent] falhou: ${task.id} — ${error}`)
  }
}

async function maybeUploadEvidence(task: Task, result: unknown): Promise<unknown> {
  if (task.module !== 'jarvis' || task.action !== 'screenshot') return result

  const payload = task.payload as Record<string, unknown>
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : null
  const screenshot = result as { path?: string; takenAt?: string }
  if (!projectId || !screenshot?.path) return result

  try {
    const bytes = await readFile(screenshot.path)
    const form = new FormData()
    form.set('file', new Blob([bytes], { type: 'image/png' }), basename(screenshot.path))
    form.set('localPath', screenshot.path)
    if (screenshot.takenAt) form.set('takenAt', screenshot.takenAt)
    if (typeof payload.prompt === 'string') form.set('prompt', payload.prompt)
    if (typeof payload.projectName === 'string') form.set('projectName', payload.projectName)
    if (typeof payload.description === 'string') form.set('description', payload.description)
    if (typeof payload.category === 'string') form.set('category', payload.category)

    const response = await fetch(`${process.env.AGENT_API_URL}/evidence/upload/${projectId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
      body: form,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const upload = await response.json() as { evidenceId?: string; remotePath?: string; url?: string }
    return { ...screenshot, upload }
  } catch (err) {
    console.error('[agent] falha ao enviar evidência:', (err as Error).message)
    return result
  }
}
