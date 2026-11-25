'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from '../components/toast'
import { useVoiceInput, type MedidaDaEscuta } from './useVoiceInput'
import { falarEmPedacos, type Fala } from './falarEmPedacos'
import {
  passoDaConversa, CONVERSA_DESLIGADA,
  type EstadoDaConversa, type EventoDaConversa, type EfeitoDaConversa, type FaseDaConversa, type MotivoDaSaida,
} from './conversaCiclo'

/**
 * ── HC7b: modo conversa ──────────────────────────────────────────────────────
 *
 * Executa os efeitos que `passoDaConversa` decide: abre e fecha o microfone, toca os tons, envia ao
 * Hub, fala a resposta e segura a tela acesa. A regra do ciclo mora em `conversaCiclo.ts`, testada.
 *
 * A resposta chega por fora: `useChatStream` acompanha o turno (fila, 202, consulta) e chama
 * `receberResposta` quando ele termina. Assim o modo conversa usa o mesmo caminho do texto, com o
 * mesmo fio, o mesmo Hermes e os mesmos cartões.
 */

/** Pulso discreto enquanto o Hub pensa: 25 s calados (a mediana medida) parecem defeito. */
const PULSO_MS = 5000

const MENSAGEM_DA_SAIDA: Record<MotivoDaSaida, string | null> = {
  manual: null,
  silencio: 'Modo conversa desligado: duas escutas seguidas sem fala.',
  tela: 'Modo conversa desligado: a tela apagou ou a aba foi trocada.',
  tempo: 'Modo conversa desligado depois de 30 minutos. Toque em "conversar" para seguir.',
  microfone: 'Modo conversa desligado: o microfone não abriu.',
}

/**
 * Quantos cartões aguardam aprovação no fio. Os mesmos quatro tipos que `PendentesNoFio` mostra.
 * Comparado antes e depois do turno: se aumentou, a voz avisa que há cartão na tela.
 */
async function contarPendentes(projectId: string | null): Promise<number> {
  const q = projectId ? `?projectId=${projectId}` : ''
  const contar = async (url: string, filtro?: (x: { status?: string }) => boolean) => {
    try {
      const r = await fetch(url, { headers: authHeaders() })
      if (!r.ok) return 0
      const lista = await r.json() as Array<{ status?: string }>
      return Array.isArray(lista) ? (filtro ? lista.filter(filtro) : lista).length : 0
    } catch {
      return 0
    }
  }
  const partes = await Promise.all([
    contar(`${API_URL}/hub/handoffs/pendentes${q}`),
    contar(`${API_URL}/rotinas${q}`, (r) => r.status === 'proposta'),
    contar(`${API_URL}/hub/memoria/propostas${q}`),
    projectId
      ? contar(`${V2_URL}/memory/knowledge/proposals?${new URLSearchParams({ scopeType: 'project', projectId, status: 'candidate' })}`)
      : Promise.resolve(0),
  ])
  return partes.reduce((a, b) => a + b, 0)
}

let contextoDeAudio: AudioContext | null = null

/**
 * Criado (ou retomado) no toque em "conversar". Fora de um gesto, o navegador pode deixar o
 * contexto de áudio suspenso, e o primeiro tom sairia mudo.
 */
function prepararAudio() {
  try {
    contextoDeAudio ??= new AudioContext()
    void contextoDeAudio.resume().catch(() => undefined)
  } catch { /* sem Web Audio, segue sem tom */ }
}

/** Tons curtos gerados na hora: nada para baixar, nada para tocar fora do ciclo. */
function tocarTom(qual: 'ouvi' | 'saida' | 'pulso') {
  try {
    contextoDeAudio ??= new AudioContext()
    const ctx = contextoDeAudio
    const notas: Array<[freq: number, inicio: number, dur: number, vol: number]> =
      qual === 'ouvi' ? [[880, 0, 0.12, 0.15]]
        : qual === 'pulso' ? [[440, 0, 0.06, 0.05]]
          : [[660, 0, 0.15, 0.15], [440, 0.18, 0.22, 0.15]]
    for (const [freq, inicio, dur, vol] of notas) {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      osc.frequency.value = freq
      ganho.gain.setValueAtTime(vol, ctx.currentTime + inicio)
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + dur)
      osc.connect(ganho).connect(ctx.destination)
      osc.start(ctx.currentTime + inicio)
      osc.stop(ctx.currentTime + inicio + dur)
    }
  } catch { /* sem Web Audio, segue sem tom */ }
}

export interface ModoConversa {
  fase: FaseDaConversa
  ligada: boolean
  ligar: () => void
  desligar: () => void
  /** Toque na faixa: durante a fala, interrompe e volta a ouvir. */
  tocar: () => void
  /** O turno enviado pelo modo conversa terminou: `null` quando falhou. */
  receberResposta: (texto: string | null) => void
  /** Volume do microfone agora (RMS 0..1), para a faixa mostrar que está ouvindo. */
  nivel: number
}

