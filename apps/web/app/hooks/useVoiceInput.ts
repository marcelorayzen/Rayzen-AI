'use client'

import { useState, useRef, useCallback } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { AMOSTRA_MS, PISO_MIN_FALA, amostrar, novoDetector } from './detectorDeFala'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

export interface OpcoesDeVoz {
  /**
   * Para de gravar sozinho quando a pessoa cala. Desligado por padrão: quem usa o botão de
   * push-to-talk do work-panel decide quando parar, e mudar isso por baixo seria alterar o
   * comportamento de um chamador que não pediu nada.
   */
  autoPararNoSilencio?: boolean
  /**
   * HC7b: com a auto-parada, um microfone que fechou sem nunca ter ouvido fala é jogado fora sem
   * ir à transcrição. O Whisper inventa frases em áudio mudo ("Obrigado.", "Legendas pela
   * comunidade…"), e no modo conversa a transcrição vai ao Hub sem revisão.
   */
  descartarSemFala?: boolean
  /** Chamado quando a gravação fecha e vai ser transcrita (o modo conversa toca o tom "ouvi"). */
  aoFecharComFala?: () => void
  /**
   * Chamado quando a gravação foi descartada por não ter fala (só com `descartarSemFala`). Recebe o
   * que o detector mediu, para quem usa poder mostrar por que a fala não foi reconhecida.
   */
  aoDescartarSemFala?: (medida: MedidaDaEscuta) => void
  /** O microfone não abriu (permissão, aparelho sem microfone, ocupado). */
  aoFalharMicrofone?: () => void
  /** A transcrição falhou; o áudio se perdeu. */
  aoFalharTranscricao?: () => void
}

/** O que o detector de fala mediu numa escuta. Volumes em RMS normalizado (0..1). */
export interface MedidaDaEscuta {
  piso: number
  pico: number
  limiarFala: number
  /** Estado do AudioContext quando a medição começou ("suspended" lê silêncio absoluto). */
  contexto: string
}

interface UseVoiceInputReturn {
  state: VoiceState
  start: () => Promise<void>
  stop: () => void
  /** Fecha o microfone sem transcrever o que foi gravado. */
  cancelar: () => void
  error: string | null
  /** Volume normalizado (0..1) do último quadro — para a UI mostrar que está mesmo ouvindo. */
  nivel: number
}

// Limiares, calibração e tempos da auto-parada: `detectorDeFala.ts`.

/**
 * ── Por que a causa precisa aparecer inteira ────────────────────────────────
 *
 * Isto era um `catch` só, que dizia **"Acesso ao microfone negado"** para qualquer falha.
 *
 * Medido em 19/09 numa máquina real: o console trazia `NotFoundError: Requested device not found`
 * — ou seja, **não há microfone**, e não "a permissão foi recusada". A mensagem mandava procurar
 * uma configuração de privacidade que não era o problema, e foi exatamente para lá que a
 * investigação foi.
 *
 * É a família de defeito que esta casa persegue desde `fontes-de-contexto.ts`: colapsar causas
 * distintas numa só não deixa o erro menor, deixa a pessoa procurando no lugar errado. O nome da
 * `DOMException` já traz a verdade; bastava não jogá-la fora.
 *
 * O `default` inclui o nome cru de propósito — causa desconhecida é para ser relatada, não
 * traduzida para o palpite mais provável.
 */
