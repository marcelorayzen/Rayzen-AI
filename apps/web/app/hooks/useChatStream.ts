'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from '../components/toast'
import { useVoiceInput } from './useVoiceInput'
import { falarEmPedacos, type Fala } from './falarEmPedacos'
import { useModoConversa } from './useModoConversa'

// H3 é opt-in: o shell atual segue no caminho legado até o piloto ser
// habilitado explicitamente. O browser fala apenas com /hub/turns.
const HUB_H3_ENABLED = process.env.NEXT_PUBLIC_HUB_H3 === 'true'
/** HC3: anexos só existem no caminho do Hub (`/hub/turns`); o compositor esconde o clipe fora dele. */
export const ANEXOS_NO_HUB = HUB_H3_ENABLED
/** HC4: disparado quando um turno do Hub termina — quem mostra pendentes no fio recarrega na hora. */
export const EVENTO_TURNO_CONCLUIDO = 'rayzen:hub-turno-concluido'
const avisarTurnoConcluido = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_TURNO_CONCLUIDO)) }

export interface Message {
  role: 'user' | 'assistant'
  content: string
  module?: string
  pendingTurnId?: string
  messageId?: string
  hubTurnId?: string
}

export interface Session {
  sessionId: string
  messages: number
  lastActivity: string
  title: string
}

export type WorkMode = 'implementation' | 'debugging' | 'architecture' | 'study' | 'review'

type PollingTurnoPendente = {
  controller: AbortController
  timer: number | null
}

type EstadoTurno = { status?: string; outputText?: string | null; errorCode?: string | null; code?: string; inputText?: string | null }

// O servidor enfileira até 5 turnos por fio (G1.7), cada um com até ~11 min (timeout do runtime +
// folga). Um prazo menor que a fila cheia daria como perdido um turno que ainda vai responder; o
// servidor sempre leva o turno a completed/failed, então este prazo é só a rede de segurança.
const HUB_TURNO_TIMEOUT_MS = 70 * 60 * 1000
const HUB_TURNO_INTERVALO_MS = 2_000
// Celular troca de antena e a Cloudflare devolve 502 de vez em quando: uma consulta que falha não
// diz nada sobre o turno, que continua no servidor. Só desiste depois de várias seguidas, e mesmo
// aí mantém o turno pendente guardado para a retomada (G1.6).
const HUB_TURNO_FALHAS_TOLERADAS = 5

class ConsultaDoTurnoInterrompida extends Error {}

function chaveTurnoPendente(projectId: string | null) {
  return `rayzen_turno_pendente:${projectId ?? 'geral'}`
}

function inserirTurnoPendente(
  mensagens: Message[],
  turnId: string,
  inputText?: string | null,
  anchorMessageId?: string,
  forcarPerguntaNova = false,
): Message[] {
  const mensagensAtualizadas = [...mensagens]
  let indiceUsuario = mensagensAtualizadas.findIndex((message) =>
    message.role === 'user' && (message.hubTurnId === turnId || (!!anchorMessageId && message.messageId === anchorMessageId)),
  )
  if (indiceUsuario < 0 && inputText && !forcarPerguntaNova) {
    for (let index = mensagensAtualizadas.length - 1; index >= 0; index -= 1) {
      if (mensagensAtualizadas[index].role === 'user' && mensagensAtualizadas[index].content === inputText) {
        indiceUsuario = index
        break
      }
    }
  }
  const indiceBolha = mensagensAtualizadas.findIndex((message) => message.pendingTurnId === turnId)
  if (indiceUsuario >= 0) {
    mensagensAtualizadas[indiceUsuario] = { ...mensagensAtualizadas[indiceUsuario], hubTurnId: turnId }
    if (indiceBolha >= 0) {
      const [bolha] = mensagensAtualizadas.splice(indiceBolha, 1)
      indiceUsuario = mensagensAtualizadas.findIndex((message) => message.role === 'user' && message.hubTurnId === turnId)
      mensagensAtualizadas.splice(indiceUsuario + 1, 0, bolha)
      return mensagensAtualizadas
    }
    mensagensAtualizadas.splice(indiceUsuario + 1, 0, {
      role: 'assistant',
      content: 'Trabalhando…',
      module: 'hub',
      pendingTurnId: turnId,
      messageId: `hub-turn:${turnId}`,
      hubTurnId: turnId,
    })
    return mensagensAtualizadas
  }
  if (indiceBolha >= 0) {
    if (inputText) {
      mensagensAtualizadas.splice(indiceBolha, 0, {
        role: 'user',
        content: inputText,
        messageId: `hub-turn:${turnId}:user`,
        hubTurnId: turnId,
      })
    }
    return mensagensAtualizadas
  }
  if (inputText) {
    mensagensAtualizadas.push({
      role: 'user',
      content: inputText,
      messageId: `hub-turn:${turnId}:user`,
      hubTurnId: turnId,
    })
  }
  mensagensAtualizadas.push({
    role: 'assistant',
    content: 'Trabalhando…',
    module: 'hub',
    pendingTurnId: turnId,
    messageId: `hub-turn:${turnId}`,
    hubTurnId: turnId,
  })
  return mensagensAtualizadas
}

