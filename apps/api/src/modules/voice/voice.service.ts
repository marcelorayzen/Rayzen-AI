import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import axios from 'axios'
import FormData from 'form-data'
import { limparParaFala, pedacosParaFala, TETO_DA_SINTESE } from './voice-pedacos'

/**
 * ── A ENTRADA de voz também passa pelo proxy (20/09) ───────────────────────
 *
 * A saída migrou primeiro, porque estava quebrada. A entrada **funcionava** — `whisper-large-v3-turbo`
 * na Groq, em português — e foi exatamente por isso que ficou para trás: nada doía.
 *
 * Mas a regra da casa não é "use o proxy quando o direto falhar". Fora dele não há rastro no
 * Langfuse, custo registrado, cadeia de fallback nem sonda do invariante — e o grupo `whisper-1`
 * já existia apontando para o mesmo modelo, nunca afetado pela descontinuação de 17/08.
 *
 * Medido antes de trocar, contra o LiteLLM de produção: `200`, mesmo campo `text` na resposta, e
 * `language=pt` aceito igual. Sem surpresa de formato.
 */
const STT_MODEL = 'whisper-1'

/**
 * O nome do rastro, um só para os dois sentidos da voz.
 *
 * Medido em multipart antes de confiar: sem `metadata`, a transcrição cai no Langfuse como
 * `litellm-atranscription`, anônima; com ela, o nome aparece. `/audio/transcriptions` não passa
 * por `createLlmClient`, então o nome vai à mão, como nas sondas dos invariantes.
 */
const TRACE_NAME = 'rayzen:v1:voice'

/**
 * ── A saída de voz volta para o proxy, e passa a falar português ────────────
 *
 * Isto chamava `api.groq.com` DIRETO, com `canopylabs/orpheus-v1-english` — duas coisas erradas ao
 * mesmo tempo, e a segunda escondia a primeira.
 *
 * **A regra da casa é "sempre via LiteLLM, nunca apontar direto".** Direto significa sem rastro no
 * Langfuse, sem custo registrado, sem a cadeia de fallback e fora da sonda do invariante
 * `modelos_llm_respondem`. O grupo `tts-1` existia e estava quebrado desde 17/08 (a Groq
 * descontinuou o `playai-tts`), então este módulo contornava o proxy para funcionar — e o contorno
 * virou o padrão.
 *
 * **E a voz era inglesa lendo português.** `orpheus-v1-english` é o que sobrou de fala na conta da
 * Groq; o nome diz o idioma.
 *
 * Em 20/09 o `tts-1` passou a apontar para o Gemini, com a voz **Charon** escolhida por Marcelo
 * entre cinco masculinas geradas com a mesma frase. O caminho foi provado antes de fixar: um
 * LiteLLM descartável, com esta config, devolveu 200 e **355 KB de RIFF/WAVE 24 kHz** de verdade.
 *
 * ── O `Content-Type` que o LiteLLM devolve MENTE ───────────────────────────
 *
 * Ele responde `audio/mpeg`, e os bytes são WAV (`RIFF....WAVE`, 24 kHz, 16 bits, mono) — medido,
 * não suposto. Por isso o header de saída daqui é fixado em `audio/wav` pelo controller em vez de
 * repassado: confiar no rótulo da resposta faria o navegador tentar decodificar WAV como MP3, e o
 * áudio simplesmente não tocaria.
 */
const TTS_MODEL = 'tts-1'
const TTS_VOICE = 'Charon'

@Injectable()
export class VoiceService {
  constructor(private config: ConfigService) {}

  /** HC7a: o texto que vai ser falado, já em pedaços que a síntese aguenta. */
  pedacos(text: string): string[] {
    return pedacosParaFala(text)
  }

  async synthesize(text: string): Promise<Buffer> {
    const clean = limparParaFala(text)
    // Antes, `.slice(0, 800)`: a resposta mediana do Hub tem 1.107 caracteres, e a fala parava no
    // meio de uma frase sem ninguém saber. Agora quem tem texto longo pede `/voice/pedacos`.
    if (clean.length > TETO_DA_SINTESE) {
      throw new BadRequestException(
        `Texto com ${clean.length} caracteres para uma síntese só (teto ${TETO_DA_SINTESE}). Quebre em /voice/pedacos.`,
      )
    }
    if (!clean) throw new BadRequestException('Nada para falar depois de limpar o texto.')

    // `LITELLM_BASE_URL` já existe no ambiente da api — é o mesmo que `createLlmClient` usa.
    // Sem ele, falhar dizendo O QUE FALTA, como o `orchestrate` passou a fazer em 14/09: a
    // alternativa é montar a URL com `undefined` e colher um erro de rede que não explica nada.
    const base = this.config.get<string>('LITELLM_BASE_URL')
    if (!base) throw new Error('TTS indisponível: LITELLM_BASE_URL não está configurada.')

    const res = await fetch(`${base.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.get('LITELLM_MASTER_KEY')}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: clean,
        voice: TTS_VOICE,
        // ── Quem fala se identifica ────────────────────────────────────────
        //
        // Sem isto a chamada cai no Langfuse como `litellm-aspeech`, anônima — medido em 20/09,
        // logo depois de migrar para o proxy. Mover a chamada para dentro do LiteLLM e deixá-la
        // sem nome resolve metade do problema e repete a outra: o rastro existe e não responde
        // *"quem gastou isso"*, que é a pergunta pela qual ele existe.
        //
        // `metadata.trace_name` à mão, como as sondas dos invariantes fazem — `/audio/speech` não
        // passa por `createLlmClient`, então não há como herdar o nome.
        metadata: { trace_name: 'rayzen:v1:voice' },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`TTS falhou (${res.status}): ${err.slice(0, 300)}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav'
    const tmpPath = join(tmpdir(), `stt_${randomUUID()}.${ext}`)
    writeFileSync(tmpPath, audioBuffer)

    try {
      const base = this.config.get<string>('LITELLM_BASE_URL')
      if (!base) throw new Error('Transcrição indisponível: LITELLM_BASE_URL não está configurada.')

      const form = new FormData()
      form.append('file', readFileSync(tmpPath), { filename: `audio.${ext}`, contentType: mimeType })
      form.append('model', STT_MODEL)
      // `pt` fixo e não auto-detecção: o Whisper erra em clipe curto e com sotaque, e quem fala
      // aqui fala português. Estava assim antes da migração e continua — o que mudou foi só por
      // onde a chamada sai.
      form.append('language', 'pt')
      form.append('response_format', 'json')
      form.append('metadata', JSON.stringify({ trace_name: TRACE_NAME }))

      const res = await axios.post(`${base.replace(/\/$/, '')}/audio/transcriptions`, form, {
        headers: {
          Authorization: `Bearer ${this.config.get('LITELLM_MASTER_KEY')}`,
          ...form.getHeaders(),
        },
      })

      return (res.data as { text: string }).text.trim()
    } finally {
      unlinkSync(tmpPath)
    }
  }
}