export function motivoDoMicrofone(err: unknown): string {
  const nome = (err as { name?: string } | null)?.name ?? ''
  switch (nome) {
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhum microfone encontrado neste dispositivo — não é permissão; não há entrada de áudio.'
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Acesso ao microfone negado. Libere o microfone para este site e tente de novo.'
    case 'NotReadableError':
      return 'O microfone existe, mas está ocupado por outro programa.'
    case 'AbortError':
      return 'A captura de áudio foi interrompida antes de começar.'
    default:
      return `Não consegui abrir o microfone${nome ? ` (${nome})` : ''}.`
  }
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  opcoes: OpcoesDeVoz = {},
): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [nivel, setNivel] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pararMonitorRef = useRef<(() => void) | null>(null)
  const houveFalaRef = useRef(false)
  const medidaRef = useRef<MedidaDaEscuta>({ piso: 0, pico: 0, limiarFala: 0, contexto: 'nenhum' })
  const canceladoRef = useRef(false)
  const opcoesRef = useRef(opcoes)
  opcoesRef.current = opcoes

  const stop = useCallback(() => {
    recorderRef.current?.stop()
  }, [])

  const cancelar = useCallback(() => {
    const r = recorderRef.current
    if (!r || r.state === 'inactive') return
    canceladoRef.current = true
    r.stop()
  }, [])

  /**
   * Observa o volume e decide quando parar. Devolve a função de desligar o próprio monitor —
   * `AudioContext` e `setInterval` vazam se ninguém os fechar, e num app de voz o ciclo
   * ouvir → responder → ouvir repete isso a cada turno.
   */
  const monitorarSilencio = useCallback((stream: MediaStream, pararGravacao: () => void) => {
    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch {
      return () => undefined   // sem Web Audio, segue sem auto-parada — degradação, não erro
    }

    // HC7b, 23/11: no modo conversa o microfone abre DEPOIS de esperar a permissão, fora do clique, e
    // o navegador pode criar o contexto suspenso. Suspenso, o analisador lê silêncio absoluto e a
    // fala nunca é reconhecida. Pedir para retomar não custa nada quando ele já está rodando.
    const contextoNoInicio = ctx.state
    void ctx.resume().catch(() => undefined)

    const fonte = ctx.createMediaStreamSource(stream)
    const analisador = ctx.createAnalyser()
    analisador.fftSize = 2048
    fonte.connect(analisador)

    // Em ponto flutuante: a leitura em bytes anda em degraus de 1/128 (0,0078), grossos perto do
    // limiar mínimo de fala (0,020) num microfone de mesa baixo.
    const quadro = new Float32Array(analisador.fftSize)
    let detector = novoDetector(Date.now())
    medidaRef.current = { piso: 0, pico: 0, limiarFala: PISO_MIN_FALA, contexto: contextoNoInicio }

    const tick = () => {
      analisador.getFloatTimeDomainData(quadro)

      let soma = 0
      for (let i = 0; i < quadro.length; i++) soma += quadro[i] * quadro[i]
      const rms = Math.sqrt(soma / quadro.length)
      setNivel(rms)

      const passo = amostrar(detector, rms, Date.now())
      detector = passo.estado
      medidaRef.current = { ...passo.medida, contexto: contextoNoInicio }
      if (detector.falou) houveFalaRef.current = true
      // Um tick depois do outro até o `onstop` desligar o monitor: parar duas vezes um
      // MediaRecorder já parado lança erro.
      if (passo.parar) { clearInterval(timer); pararGravacao() }
    }

    const timer = setInterval(tick, AMOSTRA_MS)
    return () => {
      clearInterval(timer)
      setNivel(0)
      void ctx.close().catch(() => undefined)
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    chunksRef.current = []
    houveFalaRef.current = false
    canceladoRef.current = false

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador não expõe o microfone aqui — captura de áudio exige HTTPS.')
      setState('error')
      opcoesRef.current.aoFalharMicrofone?.()
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      setError(motivoDoMicrofone(err))
      setState('error')
      opcoesRef.current.aoFalharMicrofone?.()
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      pararMonitorRef.current?.()
      pararMonitorRef.current = null
      stream.getTracks().forEach((t) => t.stop())
      if (recorderRef.current === recorder) recorderRef.current = null

      if (canceladoRef.current) { setState('idle'); return }
      const op = opcoesRef.current
      if (op.autoPararNoSilencio && op.descartarSemFala && !houveFalaRef.current) {
        setState('idle')
        op.aoDescartarSemFala?.(medidaRef.current)
        return
      }
      op.aoFecharComFala?.()
      setState('transcribing')

      const blob = new Blob(chunksRef.current, { type: mimeType })
      const form = new FormData()
      form.append('file', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`)

      try {
        const res = await fetch(`${API_URL}/voice/transcribe`, {
          method: 'POST',
          headers: authHeaders(),
          body: form,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { text: string }
        onTranscript(data.text)
        setState('idle')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro na transcrição')
        setState('error')
        opcoesRef.current.aoFalharTranscricao?.()
      }
    }

    recorder.start()
    setState('recording')

    if (opcoes.autoPararNoSilencio) {
      pararMonitorRef.current = monitorarSilencio(stream, () => recorder.stop())
    }
  }, [onTranscript, opcoes.autoPararNoSilencio, monitorarSilencio])

  return { state, start, stop, cancelar, error, nivel }
}
