'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { Project } from '../hooks/useProjects'
import type { WorkMode } from '../hooks/useChatStream'
import type { QASummary } from '../hooks/useQA'
import type { ProjectState } from '../hooks/useGoalGraph'
import { RISK_COLORS, STAGE_LABELS, type HealthData, type GitContext, type Recommendation } from '../page'

interface HeaderProps {
  openSidebar: () => void
  onOpenSettings: () => void
  openMemoryPanel: () => void
  setImportOpen: (open: boolean) => void
  setImportResult: (result: string | null) => void
  sessionId: string
  activeProjectId: string | null
  setActiveProjectId: (id: string | null) => void
  projects: Project[]
  setNewProjectOpen: (open: boolean) => void
  renameProject: (id: string, currentName: string) => void
  deleteProject: (id: string) => void
  workMode: WorkMode | null
  setWorkMode: (mode: WorkMode | null) => void
  projectState: ProjectState | null
  setStateOpen: (open: boolean) => void
  loadProjectState: (projectId: string) => void
  healthData: HealthData | null
  setHealthOpen: (open: boolean) => void
  setCostsOpen: (open: boolean) => void
  loadCosts: (period: 'today' | 'week' | 'month' | 'all', projectId?: string) => void
  costsPeriod: 'today' | 'week' | 'month' | 'all'
  gitContext: GitContext | null
  setGitOpen: (open: boolean) => void
  recommendations: Recommendation[]
  openRecommendations: () => void
  setQuickCaptureOpen: (open: boolean) => void
  doCheckpoint: () => void
  checkpointing: boolean
  openActivity: () => void
  openGraph: (sub: 'estado' | 'goal' | 'eventos' | 'universe') => void
  qaSummary: QASummary | null
  openQA: () => void
  openEvidence: () => void
  autoVoice: boolean
  setAutoVoice: Dispatch<SetStateAction<boolean>>
  openMissions: () => void
  openSynthesis: () => void
  openDocs: () => void
  onLogout: () => void
  sessionTokens: number
  dailyTokens: number | null
  agentOnline: boolean | null
}

