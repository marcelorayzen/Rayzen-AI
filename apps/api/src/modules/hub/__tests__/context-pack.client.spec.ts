import { ContextPackClient } from '../context-pack.client'

describe('ContextPackClient', () => {
  const apiV2Url = process.env.API_V2_URL
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.API_V2_URL = 'http://api-v2:3002'
  })

  afterEach(() => {
    process.env.API_V2_URL = apiV2Url
    global.fetch = originalFetch
  })

  it('uses the V2 controller prefix for the authenticated content read', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ id: 'pack-1', text: 'contexto', snapshotHash: 'hash-1' }),
    }) as unknown as typeof fetch
    const client = new ContextPackClient()

    await expect(client.content('pack-1', 'Bearer human-jwt')).resolves.toEqual({
      id: 'pack-1', text: 'contexto', snapshotHash: 'hash-1',
    })
    expect(global.fetch).toHaveBeenCalledWith('http://api-v2:3002/v2/context/packs/pack-1/content', {
      headers: { Authorization: 'Bearer human-jwt' },
    })
  })
})
