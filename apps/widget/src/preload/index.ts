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
  openInBrowser:  (missionId: string)                        => ipcRenderer.send('mission:open-browser', missionId),
  launchClaude:   (repoSlug: string, objective: string)      => ipcRenderer.invoke('mission:launch-claude', { repoSlug, objective }),
  transcribe:     (buffer: ArrayBuffer)                => ipcRenderer.invoke('voice:transcribe', buffer),
  sendChat:       (projectId: string, content: string, sessionId?: string) =>
                    ipcRenderer.invoke('chat:send', { projectId, content, sessionId }),
  claudeChat: (projectId: string, message: string, context?: { projectName: string; activeMissions: { title: string; objective: string; status: string }[] }, model?: string) =>
                ipcRenderer.invoke('claude:chat', { projectId, message, context, model }),
  onClaudeChunk: (cb: (chunk: { text: string; done: boolean; error?: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: { text: string; done: boolean; error?: string }) => cb(chunk)
    ipcRenderer.on('claude:chunk', handler)
    return () => ipcRenderer.removeListener('claude:chunk', handler)
  },
  clearClaudeHistory: (projectId: string) => ipcRenderer.send('claude:clear-history', projectId),
  getConfig:      ()                                   => ipcRenderer.invoke('config:get'),
  getWsStatus:    ()                                   => ipcRenderer.invoke('ws:status'),
  notifyReady:    ()                                   => ipcRenderer.send('renderer:ready'),
})
