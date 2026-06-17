'use client'

import type { Dispatch, SetStateAction } from 'react'

interface NewProjectWizardProps {
  onboardStep: 1 | 2 | 3
  closeNewProject: () => void
  newProjectName: string
  setNewProjectName: (value: string) => void
  newProjectSlug: string
  setNewProjectSlug: (value: string) => void
  newProjectDesc: string
  setNewProjectDesc: (value: string) => void
  createProject: () => void
  creatingProject: boolean
  onboardSrcTab: 'github' | 'notion' | 'skip'
  setOnboardSrcTab: (tab: 'github' | 'notion' | 'skip') => void
  githubUser: string
  setGithubUser: (value: string) => void
  githubRepo: string
  setGithubRepo: (value: string) => void
  githubToken: string
  setGithubToken: (value: string) => void
  notionToken: string
  setNotionToken: (value: string) => void
  notionPageId: string
  setNotionPageId: (value: string) => void
  onboardIndexSource: () => void
  onboardIndexing: boolean
  onboardIndexResult: string | null
  setOnboardStep: (step: 1 | 2 | 3) => void
  onboardGoalTitle: string
  setOnboardGoalTitle: (value: string) => void
  onboardGoalDate: string
  setOnboardGoalDate: (value: string) => void
  onboardGoalCriteria: string[]
  setOnboardGoalCriteria: Dispatch<SetStateAction<string[]>>
  onboardCreateGoal: () => void
  onboardSavingGoal: boolean
}

