'use client'

import type { GitContext } from '../page'

interface GitContextModalProps {
  gitContext: GitContext
  onClose: () => void
}

export function GitContextModal({ gitContext, onClose }: GitContextModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Git context</span>
            {gitContext.lastBranch && (
              <span className="text-[10px] bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded font-mono">{gitContext.lastBranch}</span>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {gitContext.lastCommitHash && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Último commit</p>
              <p className="text-xs font-mono text-zinc-300">
                <span className="text-indigo-400">{gitContext.lastCommitHash}</span>
                {' '}{gitContext.lastCommitMessage}
              </p>
            </div>
          )}
          {Object.keys(gitContext.branches).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Branches ativas</p>
              <div className="space-y-1">
                {Object.entries(gitContext.branches)
                  .sort((a, b) => b[1] - a[1])
                  .map(([branch, count]) => (
                    <div key={branch} className="flex items-center justify-between">
                      <span className="text-xs font-mono text-zinc-300">{branch}</span>
                      <span className="text-[10px] text-zinc-600">{count} eventos</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {gitContext.recentCommits.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Commits recentes</p>
              <div className="space-y-2">
                {gitContext.recentCommits.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[10px] font-mono text-indigo-400 shrink-0 pt-0.5">{c.hash}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-zinc-300 truncate">{c.message}</p>
                      <p className="text-[10px] text-zinc-600">{c.branch} · {new Date(c.ts).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {gitContext.mostTouchedFiles.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Arquivos mais alterados</p>
              <div className="space-y-1">
                {gitContext.mostTouchedFiles.map(({ file, count }) => (
                  <div key={file} className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[80%]">{file}</span>
                    <span className="text-[10px] text-zinc-600 shrink-0 ml-2">{count}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-zinc-700">{gitContext.totalGitEvents} eventos com contexto git</p>
        </div>
      </div>
    </div>
  )
}
