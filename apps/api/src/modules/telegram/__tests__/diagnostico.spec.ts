import { TelegramService } from '../telegram.service'

/**
 * ── O bot consegue enviar? (S5.6, 21/11) ─────────────────────────────────────
 *
 * Desde que o Telegram virou só saída, a pergunta do sensor mudou: não é mais "o chat livre
 * responde?", é "o aviso sai?". `getMe` confirma o token sem mandar mensagem — token revogado tem
 * a mesma cara de token configurado, e só perguntando ao Telegram se descobre.
 *
 * O histórico do sensor (o chat que respondeu 401 por meses, 14/09) está no `porque` do invariante
 * `telegram_responde`.
 */
describe('TelegramService.diagnostico — o bot consegue enviar avisos?', () => {
  const fetchOriginal = global.fetch
  afterEach(() => { global.fetch = fetchOriginal })

  function build(env: Record<string, string | undefined> = { TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '111' }) {
    return new TelegramService({ get: (k: string) => env[k] } as never)
  }

  function responder(status: number, corpo: unknown) {
    global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => corpo }) as never
  }

  it('getMe ok → canal pronto, sem mandar mensagem', async () => {
    responder(200, { ok: true, result: { username: 'rayzen_bot' } })
    const d = await build().diagnostico()
    expect(d).toMatchObject({ ok: true, botConfigurado: true, botResponde: 'sim' })
    const [url] = (global.fetch as jest.Mock).mock.calls[0]
    expect(String(url)).toMatch(/\/getMe$/)
    expect(String(url)).not.toMatch(/sendMessage/)
  })

  it('token revogado (401) → quebrado, dizendo por quê', async () => {
    responder(401, { ok: false, description: 'Unauthorized' })
    const d = await build().diagnostico()
    expect(d).toMatchObject({ ok: false, botResponde: 'nao' })
    expect(d.detalhe).toMatch(/401.*Unauthorized/)
  })

  it('sem token ou chat configurado → não configurado, sem chamar a rede', async () => {
    global.fetch = jest.fn() as never
    const d = await build({ TELEGRAM_BOT_TOKEN: 'x' }).diagnostico()
    expect(d).toMatchObject({ ok: false, botConfigurado: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rede fora → inconclusivo, nunca falha atribuída ao bot', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as never
    const d = await build().diagnostico()
    expect(d).toMatchObject({ ok: true, botResponde: 'inconclusivo' })
    expect(d.detalhe).toMatch(/Inconclusivo/)
  })
})
