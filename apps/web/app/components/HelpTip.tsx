'use client'

import { useState } from 'react'

interface HelpTipProps {
  title: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function HelpTip({ title, children, side = 'bottom' }: HelpTipProps) {
  const [open, setOpen] = useState(false)

  const positionClass = {
    top:    'bottom-full mb-1.5 left-0',
    bottom: 'top-full mt-1.5 left-0',
    left:   'right-full mr-1.5 top-0',
    right:  'left-full ml-1.5 top-0',
  }[side]

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-3.5 h-3.5 rounded-full border text-[8px] leading-none font-bold transition-colors shrink-0 ${
          open
            ? 'border-zinc-400 text-zinc-100 bg-zinc-700'
            : 'border-zinc-700 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400'
        }`}
        aria-label={`Ajuda: ${title}`}
      >
        ?
      </button>
      {open && (
        <div className={`absolute z-50 w-56 ${positionClass}`}>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 shadow-xl">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-semibold text-zinc-200 leading-snug">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-600 hover:text-zinc-400 text-xs leading-none shrink-0 mt-px"
              >
                ×
              </button>
            </div>
            <div className="text-[10px] text-zinc-400 leading-relaxed">{children}</div>
          </div>
        </div>
      )}
    </span>
  )
}