export function Header({
  openSidebar, onOpenSettings, openMemoryPanel, setImportOpen, setImportResult,
  sessionId, activeProjectId, setActiveProjectId, projects, setNewProjectOpen,
  renameProject, deleteProject, workMode, setWorkMode, projectState, setStateOpen,
  loadProjectState, healthData, setHealthOpen, setCostsOpen, loadCosts, costsPeriod,
  gitContext, setGitOpen, recommendations, openRecommendations, setQuickCaptureOpen,
  doCheckpoint, checkpointing, openActivity, openMissions, openGraph, qaSummary, openQA, openEvidence,
  autoVoice, setAutoVoice, openSynthesis, openDocs, onLogout, sessionTokens, dailyTokens, agentOnline,
}: HeaderProps) {
  return (
    <div className="hud-header shrink-0 sticky top-0 z-30 px-6 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={openSidebar}
          style={{color:'var(--hud-dim)'}}
          className="hover:text-white transition-colors"
          title="Histórico de conversas"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <button
          onClick={onOpenSettings}
          style={{color:'var(--hud-dim)'}}
          className="hover:text-white transition-colors"
          title="Configurações"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button
          onClick={openMemoryPanel}
          style={{color:'var(--hud-dim)'}}
          className="hover:text-white transition-colors"
          title="Memória indexada"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <ellipse cx="12" cy="5" rx="9" ry="3"/>
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
          </svg>
        </button>
        <button
          onClick={() => { setImportOpen(true); setImportResult(null) }}
          style={{color:'var(--hud-dim)'}}
          className="hover:text-white transition-colors"
          title="Indexar no Brain"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <div className="flex items-center gap-2.5 shrink-0">
          <img src="/rayzen-icon.svg" width="34" height="34" alt="" aria-hidden="true" className="shrink-0" />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="hud-title text-base font-bold whitespace-nowrap">RAYZEN AI</h1>
              <span
                title={agentOnline === null ? 'verificando agente…' : agentOnline ? 'agente desktop online' : 'agente desktop offline'}
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                  background: agentOnline === null ? '#555' : agentOnline ? '#4ade80' : '#f87171',
                }}
              />
            </div>
            <p className="text-[10px] mt-0.5 whitespace-nowrap" style={{color:'var(--hud-dim)'}}>SID: {sessionId.slice(0, 8)}…</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap justify-end min-w-0">
        <div className="flex items-center gap-1">
          <select
            value={activeProjectId ?? ''}
            onChange={(e) => setActiveProjectId(e.target.value || null)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500"
          >
            <option value="">sem projeto</option>
            {projects.filter((p) => p.status === 'active').map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700 text-base leading-none"
            title="Novo projeto"
          >+</button>
          {activeProjectId && (() => {
            const proj = projects.find((p) => p.id === activeProjectId)
            return proj ? (
              <>
                <button
                  onClick={() => renameProject(proj.id, proj.name)}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700"
                  title="Renomear projeto"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button
                  onClick={() => deleteProject(proj.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700"
                  title="Deletar projeto"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </>
            ) : null
          })()}
        </div>
        {activeProjectId && (
          <select
            value={workMode ?? ''}
            onChange={(e) => setWorkMode((e.target.value as WorkMode) || null)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500"
            title="Modo de trabalho"
          >
            <option value="">modo livre</option>
            <option value="implementation">implementação</option>
            <option value="debugging">debugging</option>
            <option value="architecture">arquitetura</option>
            <option value="study">estudo</option>
            <option value="review">revisão</option>
          </select>
        )}
        {activeProjectId && projectState && (
          <button
            onClick={() => { setStateOpen(true); loadProjectState(activeProjectId!) }}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Ver estado do projeto"
          >
            <div className={`w-2 h-2 rounded-full ${RISK_COLORS[projectState.riskLevel]}`} />
            {STAGE_LABELS[projectState.stage] ?? projectState.stage}
          </button>
        )}
        {activeProjectId && healthData?.current && (
          <button
            onClick={() => setHealthOpen(true)}
            className={`flex items-center gap-1 text-xs font-mono font-semibold transition-colors ${
              healthData.current.score >= 70 ? 'text-emerald-400 hover:text-emerald-300' :
              healthData.current.score >= 40 ? 'text-amber-400 hover:text-amber-300' :
                                                'text-red-400 hover:text-red-300'
            }`}
            title="Health score do projeto"
          >
            ⬡ {healthData.current.score}
          </button>
        )}
        <button
          onClick={() => { setCostsOpen(true); loadCosts(costsPeriod, activeProjectId ?? undefined) }}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-violet-400 transition-colors font-mono"
          title="Análise de custos LLM"
        >
          ◈ costs
        </button>
        {activeProjectId && gitContext && gitContext.lastBranch && (
          <button
            onClick={() => setGitOpen(true)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-mono"
            title="Ver contexto git do projeto"
          >
            ⎇ {gitContext.lastBranch}
          </button>
        )}
        {activeProjectId && (
          <button
            onClick={openRecommendations}
            className="relative flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Recomendações proativas"
          >
            {recommendations.length > 0 && (
              <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${
                recommendations.some(r => r.priority === 'high')   ? 'bg-red-500 text-white' :
                recommendations.some(r => r.priority === 'medium') ? 'bg-amber-500 text-zinc-900' :
                                                                     'bg-zinc-600 text-zinc-300'
              }`}>{recommendations.length}</span>
            )}
            recomendações
          </button>
        )}
        {activeProjectId && (
          <button
            onClick={() => setQuickCaptureOpen(true)}
            className="hud-nav"
            title="Captura rápida: decisão, ideia, problema"
          >
            + capturar
          </button>
        )}
        {activeProjectId && (
          <button
            onClick={doCheckpoint}
            disabled={checkpointing}
            className="hud-nav"
            title="Checkpoint: sintetiza atividade recente"
          >
            {checkpointing ? '…' : 'checkpoint'}
          </button>
        )}
        {activeProjectId && (
          <button
            onClick={openMissions}
            className="hud-nav"
            title="Missões V2 — objetivos estruturados com steps e approval gates"
          >
            missões
          </button>
        )}
        <button
          onClick={openActivity}
          className="hud-nav"
        >
          atividade
        </button>
        {activeProjectId && (
          <button
            onClick={() => openGraph('goal')}
            className="hud-nav"
            title="Goal Graph — meta vs estado atual"
          >
            grafo
          </button>
        )}

        <a href="/catalog" className="hud-nav" title="Catalog — projetos como assets formais com owner, provenance e tags">
          catalog
        </a>

        {activeProjectId && (
          <button
            onClick={openQA}
            className="hud-nav"
            title="Dashboard QA — runs, falhas e tendência"
          >
            <span className="flex items-center gap-1">
              qa
              {qaSummary?.lastRun && (() => {
                const r = qaSummary.lastRun.passRate
                const col = r >= 80 ? '#10b981' : r >= 60 ? '#f59e0b' : '#ef4444'
                return (
                  <span className="flex items-center gap-0.5" style={{ color: col }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: col }} />
                    <span className="text-[9px] tabular-nums font-medium">{r}%</span>
                  </span>
                )
              })()}
            </span>
          </button>
        )}
        {activeProjectId && (
          <button
            onClick={openEvidence}
            className="hud-nav"
            title="Evidências visuais do projeto"
          >
            evidências
          </button>
        )}
        <button
          onClick={() => setAutoVoice((v) => !v)}
          className={`hud-nav ${autoVoice ? 'active' : ''}`}
          title="Ler respostas do assistente em voz alta automaticamente"
        >
          voz {autoVoice ? 'on' : 'off'}
        </button>
        <button
          onClick={openSynthesis}
          className="hud-nav"
        >
          síntese
        </button>
        {activeProjectId && (
          <button
            onClick={openDocs}
            className="hud-nav"
          >
            docs
          </button>
        )}
        <button
          onClick={onLogout}
          className="hud-nav"
          title="Sair"
        >
          sair
        </button>
        {sessionTokens > 0 && (
          <div className="flex flex-col items-end">
            <span className="text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">{sessionTokens.toLocaleString()}</span> tokens sessão
            </span>
            {dailyTokens !== null && (
              <span className="text-xs text-zinc-600">
                {dailyTokens.toLocaleString()} hoje
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
