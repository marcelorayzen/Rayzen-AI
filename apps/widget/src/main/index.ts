import { config as loadEnv } from 'dotenv'
import path, { join } from 'path'
import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron'
import { RayzenWsClient } from './ws-client'
import { ClaudeLauncher } from './claude-launcher'
import { ClaudeApiChat } from './claude-api-chat'
import { VoiceRecorder } from './voice'

loadEnv({ path: join(process.cwd(), 'apps/widget/.env') })
loadEnv({ path: join(__dirname, '../../.env') })
loadEnv({ path: join(process.cwd(), '.env') })          // root .env — ANTHROPIC_API_KEY

const API_URL    = process.env.RAYZEN_API_URL    ?? 'https://api.rayzen.com.br'
const WS_URL     = process.env.RAYZEN_WS_URL     ?? 'ws://20.251.146.221:3104/ws'
const API_TOKEN  = process.env.RAYZEN_TOKEN       ?? ''
const PROJECT_ID = process.env.RAYZEN_PROJECT_ID  ?? ''
const LOCAL_ROOT = process.env.RAYZEN_LOCAL_ROOT  ?? ''

let win: BrowserWindow | null = null
let ws:  RayzenWsClient | null = null

// Watchdog: tracks last known service states to detect transitions
const lastHealthOk: Record<string, boolean> = {}

async function fetchInfraHealth() {
  try {
    const ctrl    = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), 5000)
    const res     = await fetch(`${API_URL}/infra/health`, { signal: ctrl.signal })
    clearTimeout(timeout)
    if (!res.ok) return null
    return res.json() as Promise<{ ok: boolean; services: Record<string, { ok: boolean }> }>
  } catch {
    return null
  }
}

async function infraHealthWithWatchdog() {
  const report = await fetchInfraHealth()
  if (!report) return report

  for (const [name, svc] of Object.entries(report.services)) {
    const wasOk = lastHealthOk[name]
    if (wasOk === true && !svc.ok) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Rayzen — serviço caiu',
          body:  `${name} está inacessível`,
        }).show()
      }
    }
    lastHealthOk[name] = svc.ok
  }
  return report
}
const voice = new VoiceRecorder(API_URL, API_TOKEN)

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json', ...extra }
}

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> ?? {}) },
  })
  return res.ok ? res.json() : null
}

function createWindow() {
  win = new BrowserWindow({
    width: 440, height: 820,
    minWidth: 380, minHeight: 500,
    frame: false, transparent: true, resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()

  ws = new RayzenWsClient(WS_URL, API_TOKEN, PROJECT_ID, (event) => {
    win?.webContents.send('ws:event', event)
  })
  ws.connect()

  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:close',    () => win?.hide())

  ipcMain.on('mission:open-browser', (_, missionId: string) => {
    shell.openExternal(`https://rayzen.com.br/work-panel?mission=${missionId}`)
  })

  ipcMain.handle('mission:launch-claude', async (_, { repoSlug, objective }: { repoSlug: string; objective: string }) => {
    if (!LOCAL_ROOT || !repoSlug) return { ok: false, error: 'LOCAL_ROOT não configurado' }
    const projectPath = path.join(LOCAL_ROOT, repoSlug)
    return ClaudeLauncher.launch(projectPath, objective)
  })

  ipcMain.handle('projects:fetch', () =>
    apiFetch('/projects').catch(() => []))

  ipcMain.handle('missions:fetch', (_, projectId: string) =>
    apiFetch(`/v2/missions?projectId=${projectId}`).catch(() => []))

  ipcMain.handle('missions:action', (_, { id, action }: { id: string; action: string }) =>
    apiFetch(`/v2/missions/${id}/${action}`, { method: 'POST' }).catch(() => null))

  ipcMain.handle('chat:send', async (_, { projectId, content, sessionId }: { projectId: string; content: string; sessionId?: string }) => {
    try {
      const res = await fetch(`${API_URL}/v2/chat/message`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ projectId, content, sessionId }),
      })
      return res.ok ? res.json() : null
    } catch { return null }
  })

  ipcMain.handle('claude:launch', (_, { projectPath, objective }: { projectPath: string; objective: string }) =>
    ClaudeLauncher.launch(projectPath, objective))

  ipcMain.handle('claude:chat', (_, { projectId, message, context, model }: { projectId: string; message: string; context?: import('./claude-api-chat').ClaudeContext; model?: string }) => {
    if (!win) return
    return ClaudeApiChat.stream(projectId, message, context, win, model)
  })

  ipcMain.on('claude:clear-history', (_, projectId: string) => {
    ClaudeApiChat.clearHistory(projectId)
  })

  ipcMain.handle('voice:transcribe', (_, audioBuffer: ArrayBuffer) =>
    voice.transcribe(Buffer.from(audioBuffer)).catch(() => ''))

  ipcMain.handle('infra:health',  () => infraHealthWithWatchdog())
  ipcMain.handle('config:get',    () => ({ apiUrl: API_URL, projectId: PROJECT_ID, localRoot: LOCAL_ROOT }))
  ipcMain.handle('ws:status',     () => ws?.connected ?? false)
  ipcMain.on('renderer:ready',    () => {
    // Renderer pronto — envia estado atual da conexão
    if (ws?.connected) win?.webContents.send('ws:event', { type: 'connected', projectId: PROJECT_ID, payload: null })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { ws?.destroy(); app.quit() }
})

app.on('activate', () => { if (!win) createWindow() })