export function NewProjectWizard({
  onboardStep, closeNewProject,
  newProjectName, setNewProjectName, newProjectSlug, setNewProjectSlug, newProjectDesc, setNewProjectDesc,
  createProject, creatingProject,
  onboardSrcTab, setOnboardSrcTab,
  githubUser, setGithubUser, githubRepo, setGithubRepo, githubToken, setGithubToken,
  notionToken, setNotionToken, notionPageId, setNotionPageId,
  onboardIndexSource, onboardIndexing, onboardIndexResult, setOnboardStep,
  onboardGoalTitle, setOnboardGoalTitle, onboardGoalDate, setOnboardGoalDate,
  onboardGoalCriteria, setOnboardGoalCriteria, onboardCreateGoal, onboardSavingGoal,
}: NewProjectWizardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onboardStep === 1 ? closeNewProject : undefined} />
      <div className="relative z-50 w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mx-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            {onboardStep === 1 ? 'Novo projeto' : onboardStep === 2 ? 'Indexar fonte de conhecimento' : 'Primeira meta'}
          </h2>
          <button onClick={closeNewProject} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {/* Step bar */}
        <div className="flex gap-1.5 mb-4">
          {([1, 2, 3] as const).map(s => (
            <div key={s} className={`h-0.5 flex-1 rounded-full transition-colors ${onboardStep >= s ? 'bg-zinc-100' : 'bg-zinc-700'}`} />
          ))}
        </div>

        {/* Step 1 — project info */}
        {onboardStep === 1 && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Nome *</label>
              <input
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value)
                  if (!newProjectSlug) setNewProjectSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') createProject() }}
                placeholder="ex: Rayzen PDV"
                autoFocus
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">
                Pasta / repo slug
                <span className="text-zinc-600 ml-1">— deve bater com o nome da pasta no VS Code</span>
              </label>
              <div className="flex gap-2">
                <input
                  value={newProjectSlug}
                  onChange={(e) => setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  placeholder="ex: rayzen-pdv"
                  className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 font-mono"
                />
                <label
                  title="Selecionar pasta"
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-300 hover:text-zinc-100 transition-colors text-sm cursor-pointer"
                >
                  📁
                  <input
                    type="file"
                    // @ts-expect-error — webkitdirectory não está no tipo padrão
                    webkitdirectory=""
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const parts = file.webkitRelativePath.split('/')
                      const folderName = parts[0].toLowerCase().replace(/[^a-z0-9-_]/g, '-')
                      setNewProjectSlug(folderName)
                      if (!newProjectName.trim()) setNewProjectName(parts[0])
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">O hook do Claude detecta automaticamente o projeto por este nome · ou clique em 📁 para selecionar a pasta</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Descrição (opcional)</label>
              <input
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                placeholder="ex: plataforma de testes de IA"
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <button
              onClick={createProject}
              disabled={creatingProject || !newProjectName.trim()}
              className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {creatingProject ? 'Criando…' : 'Criar e continuar →'}
            </button>
          </div>
        )}

        {/* Step 2 — source indexing */}
        {onboardStep === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">Indexe o repositório ou docs para o Brain entender o contexto do projeto.</p>
            <div className="flex gap-1">
              {(['github', 'notion', 'skip'] as const).map(tab => (
                <button key={tab} onClick={() => setOnboardSrcTab(tab)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${onboardSrcTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  {tab === 'github' ? 'GitHub' : tab === 'notion' ? 'Notion' : 'Pular'}
                </button>
              ))}
            </div>

            {onboardSrcTab === 'github' && (
              <div className="space-y-2">
                <input value={githubUser} onChange={e => setGithubUser(e.target.value)} placeholder="usuário ou org (ex: marcelorayzen)"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                <input value={githubRepo} onChange={e => setGithubRepo(e.target.value)} placeholder="repositório (opcional — indexa todos se vazio)"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                <input value={githubToken} onChange={e => setGithubToken(e.target.value)} placeholder="token GitHub (opcional, para repos privados)" type="password"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
              </div>
            )}

            {onboardSrcTab === 'notion' && (
              <div className="space-y-2">
                <input value={notionToken} onChange={e => setNotionToken(e.target.value)} placeholder="Integration token (secret_...) *" type="password"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                <input value={notionPageId} onChange={e => setNotionPageId(e.target.value)} placeholder="ID ou URL da página (opcional)"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
              </div>
            )}

            {onboardSrcTab === 'skip' && (
              <p className="text-xs text-zinc-500">Você pode indexar fontes depois no painel Brain.</p>
            )}

            <button
              onClick={onboardSrcTab === 'skip' ? () => setOnboardStep(3) : onboardIndexSource}
              disabled={
                onboardIndexing ||
                (onboardSrcTab === 'github' && !githubUser.trim()) ||
                (onboardSrcTab === 'notion' && !notionToken.trim())
              }
              className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded-lg py-2 text-sm font-medium disabled:opacity-40 transition-colors"
            >
              {onboardIndexing ? 'Indexando…' : onboardSrcTab === 'skip' ? 'Pular →' : 'Indexar e continuar →'}
            </button>
            {onboardIndexResult && (
              <p className={`text-xs rounded-lg px-3 py-2 ${onboardIndexResult.startsWith('Erro') ? 'bg-red-950 text-red-400' : 'bg-zinc-800 text-zinc-300'}`}>
                {onboardIndexResult}
              </p>
            )}
          </div>
        )}

        {/* Step 3 — first goal */}
        {onboardStep === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">Defina onde este projeto quer chegar. O Rayzen usará isso para orientar o Gap Analysis.</p>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Título da meta *</label>
              <input value={onboardGoalTitle} onChange={e => setOnboardGoalTitle(e.target.value)}
                placeholder="ex: Lançar MVP com 50 usuários ativos"
                autoFocus
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Prazo (opcional)</label>
              <input type="date" value={onboardGoalDate} onChange={e => setOnboardGoalDate(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Critérios de sucesso</label>
              <div className="space-y-1.5">
                {onboardGoalCriteria.map((c, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input value={c} onChange={e => setOnboardGoalCriteria(p => p.map((x, j) => j === i ? e.target.value : x))}
                      placeholder={`Critério ${i + 1}`}
                      onKeyDown={e => { if (e.key === 'Enter' && i === onboardGoalCriteria.length - 1) setOnboardGoalCriteria(p => [...p, '']) }}
                      className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                    {onboardGoalCriteria.length > 1 && (
                      <button onClick={() => setOnboardGoalCriteria(p => p.filter((_, j) => j !== i))}
                        className="text-zinc-600 hover:text-zinc-400 text-lg leading-none px-1">×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setOnboardGoalCriteria(p => [...p, ''])}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">+ critério</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={closeNewProject}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg py-2 text-sm font-medium transition-colors">
                Pular
              </button>
              <button onClick={onboardCreateGoal} disabled={onboardSavingGoal || !onboardGoalTitle.trim()}
                className="flex-1 bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors">
                {onboardSavingGoal ? 'Salvando…' : 'Concluir'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
