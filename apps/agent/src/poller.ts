import axios from 'axios'
import { Task } from '@rayzen/types'
import { executeTask } from './executor'

const AGENT_ROLE = process.env.AGENT_ROLE ?? 'desktop'

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
    await api.patch(`/tasks/${task.id}`, { status: 'done', result })
    console.log(`[agent] concluído: ${task.id}`)
  } catch (err) {
    const error = (err as Error).message
    await api.patch(`/tasks/${task.id}`, { status: 'failed', error })
    console.error(`[agent] falhou: ${task.id} — ${error}`)
  }
}