function respostaJaNoHistorico(mensagens: Message[], inputText: string | null | undefined, outputText: string) {
  if (!inputText) return false
  return mensagens.some((message, index) =>
    message.role === 'assistant' &&
    message.content === outputText &&
    mensagens[index - 1]?.role === 'user' &&
    mensagens[index - 1].content === inputText,
  )
}

function lerTurnosPendentes(key: string): string[] {
  try {
    const salvo = localStorage.getItem(key)
    if (!salvo) return []
    try {
      const parsed: unknown = JSON.parse(salvo)
      if (typeof parsed === 'string') return [parsed]
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return [salvo]
    }
  } catch {
    return []
  }
}

function guardarTurnoPendente(key: string, turnId: string) {
  try {
    const turnos = lerTurnosPendentes(key)
    if (!turnos.includes(turnId)) localStorage.setItem(key, JSON.stringify([...turnos, turnId]))
  } catch { /* armazenamento indisponível */ }
}

function apagarTurnoPendente(key: string, turnId: string) {
  try {
    const turnos = lerTurnosPendentes(key).filter((id) => id !== turnId)
    if (turnos.length) localStorage.setItem(key, JSON.stringify(turnos))
    else localStorage.removeItem(key)
  } catch { /* armazenamento indisponível */ }
}

function esperarIntervalo(signal: AbortSignal, polling: PollingTurnoPendente) {
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      if (polling.timer !== null) window.clearTimeout(polling.timer)
      polling.timer = null
      resolve(false)
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      polling.timer = null
      resolve(true)
    }, HUB_TURNO_INTERVALO_MS)
    polling.timer = timer
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function consultarTurno(
  turnId: string,
  signal: AbortSignal,
  polling: PollingTurnoPendente,
  aoAceitar?: (estado: EstadoTurno) => void,
): Promise<EstadoTurno | null> {
  const inicio = Date.now()
  let falhasSeguidas = 0
  while (!signal.aborted && Date.now() - inicio < HUB_TURNO_TIMEOUT_MS) {
    let response: Response | null = null
    try {
      response = await fetch(`${API_URL}/hub/turns/${encodeURIComponent(turnId)}`, {
        headers: authHeaders(),
        signal,
      })
    } catch {
      if (signal.aborted) return null
    }
    if (!response || response.status >= 500) {
      falhasSeguidas += 1
      if (falhasSeguidas >= HUB_TURNO_FALHAS_TOLERADAS) {
        throw new ConsultaDoTurnoInterrompida(response ? `HTTP ${response.status}` : 'sem conexão')
      }
      if (!await esperarIntervalo(signal, polling)) return null
      continue
    }
    falhasSeguidas = 0
    const estado = await response.json().catch(() => null) as EstadoTurno | null
    if (signal.aborted) return null
    if (!response.ok) throw new Error(estado?.errorCode ?? estado?.code ?? `HTTP ${response.status}`)
    if (estado?.status === 'accepted' || estado?.status === 'completed' || estado?.status === 'failed') {
      aoAceitar?.(estado)
    }
    if (estado?.status === 'completed' || estado?.status === 'failed') return estado
    if (estado?.status !== 'accepted') throw new Error('hub_turn_invalid_status')
    if (!await esperarIntervalo(signal, polling)) return null
  }
  return null
}