export function useModoConversa(
  enviar: (texto: string) => Promise<boolean>,
  projectId: string | null,
): ModoConversa {
  const [fase, setFase] = useState<FaseDaConversa>('desligada')
  const estadoRef = useRef<EstadoDaConversa>(CONVERSA_DESLIGADA)
  const falaRef = useRef<Fala | null>(null)
  const telaRef = useRef<WakeLockSentinel | null>(null)
  const pendentesAntesRef = useRef<Promise<number> | null>(null)
  const enviarRef = useRef(enviar)
  const projetoRef = useRef(projectId)
  const despacharRef = useRef<(e: EventoDaConversa) => void>(() => undefined)
  const ultimaMedidaRef = useRef<MedidaDaEscuta | null>(null)

  const voz = useVoiceInput(
    (texto) => despacharRef.current({ tipo: 'transcrito', texto }),
    {
      autoPararNoSilencio: true,
      descartarSemFala: true,
      aoFecharComFala: () => despacharRef.current({ tipo: 'falaFechada' }),
      aoDescartarSemFala: (medida) => {
        ultimaMedidaRef.current = medida
        despacharRef.current({ tipo: 'semFala' })
      },
      aoFalharTranscricao: () => despacharRef.current({ tipo: 'semFala' }),
      aoFalharMicrofone: () => despacharRef.current({ tipo: 'erroDoMicrofone' }),
    },
  )
  const vozRef = useRef(voz)

  const executar = useCallback((efeito: EfeitoDaConversa) => {
    switch (efeito.tipo) {
      case 'abrirMicrofone':
        void vozRef.current.start()
        return
      case 'fecharMicrofone':
        vozRef.current.cancelar()
        return
      case 'tom':
        tocarTom(efeito.qual)
        return
      case 'enviar': {
        // A contagem roda em paralelo: o turno leva segundos, ela termina antes de qualquer cartão.
        pendentesAntesRef.current = contarPendentes(projetoRef.current)
        void enviarRef.current(efeito.texto).then((enviado) => {
          if (!enviado) despacharRef.current({ tipo: 'respostaFalhou' })
        })
        return
      }
      case 'falar': {
        falaRef.current?.parar()
        const fala = falarEmPedacos(efeito.texto)
        falaRef.current = fala
        void fala.terminou.then(() => {
          if (falaRef.current !== fala) return
          falaRef.current = null
          despacharRef.current({ tipo: 'falaTerminou', agora: Date.now() })
        })
        return
      }
      case 'pararFala':
        falaRef.current?.parar()
        falaRef.current = null
        return
      case 'telaAcesa':
        if (efeito.ligar) {
          // Sem a tela acesa, o celular bloqueia e o navegador fecha o microfone.
          void navigator.wakeLock?.request('screen')
            .then((s) => { telaRef.current = s })
            .catch(() => undefined)
        } else {
          void telaRef.current?.release().catch(() => undefined)
          telaRef.current = null
        }
        return
    }
  }, [])

  const despachar = useCallback((evento: EventoDaConversa) => {
    const { estado, efeitos } = passoDaConversa(estadoRef.current, evento)
    const saiu = estadoRef.current.fase !== 'desligada' && estado.fase === 'desligada'
    estadoRef.current = estado
    setFase(estado.fase)
    for (const efeito of efeitos) executar(efeito)
    if (saiu && estado.motivoDaSaida) {
      let mensagem = MENSAGEM_DA_SAIDA[estado.motivoDaSaida]
      // Sem fala reconhecida, os números dizem por quê: volume que nunca chegou ao limiar, ou um
      // contexto de áudio suspenso lendo zero (23/11, o primeiro uso no computador).
      const m = ultimaMedidaRef.current
      if (estado.motivoDaSaida === 'silencio' && m) {
        mensagem += ` Volume máximo ${m.pico.toFixed(3)}, limiar ${m.limiarFala.toFixed(3)}, ruído ${m.piso.toFixed(3)}, áudio ${m.contexto}.`
      }
      if (mensagem && estado.motivoDaSaida === 'silencio' && m) toast.error(mensagem)
      else if (mensagem) toast.info(mensagem)
    }
  }, [executar])

  // Os efeitos rodam fora da renderização e leem sempre a versão mais nova destes.
  useEffect(() => {
    enviarRef.current = enviar
    projetoRef.current = projectId
    vozRef.current = voz
    despacharRef.current = despachar
  })

  const receberResposta = useCallback((texto: string | null) => {
    if (estadoRef.current.fase !== 'pensando') return
    if (texto === null || !texto.trim()) { despachar({ tipo: 'respostaFalhou' }); return }
    const antes = pendentesAntesRef.current ?? Promise.resolve(0)
    void Promise.all([antes, contarPendentes(projetoRef.current)]).then(([a, d]) => {
      despacharRef.current({ tipo: 'resposta', texto, cartoesNovos: Math.max(0, d - a) })
    })
  }, [despachar])

  // Pulso enquanto pensa.
  useEffect(() => {
    if (fase !== 'pensando') return
    const t = window.setInterval(() => tocarTom('pulso'), PULSO_MS)
    return () => window.clearInterval(t)
  }, [fase])

  // Tela apagada ou aba trocada: o microfone fecharia de qualquer jeito; sair explicitamente.
  const ligada = fase !== 'desligada'
  useEffect(() => {
    if (!ligada) return
    const aoMudar = () => { if (document.visibilityState === 'hidden') despacharRef.current({ tipo: 'telaOculta' }) }
    document.addEventListener('visibilitychange', aoMudar)
    return () => document.removeEventListener('visibilitychange', aoMudar)
  }, [ligada])

  // Trocar de projeto no meio da conversa: o fio muda, a conversa acaba.
  useEffect(() => () => { despacharRef.current({ tipo: 'desligar' }) }, [projectId])

  return {
    fase,
    ligada,
    ligar: useCallback(() => { prepararAudio(); despachar({ tipo: 'ligar', agora: Date.now() }) }, [despachar]),
    desligar: useCallback(() => despachar({ tipo: 'desligar' }), [despachar]),
    tocar: useCallback(() => despachar({ tipo: 'toque' }), [despachar]),
    receberResposta,
    nivel: voz.nivel,
  }
}
