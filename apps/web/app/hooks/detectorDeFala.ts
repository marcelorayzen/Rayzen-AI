/**
 * Detector de fala da auto-parada do microfone: decide, quadro a quadro, se a pessoa falou e
 * quando calou. Puro e sem import, para ser testado fora do navegador
 * (`apps/api/src/modules/voice/__tests__/detector-de-fala.spec.ts`).
 *
 * ── Por que o limiar é CALIBRADO e não uma constante ────────────────────────
 *
 * Um limiar fixo de "isto é fala" erra nos dois sentidos: no celular perto da rua, o ruído de
 * fundo passa do limiar e a gravação nunca termina; num quarto silencioso com mic distante, a
 * fala fica abaixo dele e a gravação termina no meio da frase.
 *
 * Os limiares saem do piso de ruído. O multiplicador 3x não foi inventado aqui — é o
 * `barge_in_threshold_multiplier` do próprio Hermes, que usa exatamente esta técnica
 * ("quiet-room floor x this"). O piso mínimo existe para o caso de um microfone que devolve
 * silêncio digital absoluto, onde qualquer múltiplo de zero continua zero.
 *
 * ── Por que o piso segue descendo depois da calibração ──────────────────────
 *
 * Até 23/11 o piso era congelado nos primeiros 0,4 s. No primeiro uso do modo conversa, num
 * microfone de mesa, a abertura do microfone mediu ruído **0,076** e a voz chegou a **0,071**: o
 * limiar de fala (0,228) ficou acima da própria voz, e duas escutas seguidas saíram "sem fala". O
 * começo do microfone não é o silêncio da sala (o ganho automático do navegador ainda está se
 * ajustando). Agora o piso é o menor quadro visto **na escuta inteira**: um único quadro quieto
 * basta para o limiar descer ao ruído real.
 */

export const CALIBRAR_MS       = 400
export const MULT_FALA         = 3.0
export const MULT_SILENCIO     = 1.8
export const PISO_MIN_FALA     = 0.020
export const PISO_MIN_SILENCIO = 0.012
export const AMOSTRA_MS        = 100

/**
 * Quanto silêncio encerra a fala. **É escolha, não medição** — não há vale na distribuição de
 * pausas de fala para descobrir, e fingir que 1,5s saiu de um dado seria inventar precisão.
 * O Hermes usa 3,0s no modo de voz dele; 1,5s aqui porque a conversa é de turno curto e esperar
 * três segundos entre falar e ser ouvido faz o app parecer travado.
 */
export const SILENCIO_MS = 1500

/** Teto duro, para o mic nunca ficar aberto indefinidamente. O Hermes usa 120s; o mesmo aqui. */
export const MAX_MS = 120_000

/**
 * Se a pessoa abriu o mic e não falou nada, fechar sozinho. Sem isto, um toque acidental deixa
 * o microfone do celular aberto até o teto de 2 minutos.
 */
export const ESPERA_INICIAL_MS = 8000

export interface EstadoDoDetector {
  inicio: number
  /** Menor quadro visto até agora; `null` enquanto calibra. */
  piso: number | null
  menorDaCalibracao: number
  pico: number
  falou: boolean
  silencioDesde: number | null
}

export interface PassoDoDetector {
  estado: EstadoDoDetector
  parar: boolean
  medida: { piso: number; pico: number; limiarFala: number }
}

export function novoDetector(agora: number): EstadoDoDetector {
  return {
    inicio: agora,
    piso: null,
    menorDaCalibracao: Number.POSITIVE_INFINITY,
    pico: 0,
    falou: false,
    silencioDesde: null,
  }
}

export function amostrar(anterior: EstadoDoDetector, rms: number, agora: number): PassoDoDetector {
  const decorrido = agora - anterior.inicio

  if (decorrido < CALIBRAR_MS) {
    const estado = { ...anterior, menorDaCalibracao: Math.min(anterior.menorDaCalibracao, rms) }
    return { estado, parar: false, medida: { piso: 0, pico: 0, limiarFala: PISO_MIN_FALA } }
  }

  const pisoAntes = anterior.piso ?? (Number.isFinite(anterior.menorDaCalibracao) ? anterior.menorDaCalibracao : rms)
  const piso = Math.min(pisoAntes, rms)
  const limiarFala     = Math.max(piso * MULT_FALA, PISO_MIN_FALA)
  const limiarSilencio = Math.max(piso * MULT_SILENCIO, PISO_MIN_SILENCIO)
  const pico = Math.max(anterior.pico, rms)

  let falou = anterior.falou
  let silencioDesde = anterior.silencioDesde
  let parar = false

  if (rms >= limiarFala) {
    falou = true
    silencioDesde = null
  } else if (rms < limiarSilencio && falou) {
    silencioDesde ??= agora
    if (agora - silencioDesde >= SILENCIO_MS) parar = true
  }

  if (!falou && decorrido >= ESPERA_INICIAL_MS) parar = true
  if (decorrido >= MAX_MS) parar = true

  return {
    estado: { ...anterior, piso, pico, falou, silencioDesde },
    parar,
    medida: { piso, pico, limiarFala },
  }
}
