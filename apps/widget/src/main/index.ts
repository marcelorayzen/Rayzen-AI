import { config as loadEnv } from 'dotenv'
import path, { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { RayzenWsClient } from './ws-client'
import { ClaudeLauncher } from './claude-launcher'
import { VoiceRecorder } from './voice'

loadEnv({ path: join(process.cwd(), 'apps/widget/.env') })
loadEnv({ path: join(__dirname, '../../.env') })

const API_URL    = process.env.RAYZEN_API_URL   ?? 'https://api.rayzen.com.br'
const WS_URL     = process.env.RAYZEN_WS_URL    ?? 'ws://20.251.146.221:3104/ws'
const API_TOKEN  = process.env.RAYZEN_TOKEN      ?? ''
const PROJECT_ID = process.env.RAYZEN_PROJECT_ID ?? ''

let win: BrowserWindow | null = null
let ws:  RayzenWsClient | null = null
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

  ipcMain.handle('voice:transcribe', (_, audioBuffer: ArrayBuffer) =>
    voice.transcribe(Buffer.from(audioBuffer)).catch(() => ''))

  ipcMain.handle('config:get', () => ({ apiUrl: API_URL, projectId: PROJECT_ID }))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { ws?.destroy(); app.quit() }
})

app.on('activate', () => { if (!win) createWindow() })
