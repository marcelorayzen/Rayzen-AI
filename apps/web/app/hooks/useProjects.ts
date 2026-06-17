'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from '../components/toast'

export interface Project {
  id: string
  name: string
  status: string
}

export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<Project>
  return typeof p.id === 'string' && typeof p.name === 'string' && typeof p.status === 'string'
}

export function projectListFromResponse(data: unknown): Project[] {
  if (Array.isArray(data)) return data.filter(isProject)
  if (!data || typeof data !== 'object') return []
  const payload = data as { projects?: unknown; items?: unknown; data?: unknown }
  if (Array.isArray(payload.projects)) return payload.projects.filter(isProject)
  if (Array.isArray(payload.items)) return payload.items.filter(isProject)
  if (Array.isArray(payload.data)) return payload.data.filter(isProject)
  return []
}

export type ImportTab = 'github' | 'file' | 'url' | 'notion'

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectSlug, setNewProjectSlug] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [onboardStep, setOnboardStep] = useState<1 | 2 | 3>(1)
  const [onboardProjectId, setOnboardProjectId] = useState<string | null>(null)
  const [onboardSrcTab, setOnboardSrcTab] = useState<'github' | 'notion' | 'skip'>('github')
  const [onboardIndexing, setOnboardIndexing] = useState(false)
  const [onboardIndexResult, setOnboardIndexResult] = useState<string | null>(null)
  const [onboardGoalTitle, setOnboardGoalTitle] = useState('')
  const [onboardGoalDate, setOnboardGoalDate] = useState('')
  const [onboardGoalCriteria, setOnboardGoalCriteria] = useState<string[]>([''])
  const [onboardSavingGoal, setOnboardSavingGoal] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importTab, setImportTab] = useState<ImportTab>('github')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [githubUser, setGithubUser] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')

  const projectSelectionInitializedRef = useRef(false)

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id)
    if (id) localStorage.setItem('rayzen_active_project_id', id)
    else localStorage.removeItem('rayzen_active_project_id')
  }, [])

  // Restaura do localStorage logo após hidratação (antes dos projetos carregarem)
  useEffect(() => {
    const savedId = localStorage.getItem('rayzen_active_project_id')
    if (savedId) setActiveProjectIdState(savedId)
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setProjects(projectListFromResponse(d)))
      .catch(() => { setProjects([]); toast.error('Falha ao carregar projetos — verifique a API/conexão') })
  }, [])

  useEffect(() => {
    if (projects.length === 0 || projectSelectionInitializedRef.current) return
    projectSelectionInitializedRef.current = true
    const savedId = localStorage.getItem('rayzen_active_project_id')
    const savedExists = savedId ? projects.some(p => p.id === savedId) : false
    if (savedExists) {
      // Garantir que o estado tem o valor do localStorage (pode ter sido perdido no SSR)
      setActiveProjectId(savedId!)
    } else {
      // Projeto salvo não existe mais — cair no primeiro ativo
      const first = projects.find(p => p.status === 'active') ?? projects[0]
      setActiveProjectId(first?.id ?? null)
    }
  }, [projects, setActiveProjectId])

  const createProject = useCallback(async () => {
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    try {
      const slug = newProjectSlug.trim() || newProjectName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim() || undefined, repoSlug: slug }),
      })
      if (res.ok) {
        const data = await res.json()
        if (isProject(data)) {
          setProjects(prev => [...prev, data])
          setActiveProjectId(data.id)
          setOnboardProjectId(data.id)
          setOnboardStep(2)
        }
      }
    } catch { toast.error('Falha ao criar projeto') }
    finally { setCreatingProject(false) }
  }, [newProjectName, newProjectDesc, newProjectSlug, setActiveProjectId])

  const closeNewProject = useCallback(() => {
    setNewProjectOpen(false)
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectSlug('')
    setOnboardStep(1)
    setOnboardProjectId(null)
    setOnboardGoalTitle('')
    setOnboardGoalDate('')
    setOnboardGoalCriteria([''])
    setOnboardSrcTab('github')
  }, [])

  const onboardIndexSource = useCallback(async () => {
    if (!onboardProjectId) { setOnboardStep(3); return }
    setOnboardIndexing(true)
    setOnboardIndexResult(null)
    try {
      if (onboardSrcTab === 'github' && githubUser.trim()) {
        const username = githubUser.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
        const res = await fetch(`${API_URL}/memory/index/github`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ username, repo: githubRepo.trim() || undefined, token: githubToken.trim() || undefined, projectId: onboardProjectId }),
        })
        if (res.ok) {
          const d = await res.json() as { indexed?: number; repos?: number }
          setOnboardIndexResult(`${d.repos ?? 0} repos indexados (${d.indexed ?? 0} chunks)`)
        } else {
          const err = await res.json().catch(() => ({})) as { message?: string }
          setOnboardIndexResult(`Erro: ${err.message ?? `HTTP ${res.status}`}`)
          return
        }
      } else if (onboardSrcTab === 'notion' && notionToken.trim()) {
        const res = await fetch(`${API_URL}/memory/index/notion`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ integrationToken: notionToken.trim(), rootPageId: notionPageId.trim() || undefined, projectId: onboardProjectId }),
        })
        if (res.ok) {
          const d = await res.json() as { indexed?: number; pages?: number }
          setOnboardIndexResult(`${d.pages ?? 0} páginas indexadas (${d.indexed ?? 0} chunks)`)
        } else {
          const err = await res.json().catch(() => ({})) as { message?: string }
          setOnboardIndexResult(`Erro: ${err.message ?? `HTTP ${res.status}`}`)
          return
        }
      }
    } catch (err) {
      setOnboardIndexResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
      return
    } finally {
      setOnboardIndexing(false)
    }
    setOnboardStep(3)
  }, [onboardProjectId, onboardSrcTab, githubUser, githubRepo, githubToken, notionPageId, notionToken])

  const onboardCreateGoal = useCallback(async () => {
    if (!onboardProjectId || !onboardGoalTitle.trim()) { closeNewProject(); return }
    setOnboardSavingGoal(true)
    try {
      const criteria = onboardGoalCriteria.filter(c => c.trim()).map((text, i) => ({ id: `c${i}`, text, done: false }))
      await fetch(`${API_URL}/projects/${onboardProjectId}/graph/goal`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: onboardGoalTitle.trim(), successCriteria: criteria, targetDate: onboardGoalDate || undefined }),
      })
    } catch { /* silencioso */ }
    finally { setOnboardSavingGoal(false); closeNewProject() }
  }, [onboardProjectId, onboardGoalTitle, onboardGoalDate, onboardGoalCriteria, closeNewProject])

  const deleteProject = useCallback(async (id: string) => {
    if (!confirm('Deletar este projeto? Esta ação não pode ser desfeita.')) return
    const res = await fetch(`${API_URL}/projects/${id}`, { method: 'DELETE', headers: authHeaders() })
    if (!res.ok) {
      alert(`Erro ao deletar projeto (${res.status}). Tente novamente.`)
      return
    }
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProjectId === id) setActiveProjectId(null)
  }, [activeProjectId, setActiveProjectId])

  const renameProject = useCallback(async (id: string, currentName: string) => {
    const name = prompt('Novo nome do projeto:', currentName)
    if (!name?.trim() || name.trim() === currentName) return
    const res = await fetch(`${API_URL}/projects/${id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: name.trim() }),
    })
    const updated = await res.json() as { id: string; name: string; status: string }
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: updated.name } : p))
  }, [])

  const handleImportGithub = useCallback(async () => {
    if (!githubUser.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const username = githubUser.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
      const res = await fetch(`${API_URL}/memory/index/github`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username, repository: githubRepo.trim() || undefined, token: githubToken.trim() || undefined, projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
      const data = await res.json() as { indexed: number; repos: number }
      setImportResult(`${data.repos} repositório${data.repos > 1 ? 's' : ''} indexado${data.repos > 1 ? 's' : ''} (${data.indexed} chunks)`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally { setImportLoading(false) }
  }, [githubUser, githubRepo, githubToken, activeProjectId])

  const handleImportUrl = useCallback(async () => {
    if (!importUrl.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const res = await fetch(`${API_URL}/memory/index/url`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: importUrl.trim(), projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
      const data = await res.json() as { indexed: number }
      setImportResult(`${data.indexed} chunks indexados`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally { setImportLoading(false) }
  }, [importUrl, activeProjectId])

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setImportLoading(true)
    setImportResult(null)
    try {
      let totalChunks = 0
      let errors = 0
      for (const file of files) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          if (activeProjectId) formData.append('projectId', activeProjectId)
          const res = await fetch(`${API_URL}/memory/index/file`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
          })
          if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
          const data = await res.json() as { indexed: number }
          totalChunks += data.indexed
        } catch { errors++ }
        setImportResult(`Indexando… ${files.indexOf(file) + 1}/${files.length}`)
      }
      const msg = errors > 0
        ? `${files.length - errors}/${files.length} arquivos indexados (${totalChunks} chunks) — ${errors} erro(s)`
        : `${files.length} arquivo${files.length > 1 ? 's' : ''} indexado${files.length > 1 ? 's' : ''} (${totalChunks} chunks)`
      setImportResult(msg)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally { setImportLoading(false); e.target.value = '' }
  }, [activeProjectId])

  const handleImportNotion = useCallback(async () => {
    if (!notionToken.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const res = await fetch(`${API_URL}/memory/index/notion`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ integrationToken: notionToken.trim(), rootPageId: notionPageId.trim() || undefined, projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { indexed: number; pages: number }
      setImportResult(`${data.pages} páginas indexadas (${data.indexed} chunks)`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally { setImportLoading(false) }
  }, [notionToken, notionPageId, activeProjectId])

  return {
    projects, setProjects,
    activeProjectId, setActiveProjectId,
    newProjectOpen, setNewProjectOpen,
    newProjectName, setNewProjectName,
    newProjectDesc, setNewProjectDesc,
    newProjectSlug, setNewProjectSlug,
    creatingProject,
    onboardStep, setOnboardStep,
    onboardProjectId,
    onboardSrcTab, setOnboardSrcTab,
    onboardIndexing,
    onboardIndexResult,
    onboardGoalTitle, setOnboardGoalTitle,
    onboardGoalDate, setOnboardGoalDate,
    onboardGoalCriteria, setOnboardGoalCriteria,
    onboardSavingGoal,
    importOpen, setImportOpen,
    importTab, setImportTab,
    importLoading,
    importResult, setImportResult,
    githubUser, setGithubUser,
    githubRepo, setGithubRepo,
    githubToken, setGithubToken,
    importUrl, setImportUrl,
    notionToken, setNotionToken,
    notionPageId, setNotionPageId,
    createProject,
    closeNewProject,
    onboardIndexSource,
    onboardCreateGoal,
    deleteProject,
    renameProject,
    handleImportGithub,
    handleImportUrl,
    handleImportFile,
    handleImportNotion,
  }
}
