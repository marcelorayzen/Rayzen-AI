/**
 * ── HC7b: o ciclo do modo conversa ───────────────────────────────────────────
 *
 * ouvindo → (a fala fecha) → transcrevendo → pensando → falando → ouvindo …
 *
 * Isto é só a regra: que evento leva a que fase, e o que precisa acontecer na passagem. Não toca
 * em microfone, áudio nem rede. Quem executa os efeitos é `useModoConversa`. Separado assim para
 * poder ser testado sem navegador. A web não tem suíte; o teste mora em
 * `apps/api/src/modules/voice/__tests__/conversa-ciclo.spec.ts`, e por isso este arquivo não importa nada.
 *
 * Desenho aprovado em `docs/decisions/HC7-voz-continua-desenho.md`. As regras que pesam:
 * - **Envia sem revisão** (pergunta 1): nada com efeito acontece sem toque, porque tudo o que muda
 *   algo vira cartão no fio.
 * - **Não ouve enquanto fala**: o alto-falante do celular vaza para o microfone. Para interromper,
 *   toca-se na tela.
 * - **Fala sem voz não é enviada.** Se o microfone fechou sem ter ouvido fala, o áudio é jogado
 *   fora antes da transcrição: o Whisper inventa frases em áudio mudo ("Obrigado.", "Legendas
 *   pela comunidade…"), e no modo conversa isso iria para o Hub sem ninguém revisar.
 * - **Sai sozinho** em três casos: duas escutas seguidas sem fala, tela apagada ou aba trocada, e
 *   30 minutos de conversa.
 */

export type FaseDaConversa = 'desligada' | 'ouvindo' | 'transcrevendo' | 'pensando' | 'falando'

export type MotivoDaSaida = 'manual' | 'silencio' | 'tela' | 'tempo' | 'microfone'

export interface EstadoDaConversa {
  fase: FaseDaConversa
  iniciadaEm: number | null
  /** Escutas seguidas que fecharam sem fala. Duas desligam o modo. */
  escutasVazias: number
  motivoDaSaida: MotivoDaSaida | null
}

export type EventoDaConversa =
  | { tipo: 'ligar'; agora: number }
  /** O microfone fechou depois de ouvir fala: vai transcrever. */
  | { tipo: 'falaFechada' }
  /** O microfone fechou sem ouvir fala nenhuma (ou a transcrição veio vazia). */
  | { tipo: 'semFala' }
  | { tipo: 'transcrito'; texto: string }
  /** O turno do Hub terminou. `cartoesNovos`: quantos cartões a aprovar surgiram durante o turno. */
  | { tipo: 'resposta'; texto: string; cartoesNovos: number }
  | { tipo: 'respostaFalhou' }
  | { tipo: 'falaTerminou'; agora: number }
  /** Toque na faixa do modo conversa: interrompe a fala e volta a ouvir. */
  | { tipo: 'toque' }
  | { tipo: 'telaOculta' }
  | { tipo: 'desligar' }
  | { tipo: 'erroDoMicrofone' }

export type EfeitoDaConversa =
  | { tipo: 'abrirMicrofone' }
  | { tipo: 'fecharMicrofone' }
  | { tipo: 'tom'; qual: 'ouvi' | 'saida' }
  | { tipo: 'enviar'; texto: string }
  | { tipo: 'falar'; texto: string }
  | { tipo: 'pararFala' }
  | { tipo: 'telaAcesa'; ligar: boolean }

export const ESCUTAS_VAZIAS_PARA_SAIR = 2
export const DURACAO_MAXIMA_MS = 30 * 60 * 1000

export const AVISO_DE_CARTAO = 'Deixei um cartão para você aprovar na tela.'
export const AVISO_DE_FALHA = 'Não consegui responder agora. Pode repetir?'

export const CONVERSA_DESLIGADA: EstadoDaConversa = {
  fase: 'desligada', iniciadaEm: null, escutasVazias: 0, motivoDaSaida: null,
}

