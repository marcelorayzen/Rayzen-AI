import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('rayzen', {
  minimize:   () => ipcRenderer.send('window:minimize'),
  close:      () => ipcRenderer.send('window:close'),

  onWsEvent: (cb: (e: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: unknown) => cb(event)
    ipcRenderer.on('ws:event', handler)
    return () => ipcRenderer.removeListener('ws:event', handler)
  },

  fetchProjects:  ()                                   => ipcRenderer.invoke('projects:fetch'),
  fetchMissions:  (projectId: string)                  => ipcRenderer.invoke('missions:fetch', projectId),
  missionAction:  (id: string, action: string)         => ipcRenderer.invoke('missions:action', { id, action }),
  openInBrowser:  (missionId: string)                  => ipcRenderer.send('mission:open-browser', missionId),
  launchClaude:   (projectPath: string, objective: string) =>
                    ipcRenderer.invoke('claude:launch', { projectPath, objective }),
  transcribe:     (buffer: ArrayBuffer)                => ipcRenderer.invoke('voice:transcribe', buffer),
  sendChat:       (projectId: string, content: string, sessionId?: string) =>
                    ipcRenderer.invoke('chat:send', { projectId, content, sessionId }),
  getConfig:      ()                                   => ipcRenderer.invoke('config:get'),
})