function createSessionId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useChatStream(activeProjectId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [sessionTokens, setSessionTokens] = useState(0)
  const [dailyTokens, setDailyTokens] = useState<number | null>(null)
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [autoVoice, setAutoVoice] = useState(false)
  const [workMode, setWorkMode] = useState<WorkMode | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)

  const falaRef = useRef<Fala | null>(null)
  const autoVoiceRef = useRef(false)
  const mensagensRef = useRef<Message[]>(messages)
  mensagensRef.current = messages
  // "+ Nova conversa" pede ao servidor uma sessão NOVA do Hermes no próximo turno do Hub. Sem
  // isso o botão trocava só o fio da web e o Hermes seguia na sessão antiga — com a lista de
  // ferramentas congelada de quando ela começou (13/11).
  const novaConversaHubRef = useRef(false)
  const pollingTurnoRef = useRef(new Map<string, PollingTurnoPendente>())
  const escopoAtualRef = useRef(activeProjectId)
  const playAudioRef = useRef<((text: string, index: number, force?: boolean) => Promise<void>) | null>(null)
  // HC7b: o modo conversa recebe toda resposta de turno (ele mesmo ignora a que não esperava) e,
  // enquanto está ligado, é ele quem fala: o "voz on" fica calado para a resposta não sair duas vezes.
  const respostaDaConversaRef = useRef<((texto: string | null) => void) | null>(null)
  const conversaAtivaRef = useRef(false)
  const tokenQueueRef = useRef<string[]>([])
  const drainActiveRef = useRef(false)
  const shouldAutoScrollRef = useRef(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  const acompanharTurno = useCallback((
    turnId: string,
    storageKey: string,
    estaVivo: () => boolean,
    anchorMessageId?: string,
  ) => {
    if (pollingTurnoRef.current.has(turnId)) return
    const polling: PollingTurnoPendente = { controller: new AbortController(), timer: null }
    pollingTurnoRef.current.set(turnId, polling)
    let deadlineReached = false
    const deadline = window.setTimeout(() => {
      deadlineReached = true
      polling.controller.abort()
    }, HUB_TURNO_TIMEOUT_MS)

    void (async () => {
      try {
        const status = await consultarTurno(
          turnId,
          polling.controller.signal,
          polling,
          (estado) => {
            if (estaVivo()) {
              setMessages((prev) => inserirTurnoPendente(
                prev, turnId, estado.inputText, anchorMessageId, estado.status === 'accepted',
              ))
            }
          },
        )
        if (!estaVivo()) return
        if (!status) {
          if (deadlineReached) {
            apagarTurnoPendente(storageKey, turnId)
            setMessages((prev) => prev.map((message) => message.pendingTurnId === turnId
              ? { ...message, content: 'O turno não terminou após 70 minutos. Tente consultar o histórico antes de reenviar.', pendingTurnId: undefined }
              : message))
          }
          return
        }
        apagarTurnoPendente(storageKey, turnId)
        avisarTurnoConcluido()
        if (status.status === 'completed' && status.outputText) {
          const output = status.outputText
          respostaDaConversaRef.current?.(output)
          const visivelNoHistorico = !anchorMessageId &&
            respostaJaNoHistorico(mensagensRef.current, status.inputText, output)
          setMessages((prev) => {
            const indicePendente = prev.findIndex((message) => message.pendingTurnId === turnId)
            if (visivelNoHistorico) return prev.filter((message) => message.pendingTurnId !== turnId)
            if (indicePendente >= 0) {
              return prev.map((message) => message.pendingTurnId === turnId
                ? { ...message, content: output, pendingTurnId: undefined, module: 'hub' }
                : message)
            }
            return inserirTurnoPendente(prev, turnId, status.inputText, anchorMessageId)
              .map((message) => message.pendingTurnId === turnId
                ? { ...message, content: output, pendingTurnId: undefined, module: 'hub' }
                : message)
          })
          if (!visivelNoHistorico && autoVoiceRef.current && !conversaAtivaRef.current) {
            window.setTimeout(() => {
              const indice = mensagensRef.current.findIndex((message) => message.hubTurnId === turnId)
              if (indice >= 0) void playAudioRef.current?.(output, indice, true)
            }, 250)
          }
          return
        }
        if (status.status === 'failed') {
          respostaDaConversaRef.current?.(null)
          setMessages((prev) => prev.map((message) => message.pendingTurnId === turnId
            ? { ...message, content: `Erro no turno Hub: ${status.errorCode ?? 'hub_turn_failed'}`, pendingTurnId: undefined }
            : message))
          return
        }
        throw new Error(status.errorCode ?? 'hub_turn_invalid_status')
      } catch (error) {
        respostaDaConversaRef.current?.(null)
        if (!estaVivo()) return
        if (error instanceof ConsultaDoTurnoInterrompida) {
          setMessages((prev) => prev.map((message) => message.pendingTurnId === turnId
            ? { ...message, content: `Perdi contato com o servidor (${error.message}). O turno continua lá; recarregue a página para ver a resposta.`, pendingTurnId: undefined }
            : message))
          return
        }
        if (!polling.controller.signal.aborted || deadlineReached) {
          apagarTurnoPendente(storageKey, turnId)
          setMessages((prev) => prev.map((message) => message.pendingTurnId === turnId
            ? {
                ...message,
                content: deadlineReached
                  ? 'O turno não terminou após 70 minutos. Tente consultar o histórico antes de reenviar.'
                  : `Falha ao consultar o turno Hub: ${error instanceof Error ? error.message : 'erro desconhecido'}`,
                pendingTurnId: undefined,
              }
            : message))
        }
      } finally {
        window.clearTimeout(deadline)
        if (polling.timer !== null) window.clearTimeout(polling.timer)
        if (pollingTurnoRef.current.get(turnId) === polling) pollingTurnoRef.current.delete(turnId)
      }
    })()
  }, [])

  // A transcrição só preenche o compositor. Enviar continua explícito para a
  // pessoa poder revisar ou corrigir o que o STT ouviu.
  const inserirTranscricao = useCallback((text: string) => {
    if (!text.trim()) return
    setInput((prev) => prev ? `${prev} ${text}` : text)
  }, [])
  const {
    state: voiceState,
    start: startVoice,
    stop: stopVoice,
    error: voiceError,
  } = useVoiceInput(inserirTranscricao)
  const recording = voiceState === 'recording'
  const transcribing = voiceState === 'transcribing'

  useEffect(() => {
    fetch(`${API_URL}/sessions/tokens`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setDailyTokens((d as { last24h?: { tokens?: number } }).last24h?.tokens ?? 0))
      .catch(() => null)
  }, [])

  useEffect(() => {
    try {
      if (localStorage.getItem('rayzen_auto_voice') === 'true') {
        setAutoVoice(true)
        autoVoiceRef.current = true
      }
    } catch { /* armazenamento indisponível */ }
  }, [])

  useEffect(() => {
    autoVoiceRef.current = autoVoice
    try { localStorage.setItem('rayzen_auto_voice', autoVoice ? 'true' : 'false') } catch { /* armazenamento indisponível */ }
  }, [autoVoice])

  const drainQueue = useCallback(() => {
    if (drainActiveRef.current) return
    drainActiveRef.current = true
    const tick = () => {
      const token = tokenQueueRef.current.shift()
      if (token === undefined) { drainActiveRef.current = false; return }
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = { ...last, content: last.content + token }
        return updated
      })
      setTimeout(tick, 18)
    }
    tick()
  }, [])

  const playAudio = useCallback(async (text: string, index: number, force = false) => {
    if (!force && playingIndex === index) {
      falaRef.current?.parar()
      falaRef.current = null
      setPlayingIndex(null)
      return
    }
    if (!text.trim()) return
    // HC7a: em pedaços, com a voz do aparelho como reserva (a limpeza é do servidor).
    falaRef.current?.parar()
    setPlayingIndex(index)
    const fala = falarEmPedacos(text)
    falaRef.current = fala
    await fala.terminou
    if (falaRef.current === fala) {
      falaRef.current = null
      setPlayingIndex(null)
    }
  }, [playingIndex])

  useEffect(() => {
    playAudioRef.current = playAudio
  }, [playAudio])

  // Carrega o fio antes de retomar o turno; assim a resposta persistida pelo Hermes
  // pode ser comparada com o resultado e não aparece duas vezes na conversa.
  useEffect(() => {
    let vivo = true
    const pollings = pollingTurnoRef.current
    escopoAtualRef.current = activeProjectId
    setMessages([])
    setSessionTokens(0)
    const storageKey = chaveTurnoPendente(activeProjectId)
    const escopo = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''

    const carregarERetomar = async () => {
      let historico: Message[] = []
      try {
        const response = await fetch(`${API_URL}/sessions/atual${escopo}`, { headers: authHeaders() })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const sessao = await response.json() as { sessionId?: string; retomada?: boolean }
        if (sessao?.sessionId) {
          setSessionId(sessao.sessionId)
          if (sessao.retomada) {
            const historyResponse = await fetch(`${API_URL}/sessions/${encodeURIComponent(sessao.sessionId)}/messages`, { headers: authHeaders() })
            if (!historyResponse.ok) throw new Error(`HTTP ${historyResponse.status}`)
            const data = await historyResponse.json() as Array<{ role: string; content: string; module: string | null }>
              historico = data.map((message, index) => ({
              role: message.role as 'user' | 'assistant',
              content: message.content,
              module: message.module ?? undefined,
                messageId: `history:${sessao.sessionId}:${index}`,
              }))
            }
        } else {
          setSessionId(createSessionId())
        }
      } catch {
        if (vivo) setSessionId(createSessionId())
      }

      if (!vivo) return
      setMessages(prev => prev.length ? prev : historico)
      if (!HUB_H3_ENABLED) return
      const turnIds = lerTurnosPendentes(storageKey)
      setMessages((prev) => turnIds.reduce(
        (atual, turnId) => inserirTurnoPendente(atual, turnId),
        prev,
      ))
      for (const turnId of turnIds) {
        acompanharTurno(turnId, storageKey, () => vivo)
      }
    }

    void carregarERetomar()
    return () => {
      vivo = false
      for (const polling of pollings.values()) {
        polling.controller.abort()
        if (polling.timer !== null) window.clearTimeout(polling.timer)
      }
      pollings.clear()
    }
  }, [activeProjectId, acompanharTurno])

  /** `anexos`: ids já enviados a `/hub/anexos` (HC3) e os nomes, para a mensagem mostrar o que foi junto. */
  /** Devolve `false` quando nada foi enviado (texto vazio ou um envio em curso). */
  const sendMessage = useCallback(async (
    userMessage: string,
    anexos?: { ids: string[]; nomes: string[] },
    // HC7c: o turno veio do modo conversa; a api pede ao Hermes resposta curta, para ser falada.
    opcoes?: { porVoz?: boolean },
  ): Promise<boolean> => {
    const temAnexo = Boolean(anexos?.ids.length) && HUB_H3_ENABLED
    if ((!userMessage.trim() && !temAnexo) || loading) return false
    const escopoDaRequisicao = activeProjectId
    const messageId = createSessionId()
    shouldAutoScrollRef.current = true
    setInput('')
    const textoVisivel = temAnexo ? `${userMessage}${userMessage.trim() ? '\n' : ''}📎 ${anexos!.nomes.join(', ')}` : userMessage
    setMessages(prev => [...prev, { role: 'user', content: textoVisivel, messageId }])
    setLoading(true)
    try {
      if (HUB_H3_ENABLED) {
        const idempotencyKey = createSessionId()
        const projectQuery = activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : ''
        const storageKey = chaveTurnoPendente(activeProjectId)

        // H4a: uma conversa de projeto só alcança Hermes depois de emitir uma
        // leitura ContextPack para este humano. O browser encaminha somente o
        // identificador; o Hub volta a buscar o snapshot com o mesmo JWT e
        // persiste o id/hash no turno. Não há captura nem promoção aqui.
        let contextPackId: string | undefined
        if (activeProjectId) {
          const packResponse = await fetch(`${V2_URL}/context/packs`, {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              scopeType: 'project',
              projectId: activeProjectId,
              consumer: 'hermes',
              sessionId: sessionId || idempotencyKey,
              purpose: 'hub_turn_context',
              // Só o print, sem texto: a busca de contexto não pode ir vazia.
              query: userMessage.trim() || 'conteúdo anexado pela pessoa',
              ...(workMode ? { mode: workMode } : {}),
            }),
          })
          const pack = await packResponse.json().catch(() => null) as { id?: string; message?: string } | null
          if (!packResponse.ok || !pack?.id) {
            throw new Error(pack?.message ?? `context_pack_issue_failed_${packResponse.status}`)
          }
          contextPackId = pack.id
        }

        const res = await fetch(`${API_URL}/hub/turns${projectQuery}`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
          body: JSON.stringify({
            text: userMessage,
            modo: 'async',
            ...(contextPackId ? { contextPackId } : {}),
            ...(novaConversaHubRef.current ? { novaConversa: true } : {}),
            ...(temAnexo ? { anexoIds: anexos!.ids } : {}),
            ...(opcoes?.porVoz ? { porVoz: true } : {}),
          }),
        })
        const payload = await res.json().catch(() => null) as {
          turnId?: string
          outputText?: string | null
          errorCode?: string | null
          code?: string
          status?: string
        } | null
        if (!res.ok) {
          const code = payload?.errorCode ?? payload?.code
          throw new Error(code === 'hub_turn_queue_full'
            ? 'Já há 5 pedidos na fila; espere um terminar'
            : code ?? `HTTP ${res.status}`)
        }
        // Só depois de o servidor aceitar: se o turno falhou, a próxima tentativa ainda pede sessão
        // nova (renovar duas vezes é inofensivo; não renovar é o defeito).
        novaConversaHubRef.current = false
        if (res.status === 202 && payload?.status === 'accepted' && payload.turnId) {
          const turnId = payload.turnId
          guardarTurnoPendente(storageKey, turnId)
          if (escopoAtualRef.current !== escopoDaRequisicao) return true
          setMessages((prev) => inserirTurnoPendente(prev, turnId, textoVisivel, messageId))
          acompanharTurno(
            turnId,
            storageKey,
            () => escopoAtualRef.current === escopoDaRequisicao,
            messageId,
          )
          return true
        }
        if (payload?.status !== 'completed' || !payload.outputText) throw new Error(payload?.errorCode ?? 'hub_turn_incomplete')
        avisarTurnoConcluido()
        respostaDaConversaRef.current?.(payload.outputText)
        if (escopoAtualRef.current === escopoDaRequisicao) {
          setMessages((prev) => {
            const indiceUsuario = prev.findIndex((message) => message.messageId === messageId)
            const resposta: Message = { role: 'assistant', content: payload.outputText!, module: 'hub', messageId: `hub-turn:${payload.turnId ?? messageId}` }
            if (indiceUsuario < 0) return [...prev, resposta]
            const atualizada = [...prev]
            atualizada.splice(indiceUsuario + 1, 0, resposta)
            return atualizada
          })
          if (autoVoiceRef.current && !conversaAtivaRef.current) setTimeout(() => void playAudio(payload.outputText!, messages.length + 1, true), 250)
        }
        return true
      }

      const res = await fetch(`${API_URL}/orchestrate/stream`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: userMessage, sessionId, ...(activeProjectId ? { projectId: activeProjectId } : {}), ...(workMode ? { workMode } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let currentModule = ''
      let buffer = ''
      let assistantText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '', module: '' }])
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (!line.startsWith('data: ')) continue
          let data: Record<string, unknown>
          try { data = JSON.parse(line.slice(6)) as Record<string, unknown> } catch { continue }
          if (typeof data.module === 'string') currentModule = data.module
          if (data.text !== undefined) {
            assistantText += data.text as string
            if (currentModule) {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], module: currentModule }
                return updated
              })
            }
            tokenQueueRef.current.push(data.text as string)
            drainQueue()
          }
          if (typeof data.tokensUsed === 'number' && data.tokensUsed > 0) {
            setSessionTokens(prev => prev + (data.tokensUsed as number))
            setDailyTokens(prev => (prev ?? 0) + (data.tokensUsed as number))
          }
          if (typeof data.message === 'string' && !data.text) {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Erro: ${data.message as string}` }
              return updated
            })
          }
        }
      }
      respostaDaConversaRef.current?.(assistantText.trim() ? assistantText : null)
      if (autoVoiceRef.current && !conversaAtivaRef.current && assistantText.trim()) {
        setTimeout(() => {
          setMessages(prev => {
            const index = prev.length - 1
            const last = prev[index]
            if (last?.role === 'assistant') void playAudio(last.content || assistantText, index, true)
            return prev
          })
        }, 250)
      }
    } catch (err) {
      respostaDaConversaRef.current?.(null)
      const detalhe = err instanceof Error ? err.message : 'desconhecido'
      const errMsg = detalhe.startsWith('Já há 5 pedidos')
        ? detalhe
        : `Erro: ${detalhe}`
      if (escopoAtualRef.current === escopoDaRequisicao) {
        setMessages(prev => {
          if (HUB_H3_ENABLED) {
            const indiceUsuario = prev.findIndex((message) => message.messageId === messageId)
            const resposta: Message = { role: 'assistant', content: errMsg, module: 'hub' }
            if (indiceUsuario < 0) return [...prev, resposta]
            const atualizada = [...prev]
            atualizada.splice(indiceUsuario + 1, 0, resposta)
            return atualizada
          }
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = { ...last, content: errMsg }
            return updated
          }
          return [...prev, { role: 'assistant', content: errMsg }]
        })
      }
    } finally { setLoading(false) }
    return true
  }, [loading, messages, sessionId, activeProjectId, workMode, drainQueue, playAudio, acompanharTurno])

  // HC7b: no modo conversa a transcrição vai direto ao Hub, sem passar pelo compositor. Pode, porque
  // nada com efeito acontece sem toque: o que muda algo vira cartão no fio. A fala fica no fio como
  // mensagem da pessoa, para conferir depois.
  const enviarDaConversa = useCallback((texto: string) => sendMessage(texto, undefined, { porVoz: true }), [sendMessage])
  const conversa = useModoConversa(enviarDaConversa, activeProjectId)
  useEffect(() => {
    respostaDaConversaRef.current = conversa.receberResposta
    conversaAtivaRef.current = conversa.ligada
  }, [conversa.receberResposta, conversa.ligada])

  const toggleRecording = useCallback(async () => {
    if (recording) { stopVoice(); return }
    if (!transcribing) await startVoice()
  }, [recording, transcribing, startVoice, stopVoice])

  useEffect(() => {
    if (!voiceError) return
    toast.error(voiceError)
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `🎙️ ${voiceError}`,
      module: 'system',
    }])
  }, [voiceError])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`, { headers: authHeaders() })
      const data = await res.json()
      setSessions(Array.isArray(data) ? data as Session[] : [])
    } catch { /* silencioso */ }
  }, [])

  const openSidebar = useCallback(() => {
    setSidebarOpen(true)
    loadSessions()
  }, [loadSessions])

  const loadSession = useCallback(async (sid: string) => {
    if (loadingSession) return
    setLoadingSession(sid)
    try {
      const res = await fetch(`${API_URL}/sessions/${sid}/messages`, { headers: authHeaders() })
      const data = await res.json() as Array<{ role: string; content: string; module: string | null }>
      const loaded: Message[] = data.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content, module: m.module ?? undefined }))
      setMessages(loaded)
      setSessionId(sid)
      setSessionTokens(0)
      setSidebarOpen(false)
    } catch { /* silencioso */ }
    finally { setLoadingSession(null) }
  }, [loadingSession])

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deletingSession) return
    setDeletingSession(sid)
    try {
      await fetch(`${API_URL}/sessions/${sid}`, { method: 'DELETE', headers: authHeaders() })
      setSessions(prev => prev.filter(s => s.sessionId !== sid))
      if (sid === sessionId) {
        setMessages([])
        setSessionId(createSessionId())
        setSessionTokens(0)
      }
    } catch { /* silencioso */ }
    finally { setDeletingSession(null) }
  }, [deletingSession, sessionId])

  const newChat = useCallback(() => {
    novaConversaHubRef.current = true
    setMessages([])
    setSessionId(createSessionId())
    setSessionTokens(0)
    setSidebarOpen(false)
  }, [])

  return {
    messages, setMessages,
    input, setInput,
    loading,
    sessionId, setSessionId,
    sessionTokens, setSessionTokens,
    dailyTokens, setDailyTokens,
    playingIndex,
    autoVoice, setAutoVoice,
    recording,
    transcribing,
    workMode, setWorkMode,
    sessions,
    sidebarOpen, setSidebarOpen,
    loadingSession,
    deletingSession,
    bottomRef,
    messagesContainerRef,
    shouldAutoScrollRef,
    drainQueue,
    playAudio,
    sendMessage,
    toggleRecording,
    loadSessions,
    openSidebar,
    loadSession,
    deleteSession,
    newChat,
    conversa,
  }
}
