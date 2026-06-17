'use client'

import type { ImportTab } from '../hooks/useProjects'

interface ImportModalProps {
  importTab: ImportTab
  setImportTab: (tab: ImportTab) => void
  importResult: string | null
  setImportResult: (result: string | null) => void
  importLoading: boolean
  githubUser: string
  setGithubUser: (value: string) => void
  githubRepo: string
  setGithubRepo: (value: string) => void
  githubToken: string
  setGithubToken: (value: string) => void
  handleImportGithub: () => void
  notionToken: string
  setNotionToken: (value: string) => void
  notionPageId: string
  setNotionPageId: (value: string) => void
  handleImportNotion: () => void
  handleImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  importUrl: string
  setImportUrl: (value: string) => void
  handleImportUrl: () => void
  onClose: () => void
}

export function ImportModal({
  importTab, setImportTab, importResult, setImportResult, importLoading,
  githubUser, setGithubUser, githubRepo, setGithubRepo, githubToken, setGithubToken, handleImportGithub,
  notionToken, setNotionToken, notionPageId, setNotionPageId, handleImportNotion,
  handleImportFile, importUrl, setImportUrl, handleImportUrl, onClose,
}: ImportModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-200">Indexar no Brain</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
          {(['github', 'notion', 'file', 'url'] as ImportTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => { setImportTab(tab); setImportResult(null) }}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                importTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'github' ? 'GitHub' : tab === 'notion' ? 'Notion' : tab === 'file' ? 'Arquivo' : 'URL'}
            </button>
          ))}
        </div>

        {/* GitHub tab */}
        {importTab === 'github' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Usuário GitHub</label>
              <input
                value={githubUser}
                onChange={(e) => setGithubUser(e.target.value)}
                placeholder="ex: marcelorayzen"
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Repositório (opcional)</label>
              <input
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="ex: rayzen-ai"
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
              <p className="text-[11px] text-zinc-600 mt-1">Preencha para indexar só este repo; vazio indexa todos.</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Token (opcional — para repos privados)</label>
              <input
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                type="password"
                placeholder="ghp_..."
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <button
              onClick={handleImportGithub}
              disabled={importLoading || !githubUser.trim()}
              className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {importLoading ? 'Indexando…' : 'Indexar repositórios'}
            </button>
          </div>
        )}

        {/* Notion tab */}
        {importTab === 'notion' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Integration Token</label>
              <input
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                type="password"
                placeholder="secret_..."
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
              <p className="text-[11px] text-zinc-600 mt-1">Crie em notion.so/my-integrations e compartilhe as páginas com ela</p>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">ID ou URL da página (opcional — indexa tudo se vazio)</label>
              <input
                value={notionPageId}
                onChange={(e) => setNotionPageId(e.target.value)}
                placeholder="https://notion.so/... ou UUID"
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <button
              onClick={handleImportNotion}
              disabled={importLoading || !notionToken.trim()}
              className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {importLoading ? 'Indexando…' : 'Indexar páginas Notion'}
            </button>
          </div>
        )}

        {/* File tab */}
        {importTab === 'file' && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">Suporta PDF, TXT, MD e outros arquivos de texto.</p>
            <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-500 transition-colors ${importLoading ? 'opacity-40 pointer-events-none' : ''}`}>
              <span className="text-zinc-500 text-sm">{importLoading ? 'Indexando…' : 'Clique ou arraste o arquivo aqui'}</span>
              <span className="text-zinc-700 text-xs mt-1">.pdf, .txt, .md, .ts, .json, .yaml…</span>
              <input type="file" multiple accept=".pdf,.txt,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.toml,.env.example,.sh,.sql,.csv" className="hidden" onChange={handleImportFile} />
            </label>
          </div>
        )}

        {/* URL tab */}
        {importTab === 'url' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">URL da página</label>
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://..."
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
            </div>
            <button
              onClick={handleImportUrl}
              disabled={importLoading || !importUrl.trim()}
              className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {importLoading ? 'Indexando…' : 'Indexar página'}
            </button>
          </div>
        )}

        {importResult && (
          <p className={`mt-3 text-xs rounded-lg px-3 py-2 ${importResult.startsWith('Erro') ? 'bg-red-950 text-red-400' : 'bg-zinc-800 text-zinc-300'}`}>
            {importResult}
          </p>
        )}
      </div>
    </div>
  )
}
