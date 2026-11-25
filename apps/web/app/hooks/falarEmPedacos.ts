'use client'

import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

/**
 * ── HC7a: falar uma resposta em pedaços ──────────────────────────────────────
 *
 * Uma chamada só ao Gemini TTS com a resposta inteira falhava (1.015 caracteres → 500 depois de
 * 158 s), e o servidor cortava tudo em 800 caracteres calado. Agora o servidor quebra a resposta em
 * frases (`POST /voice/pedacos`, até 350 caracteres). Aqui cada pedaço é sintetizado **enquanto o
 * anterior toca**: a primeira palavra sai em ~7 s e o resto vem sem espera entre os pedaços.
 *
 * **Reserva:** se a síntese de um pedaço falhar, esse pedaço é falado pela voz pt-BR do próprio
 * aparelho (`speechSynthesis`) e o próximo volta a tentar a Charon. Uma falha do Gemini troca a voz
 * por alguns segundos, mas não deixa a resposta muda. Decidido pelo Marcelo em 23/11.
 *
 * Sem React de propósito: o modo conversa (HC7b) usa a mesma função para encadear ouvir → falar.
 */
export interface Fala {
  /** Para agora: o áudio atual e os pedaços que faltam. */
  parar: () => void
  /** Resolve quando a fala termina, inteira ou parada. Nunca rejeita. */
  terminou: Promise<void>
}

async function pedirPedacos(texto: string): Promise<string[]> {
  try {
    const r = await fetch(`${API_URL}/voice/pedacos`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: texto }),
    })
    if (!r.ok) throw new Error(String(r.status))
    const d = await r.json() as { pedacos?: unknown }
    return Array.isArray(d.pedacos) ? d.pedacos.filter((p): p is string => typeof p === 'string') : []
  } catch {
    // Sem a quebra do servidor, ainda dá para falar: o texto inteiro pela voz do aparelho.
    return []
  }
}

async function sintetizar(pedaco: string): Promise<Blob | null> {
  try {
    const r = await fetch(`${API_URL}/voice/synthesize`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text: pedaco }),
    })
    return r.ok ? await r.blob() : null
  } catch {
    return null
  }
}

/** A voz pt-BR do aparelho; no Android/Chrome, a "Google português do Brasil" quando existe. */
function vozDoAparelho(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const vozes = speechSynthesis.getVoices()
  return vozes.find((v) => v.lang === 'pt-BR' && /google/i.test(v.name))
    ?? vozes.find((v) => v.lang === 'pt-BR')
    ?? vozes.find((v) => v.lang.startsWith('pt'))
    ?? null
}

export function falarEmPedacos(texto: string): Fala {
  let parado = false
  let audioAtual: HTMLAudioElement | null = null

  const parar = () => {
    parado = true
    audioAtual?.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }

  const tocar = (blob: Blob) => new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audioAtual = audio
    const fim = () => { URL.revokeObjectURL(url); resolve() }
    audio.onended = fim
    audio.onerror = fim
    // Parar não dispara `ended`; sem isto a fala ficaria presa esperando.
    audio.onpause = fim
    void audio.play().catch(fim)
  })

  const falarNoAparelho = (pedaco: string) => new Promise<void>((resolve) => {
    if (typeof speechSynthesis === 'undefined' || parado) { resolve(); return }
    const fala = new SpeechSynthesisUtterance(pedaco)
    fala.lang = 'pt-BR'
    const voz = vozDoAparelho()
    if (voz) fala.voice = voz
    fala.onend = () => resolve()
    fala.onerror = () => resolve()
    speechSynthesis.speak(fala)
  })

  const terminou = (async () => {
    const pedacos = await pedirPedacos(texto)
    if (parado) return
    if (pedacos.length === 0) {
      await falarNoAparelho(texto)
      return
    }
    let proxima = sintetizar(pedacos[0])
    for (let i = 0; i < pedacos.length; i++) {
      const audio = await proxima
      if (parado) return
      // O próximo já começa a ser preparado enquanto este toca.
      if (i + 1 < pedacos.length) proxima = sintetizar(pedacos[i + 1])
      if (audio) await tocar(audio)
      else await falarNoAparelho(pedacos[i])
      if (parado) return
    }
  })().catch(() => undefined)

  return { parar, terminou }
}
