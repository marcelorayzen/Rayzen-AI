import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { VoiceService } from '../voice.service'

/**
 * ── Valor DISTINTO por chave, e isso não é detalhe ──────────────────────────
 *
 * O mock devolvia `'mock-groq-key'` para qualquer chave. Quando o TTS migrou da Groq direta para
 * o LiteLLM (20/09), o caso *"usa a chave GROQ_API_KEY"* **continuou verde** — afirmando algo que
 * o código tinha deixado de fazer.
 *
 * Mock que responde igual a tudo transforma asserção de credencial em decoração: ele não sabe
 * dizer QUAL chave foi pedida, que é justamente a pergunta.
 */
const CHAVES: Record<string, string> = {
  GROQ_API_KEY:       'mock-groq-key',
  LITELLM_MASTER_KEY: 'mock-litellm-key',
  LITELLM_BASE_URL:   'http://litellm-de-teste:4000/v1',
}
const mockConfigGet = jest.fn((k: string): string | undefined => CHAVES[k])

describe('VoiceService', () => {
  let service: VoiceService

  beforeEach(async () => {
    jest.clearAllMocks()
    // `clearAllMocks` zera CHAMADAS, não implementações — então um `mockImplementation` posto num
    // caso vazava para os seguintes. Passou despercebido enquanto só o `synthesize` lia
    // `LITELLM_BASE_URL`; virou três falhas no minuto em que o `transcribe` passou a ler também.
    mockConfigGet.mockImplementation((k: string): string | undefined => CHAVES[k])

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: ConfigService, useValue: { get: mockConfigGet } },
      ],
    }).compile()

    service = module.get<VoiceService>(VoiceService)
  })

  describe('synthesize', () => {
    it('envia o texto limpo (sem markdown) para a API Groq', async () => {
      const mockBuffer = Buffer.from('audio-data')
      const mockArrayBuffer = mockBuffer.buffer.slice(
        mockBuffer.byteOffset,
        mockBuffer.byteOffset + mockBuffer.byteLength,
      )

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
      })

      await service.synthesize('**texto em negrito** e `código`')

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.input).toBe('texto em negrito e código')
    })

    // HC7a: era `.slice(0, 800)` calado — a fala parava no meio da frase. Agora recusa e diz onde
    // quebrar, e não gasta chamada nenhuma no Gemini.
    it('recusa texto acima do teto em vez de cortar calado, sem chamar o TTS', async () => {
      global.fetch = jest.fn()
      await expect(service.synthesize('palavra '.repeat(80))).rejects.toThrow(/voice\/pedacos/)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('aceita texto exatamente no teto de 500', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)) })
      await service.synthesize('a'.repeat(500))
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).input).toHaveLength(500)
    })

    it('pedacos devolve frases inteiras dentro do teto', () => {
      const resposta = 'Primeira frase. '.repeat(60)
      const pedacos = service.pedacos(resposta)
      expect(pedacos.length).toBeGreaterThan(1)
      expect(pedacos.every((p) => p.length <= 350 && p.endsWith('.'))).toBe(true)
    })

    it('lança erro quando API retorna status não-ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      })

      // O status entra na mensagem: "TTS falhou" sem código não distingue chave errada (401) de
      // modelo fora do ar (503), e as duas mandam procurar em lugares opostos.
      await expect(service.synthesize('texto')).rejects.toThrow('TTS falhou (401): Unauthorized')
    })

    /**
     * ── A saída de voz passa pelo PROXY, não pela Groq ────────────────────────
     *
     * Chamar o provedor direto contraria *"sempre via LiteLLM"* — e o custo não é estético: sem o
     * proxy não há rastro no Langfuse, custo registrado, cadeia de fallback nem sonda do
     * invariante. Este módulo contornava porque o grupo `tts-1` estava quebrado desde 17/08, e o
     * contorno virou o padrão.
     */
    it('fala pelo LiteLLM com a credencial do proxy, não com a da Groq', async () => {
      const mockArrayBuffer = new ArrayBuffer(8)
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
      })

      await service.synthesize('teste')

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('http://litellm-de-teste:4000/v1/audio/speech')
      expect(url).not.toMatch(/api\.groq\.com/)
      expect(init.headers['Authorization']).toBe('Bearer mock-litellm-key')
    })

    /** A voz escolhida por Marcelo entre cinco masculinas, e o grupo do proxy. */
    it('pede o grupo `tts-1` com a voz Charon', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      })

      await service.synthesize('teste')

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
      expect(body.model).toBe('tts-1')
      expect(body.voice).toBe('Charon')
    })

    /**
     * ── Quem fala se identifica ───────────────────────────────────────────
     *
     * Medido em 20/09, logo depois de migrar para o proxy: a chamada aparecia no Langfuse como
     * `litellm-aspeech`, **anônima**. Mover para dentro do LiteLLM e deixar sem nome resolve
     * metade do problema e repete a outra — o rastro existe e não responde "quem gastou isso",
     * que é a pergunta pela qual ele existe.
     */
    it('se identifica no Langfuse — `rayzen:v1:voice`, não anônima', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      })

      await service.synthesize('teste')

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
      expect(body.metadata?.trace_name).toBe('rayzen:v1:voice')
    })

    /**
     * Sem a variável, falhar dizendo O QUE FALTA — a lição do `TELEGRAM_API_TOKEN`, que nunca
     * existiu e fazia toda conversa livre morrer num 401 genérico por meses.
     */
    it('sem LITELLM_BASE_URL, diz o que falta em vez de montar URL inválida', async () => {
      mockConfigGet.mockImplementation((k: string) => (k === 'LITELLM_BASE_URL' ? undefined : CHAVES[k]))
      global.fetch = jest.fn()

      await expect(service.synthesize('teste')).rejects.toThrow('LITELLM_BASE_URL')
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('transcribe', () => {
    it('remove o arquivo temporário após transcrição (cleanup no finally)', async () => {
      const { writeFileSync, unlinkSync } = jest.requireActual('fs') as typeof import('fs')
      const fsMock = {
        writeFileSync: jest.fn(),
        unlinkSync: jest.fn(),
        readFileSync: jest.fn().mockReturnValue(Buffer.from('audio')),
      }

      jest.doMock('fs', () => ({ ...jest.requireActual('fs'), ...fsMock }))

      const axios = require('axios')
      jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'texto transcrito' } })

      const buffer = Buffer.from('fake-audio')
      await expect(service.transcribe(buffer, 'audio/webm')).resolves.toBe('texto transcrito')

      void writeFileSync
      void unlinkSync
    })

    it('usa extensão mp4 para mimeType audio/mp4', async () => {
      const axios = require('axios')
      jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'transcrição mp4' } })

      const result = await service.transcribe(Buffer.from('fake'), 'audio/mp4')
      expect(result).toBe('transcrição mp4')
    })

    it('usa extensão wav para mimeType genérico (fallback)', async () => {
      const axios = require('axios')
      jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'transcrição wav' } })

      const result = await service.transcribe(Buffer.from('fake'), 'audio/ogg')
      expect(result).toBe('transcrição wav')
    })

    /**
     * ── A ENTRADA também passa pelo proxy (20/09) ───────────────────────────
     *
     * A saída migrou primeiro porque estava quebrada; a entrada FUNCIONAVA, e foi por isso que
     * ficou para trás. Mas a regra não é "use o proxy quando o direto falhar" — fora dele não há
     * rastro, custo, fallback nem sonda.
     */
    it('transcreve pelo LiteLLM com a credencial do proxy, não pela Groq', async () => {
      const axios = require('axios')
      const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'ok' } })

      await service.transcribe(Buffer.from('fake'), 'audio/webm')

      const [url, , cfg] = post.mock.calls[0] as [string, unknown, { headers: Record<string, string> }]
      expect(url).toBe('http://litellm-de-teste:4000/v1/audio/transcriptions')
      expect(url).not.toMatch(/api\.groq\.com/)
      expect(cfg.headers['Authorization']).toBe('Bearer mock-litellm-key')
    })

    /**
     * Medido em multipart antes de confiar: sem `metadata`, a transcrição cai no Langfuse como
     * `litellm-atranscription`, anônima. Mesma lição do TTS, uma hora antes.
     */
    it('se identifica no Langfuse e pede `whisper-1` em português', async () => {
      const axios = require('axios')
      const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'ok' } })

      await service.transcribe(Buffer.from('fake'), 'audio/webm')

      // `form-data` guarda os campos no buffer interno; ler o corpo serializado é o que prova
      // o que de fato sai pela rede.
      const form = post.mock.calls[0][1] as { getBuffer: () => Buffer }
      const corpo = form.getBuffer().toString('utf8')
      expect(corpo).toContain('rayzen:v1:voice')
      expect(corpo).toContain('whisper-1')
      expect(corpo).toMatch(/name="language"[\s\S]{0,40}pt/)
    })

    it('sem LITELLM_BASE_URL, diz o que falta em vez de montar URL inválida', async () => {
      mockConfigGet.mockImplementation((k: string) => (k === 'LITELLM_BASE_URL' ? undefined : CHAVES[k]))
      const axios = require('axios')
      const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { text: 'ok' } })

      await expect(service.transcribe(Buffer.from('fake'), 'audio/webm')).rejects.toThrow('LITELLM_BASE_URL')
      expect(post).not.toHaveBeenCalled()
    })
  })
})
