import axios from 'axios'
import { beatGuardian, _resetThrottle } from '../system-heartbeat-client'

jest.mock('axios')
const post = axios.post as jest.MockedFunction<typeof axios.post>

/**
 * O Guardian roda no agent, processo separado da api-v2, e sua análise é
 * disparada por MUDANÇA de arquivo — não por tick. Sem batimento próprio, três
 * dias sem codar seriam indistinguíveis de "Guardian desligado".
 */
describe('beatGuardian', () => {
  beforeEach(() => {
    _resetThrottle()
    post.mockReset()
    post.mockResolvedValue({ data: null } as never)
    process.env.AGENT_API_V2_URL = 'http://servidor:3103'
    process.env.AGENT_TOKEN = 'tok'
  })

  it('bate identificando o componente do catalogo', async () => {
    await beatGuardian({ ok: true })

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0]
    expect(url).toBe('http://servidor:3103/v2/system/heartbeat')
    expect(body).toMatchObject({ component: 'guardian', ok: true })
  })

  it('throttle: chamadas seguidas nao viram requisicoes', async () => {
    // O watcher roda a cada 30s. Bater junto seriam ~2.880 requisicoes/dia so
    // para dizer "estou aqui" — batimento e tick sao cadencias diferentes.
    await beatGuardian({ ok: true })
    await beatGuardian({ ok: true })
    await beatGuardian({ ok: true })

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('falha de rede NAO consome o throttle — tenta de novo no proximo tick', async () => {
    post.mockRejectedValueOnce(new Error('sem rede'))
    await beatGuardian({ ok: true })
    expect(post).toHaveBeenCalledTimes(1)

    // Se o throttle tivesse sido marcado no envio (e nao no sucesso), o agent
    // ficaria 5 min invisivel depois de qualquer soluco de rede.
    post.mockResolvedValue({ data: null } as never)
    await beatGuardian({ ok: true })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('propaga falha do ciclo em vez de reportar sucesso', async () => {
    await beatGuardian({ ok: false, erro: 'scan falhou' })

    expect(post.mock.calls[0][1]).toMatchObject({ ok: false, erro: 'scan falhou' })
  })

  it('rede fora nao derruba o watcher', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(beatGuardian({ ok: true })).resolves.toBeUndefined()
  })

  it('sem URL configurada nao tenta nada', async () => {
    delete process.env.AGENT_API_V2_URL
    delete process.env.AGENT_API_URL

    await beatGuardian({ ok: true })
    expect(post).not.toHaveBeenCalled()
  })
})
