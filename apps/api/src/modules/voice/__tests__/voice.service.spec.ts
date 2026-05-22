import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { VoiceService } from '../voice.service'

const mockConfigGet = jest.fn().mockReturnValue('mock-groq-key')

describe('VoiceService', () => {
  let service: VoiceService

  beforeEach(async () => {
    jest.clearAllMocks()

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

    it('limita o texto a 800 caracteres', async () => {
      const longText = 'a'.repeat(1000)
      const mockArrayBuffer = new ArrayBuffer(8)

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
      })

      await service.synthesize(longText)

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      const body = JSON.parse(fetchCall[1].body)

      expect(body.input.length).toBe(800)
    })

    it('lança erro quando API retorna status não-ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: jest.fn().mockResolvedValue('Unauthorized'),
      })

      await expect(service.synthesize('texto')).rejects.toThrow('TTS falhou: Unauthorized')
    })

    it('usa a chave GROQ_API_KEY do ConfigService', async () => {
      const mockArrayBuffer = new ArrayBuffer(8)
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer),
      })

      await service.synthesize('teste')

      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer mock-groq-key')
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
  })
})
