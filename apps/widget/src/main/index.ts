import { config as loadEnv } from 'dotenv'
import path, { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { RayzenWsClient } from './ws-client'
import { ClaudeLauncher } from './claude-launcher'
import { VoiceRecorder } from './voice'

// Load .env (dev mode: cwd = monorepo root)
loadEnv({ path: join(process.cwd(), 'apps/widget/.env') })
loadEnv({ path: join(__dirname, '../../.env') })

const API_URL    = process.env.RAYZEN_API_URL    ?? 'https://api.rayzen.com.br'
const WS_URL     = process.env.RAYZEN_WS_URL     ?? 'ws://20.251.146.221:3104/ws'
const API_TOKEN  = process.env.RAYZEN_TOKEN       ?? ''
const PROJECT_ID = process.env.RAYZEN_PROJECT_ID  ?? ''

let win: BrowserWindow | null = null
let ws:  RayzenWsClient | null = null
const voice = new VoiceRecorder(API_URL, API_TOKEN)

function createWindow() {
  win = new BrowserWindow({
    width:  440,
    height: 800,
    minWidth: 380,
    minHeight: 500,
    frame: false,
    transparent: true,
    resizable: true,
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

  // WebSocket
  ws = new RayzenWsClient(WS_URL, API_TOKEN, PROJECT_ID, (event) => {
    win?.webContents.send('ws:event', event)
  })
  ws.connect()

  // IPC handlers
  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:close',    () => win?.hide())

  ipcMain.on('mission:open-browser', (_, missionId: string) => {
    shell.openExternal(`https://rayzen.com.br/work-panel?mission=${missionId}`)
  })

  ipcMain.handle('claude:launch', async (_, { projectPath, objective }: { projectPath: string; objective: string }) => {
    return ClaudeLauncher.launch(projectPath, objective)
  })

  ipcMain.handle('voice:transcribe', async (_, audioBuffer: ArrayBuffer) => {
    return voice.transcribe(Buffer.from(audioBuffer))
  })

  ipcMain.handle('missions:fetch', async (_, projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/v2/missions?projectId=${projectId}`, {
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      })
      return res.ok ? res.json() : []
    } catch { return [] }
  })

  ipcMain.handle('missions:action', async (_, { id, action }: { id: string; action: string }) => {
    try {
      const res = await fetch(`${API_URL}/v2/missions/${id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_TOKEN}` },
      })
      return res.ok ? res.json() : null
    } catch { return null }
  })

  ipcMain.handle('config:get', () => ({ apiUrl: API_URL, projectId: PROJECT_ID }))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    ws?.destroy()
    app.quit()
  }
})

app.on('activate', () => {
  if (!win) createWindow()
})
