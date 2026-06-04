import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('rayzen', {
  // Window controls
  minimize: ()                    => ipcRenderer.send('window:minimize'),
  close:    ()                    => ipcRenderer.send('window:close'),

  // Events from WebSocket
  onWsEvent: (cb: (e: unknown) => void) => {
    ipcRenderer.on('ws:event', (_, event) => cb(event))
    return () => ipcRenderer.removeAllListeners('ws:event')
  },

  // Missions
  fetchMissions: (projectId: string)                 => ipcRenderer.invoke('missions:fetch', projectId),
  missionAction: (id: string, action: string)        => ipcRenderer.invoke('missions:action', { id, action }),
  openInBrowser: (missionId: string)                 => ipcRenderer.send('mission:open-browser', missionId),

  // Claude launcher
  launchClaude: (projectPath: string, objective: string) =>
    ipcRenderer.invoke('claude:launch', { projectPath, objective }),

  // Voice
  transcribe: (buffer: ArrayBuffer) => ipcRenderer.invoke('voice:transcribe', buffer),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
})
