import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron'
import path from 'path'
import { RayzenWsClient } from './ws-client'
import { ClaudeLauncher } from './claude-launcher'
import { VoiceRecorder } from './voice'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let ws: RayzenWsClient | null = null
let voice: VoiceRecorder | null = null

const API_URL   = process.env.RAYZEN_API_URL   || 'https://api.rayzen.com.br'
const WS_URL    = process.env.RAYZEN_WS_URL    || 'ws://20.251.146.221:3104/ws'
const API_TOKEN = process.env.RAYZEN_TOKEN     || ''
const PROJECT_ID = process.env.RAYZEN_PROJECT_ID || ''

function createWindow() {
  win = new BrowserWindow({
    width:           420,
    height:          780,
    minWidth:        380,
    minHeight:       500,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     false,
    skipTaskbar:     false,
    resizable:       true,
    webPreferences: {
      preload:        path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Rayzen AI')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar', click: () => win?.show() },
    { label: 'Ocultar',  click: () => win?.hide() },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]))
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show())
}

app.whenReady().then(() => {
  createWindow()
  createTray()

  ws = new RayzenWsClient(WS_URL, API_TOKEN, PROJECT_ID, (event) => {
    win?.webContents.send('ws:event', event)
  })
  ws.connect()

  voice = new VoiceRecorder(API_URL, API_TOKEN)

  // IPC: janela
  ipcMain.on('window:minimize', () => win?.minimize())
  ipcMain.on('window:close',    () => win?.hide())

  // IPC: missão → abrir work panel no browser
  ipcMain.on('mission:open-browser', (_, missionId: string) => {
    shell.openExternal(`https://rayzen.com.br/work-panel?mission=${missionId}`)
  })

  // IPC: trabalhar → lança claude localmente
  ipcMain.handle('claude:launch', async (_, { projectPath, objective }: { projectPath: string; objective: string }) => {
    return ClaudeLauncher.launch(projectPath, objective)
  })

  // IPC: voz
  ipcMain.handle('voice:transcribe', async (_, audioBuffer: ArrayBuffer) => {
    return voice?.transcribe(Buffer.from(audioBuffer))
  })

  // IPC: missões
  ipcMain.handle('missions:fetch', async (_, projectId: string) => {
    const res = await fetch(`${API_URL}/v2/missions?projectId=${projectId}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    })
    return res.ok ? res.json() : []
  })

  ipcMain.handle('missions:action', async (_, { id, action }: { id: string; action: string }) => {
    const res = await fetch(`${API_URL}/v2/missions/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    })
    return res.ok ? res.json() : null
  })

  ipcMain.handle('config:get', () => ({ apiUrl: API_URL, projectId: PROJECT_ID }))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
