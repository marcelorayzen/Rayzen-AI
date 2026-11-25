'use client'

import type { ModoConversa } from '../hooks/useModoConversa'
import type { FaseDaConversa } from '../hooks/conversaCiclo'

/**
 * HC7b: a faixa do modo conversa. Grande de propósito: no celular, apoiado na mesa, é o único alvo
 * de toque, e durante a fala tocar nela interrompe e volta a ouvir.
 */
const ROTULO: Record<Exclude<FaseDaConversa, 'desligada'>, { texto: string; dica: string; cor: string }> = {
  ouvindo:       { texto: 'Ouvindo…',       dica: 'Fale. Uma pausa de 1,5 s envia.',           cor: 'border-emerald-700 text-emerald-200' },
  transcrevendo: { texto: 'Entendendo…',    dica: 'Transcrevendo o que você disse.',           cor: 'border-sky-800 text-sky-200' },
  pensando:      { texto: 'Pensando…',      dica: 'O Hub está respondendo. Um bipe a cada 5 s.', cor: 'border-sky-800 text-sky-200' },
  falando:       { texto: 'Falando',        dica: 'Toque aqui para interromper e falar.',      cor: 'border-amber-700 text-amber-200' },
}

export function FaixaDaConversa({ conversa }: { conversa: ModoConversa }) {
  if (conversa.fase === 'desligada') return null
  const r = ROTULO[conversa.fase]
  return (
    <div className="max-w-3xl mx-auto mb-2 flex gap-2" role="status" aria-live="polite">
      <button
        type="button"
        onClick={conversa.tocar}
        className={`flex-1 rounded-xl border bg-zinc-900/80 px-4 py-4 text-left ${r.cor}`}
        style={conversa.fase === 'ouvindo' ? { animation: 'hud-pulse-red 1.6s ease-in-out infinite' } : undefined}
      >
        <span className="block text-base font-semibold">🗣️ {r.texto}</span>
        <span className="block text-xs text-zinc-400">{r.dica}</span>
        {conversa.fase === 'ouvindo' && (
          // O volume que o detector está lendo. Se a barra não se mexe quando você fala, o microfone
          // não está chegando ao detector; se mexe pouco, a voz está abaixo do limiar.
          <span className="mt-2 block h-1.5 w-full overflow-hidden rounded bg-zinc-800" aria-hidden>
            <span
              className="block h-full bg-emerald-400 transition-[width] duration-100"
              style={{ width: `${Math.min(100, Math.round(conversa.nivel * 1000))}%` }}
            />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={conversa.desligar}
        className="hud-btn px-4 text-sm text-zinc-300"
        aria-label="Sair do modo conversa"
      >
        Sair
      </button>
    </div>
  )
}