export interface Passagem {
  estado: EstadoDaConversa
  efeitos: EfeitoDaConversa[]
}

function sair(motivo: MotivoDaSaida): Passagem {
  const efeitos: EfeitoDaConversa[] = [
    { tipo: 'pararFala' },
    { tipo: 'fecharMicrofone' },
    { tipo: 'telaAcesa', ligar: false },
  ]
  // Quem tocou em "sair" já sabe que saiu; o tom é para a saída que a pessoa não pediu.
  if (motivo !== 'manual') efeitos.push({ tipo: 'tom', qual: 'saida' })
  return { estado: { ...CONVERSA_DESLIGADA, motivoDaSaida: motivo }, efeitos }
}

function voltarAOuvir(estado: EstadoDaConversa, extra: EfeitoDaConversa[] = []): Passagem {
  return { estado: { ...estado, fase: 'ouvindo' }, efeitos: [...extra, { tipo: 'abrirMicrofone' }] }
}

function escutaVazia(estado: EstadoDaConversa): Passagem {
  const escutasVazias = estado.escutasVazias + 1
  if (escutasVazias >= ESCUTAS_VAZIAS_PARA_SAIR) return sair('silencio')
  return voltarAOuvir({ ...estado, escutasVazias })
}

const parado = (estado: EstadoDaConversa): Passagem => ({ estado, efeitos: [] })

export function passoDaConversa(estado: EstadoDaConversa, evento: EventoDaConversa): Passagem {
  const { fase } = estado

  // Estas valem em qualquer fase ligada.
  if (fase !== 'desligada') {
    if (evento.tipo === 'desligar') return sair('manual')
    if (evento.tipo === 'telaOculta') return sair('tela')
    if (evento.tipo === 'erroDoMicrofone') return sair('microfone')
  }

  switch (evento.tipo) {
    case 'ligar':
      if (fase !== 'desligada') return parado(estado)
      return {
        estado: { fase: 'ouvindo', iniciadaEm: evento.agora, escutasVazias: 0, motivoDaSaida: null },
        efeitos: [{ tipo: 'telaAcesa', ligar: true }, { tipo: 'abrirMicrofone' }],
      }

    case 'falaFechada':
      if (fase !== 'ouvindo') return parado(estado)
      return { estado: { ...estado, fase: 'transcrevendo' }, efeitos: [{ tipo: 'tom', qual: 'ouvi' }] }

    case 'semFala':
      if (fase !== 'ouvindo' && fase !== 'transcrevendo') return parado(estado)
      return escutaVazia(estado)

    case 'transcrito': {
      if (fase !== 'transcrevendo') return parado(estado)
      const texto = evento.texto.trim()
      if (!texto) return escutaVazia(estado)
      return {
        estado: { ...estado, fase: 'pensando', escutasVazias: 0 },
        efeitos: [{ tipo: 'enviar', texto }],
      }
    }

    case 'resposta': {
      // Resposta de um turno antigo retomado, ou que chegou depois de a pessoa sair: não fala.
      if (fase !== 'pensando') return parado(estado)
      const texto = evento.cartoesNovos > 0 ? `${evento.texto.trim()}\n\n${AVISO_DE_CARTAO}` : evento.texto
      return { estado: { ...estado, fase: 'falando' }, efeitos: [{ tipo: 'falar', texto }] }
    }

    case 'respostaFalhou':
      if (fase !== 'pensando') return parado(estado)
      return { estado: { ...estado, fase: 'falando' }, efeitos: [{ tipo: 'falar', texto: AVISO_DE_FALHA }] }

    case 'falaTerminou':
      if (fase !== 'falando') return parado(estado)
      if (estado.iniciadaEm !== null && evento.agora - estado.iniciadaEm >= DURACAO_MAXIMA_MS) return sair('tempo')
      return voltarAOuvir(estado)

    case 'toque':
      if (fase !== 'falando') return parado(estado)
      return voltarAOuvir(estado, [{ tipo: 'pararFala' }])

    default:
      return parado(estado)
  }
}
