import { ConfigService } from '@nestjs/config'
import { EmbeddingService } from '../embedding.service'

function fakeConfig(apiKey = 'jina-test-key'): ConfigService {
  return { get: (_key: string, defaultValue?: unknown) => (apiKey || defaultValue) as unknown } as unknown as ConfigService
}

describe('EmbeddingService', () => {
  afterEach(() => jest.restoreAllMocks())

  it('retorna o vetor de embedding da resposta da Jina', async () => {
    const vector = new Array(1024).fill(0.1)
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: vector }] }),
    })) as unknown as typeof fetch
    const service = new EmbeddingService(fakeConfig())

    const result = await service.embed('clientes ativos')

    expect(result).toEqual(vector)
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.jina.ai/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer jina-test-key' }),
      }),
    )
  })

  it('lança erro quando JINA_API_KEY não está configurada', async () => {
    const service = new EmbeddingService(fakeConfig(''))
    await expect(service.embed('qualquer texto')).rejects.toThrow('JINA_API_KEY não configurado')
  })

  it('lança erro quando a Jina responde com falha', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Insufficient account balance' }),
    })) as unknown as typeof fetch
    const service = new EmbeddingService(fakeConfig())

    await expect(service.embed('clientes ativos')).rejects.toThrow('Insufficient account balance')
  })
})
