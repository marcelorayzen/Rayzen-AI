import { TelegramService } from '../telegram.service'

/**
 * ── O sensor que faltava (14/09) ─────────────────────────────────────────────
 *
 * O chat livre do Telegram respondia 401 e virava "erro ao processar mensagem" — e isso durou
 * meses sem nada acusar. `orchestrate()` lia `TELEGRAM_API_TOKEN`, uma variável que **nunca
 * existiu**, com `?? ''`, e mandava `Bearer ` vazio.
 *
 * Por que passou: os **comandos** funcionavam (não passam pelo orquestrador), o processo subia
 * saudável, o long-polling logava "started", e o painel ficava verde. É o critério de entrada do
 * catálogo de invariantes desta casa — não "seria bom checar", e sim **já quebrou em silêncio e
 * custou tempo para achar**.
 *
 * O diagnóstico responde sem efeito colateral: não envia mensagem, não cria conversa e não gasta
 * LLM. Sondar `POST /orchestrate` de verdade a cada 30 minutos pagaria uma conversa por sonda —
 * e um sensor caro é um sensor que alguém desliga.
 */
describe('TelegramService.diagnostico — o caminho do chat está inteiro?', () => {
  function build(opts: {
    token?: string
    chatId?: string
    polling?: boolean
    env?: Record<string, string | undefined>
    chats?: number
    comProjeto?: number
    total?: number
  } = {}) {
    const svc = Object.create(TelegramService.prototype) as TelegramService
    Object.assign(svc, {
      token: opts.token ?? 'bot-token',
      chatId: opts.chatId ?? '111',
      pollTimer: opts.polling === false ? null : setTimeout(() => undefined, 0),
      config: { get: (k: string) => (opts.env ?? { AGENT_TOKEN: 'tok' })[k] },
      prisma: {
        telegramChat: { count: jest.fn().mockResolvedValue(opts.chats ?? 0) },
        telegramSession: {
          count: jest.fn().mockImplementation(({ where }: { where?: { projectId?: unknown } } = {}) =>
            Promise.resolve(where?.projectId ? (opts.comProjeto ?? 0) : (opts.total ?? 1)),
          ),
        },
      },
    })
    return (svc as unknown as { diagnostico: () => Promise<Record<string, unknown>> }).diagnostico()
  }

  it('tudo configurado → pronto', async () => {
    const d = await build({ comProjeto: 1, total: 1 })

    expect(d.ok).toBe(true)
    expect(d.botConfigurado).toBe(true)
    expect(d.pollingAtivo).toBe(true)
    expect(d.credencialOrquestrador).toBe('ok')
  })

  /** O defeito exato de 14/09: sem credencial, todo texto livre vira 401. */
  it('sem TELEGRAM_API_TOKEN nem AGENT_TOKEN → NÃO ok, e diz qual é o efeito', async () => {
    const d = await build({ env: {}, comProjeto: 1, total: 1 })

    expect(d.ok).toBe(false)
    expect(d.credencialOrquestrador).toBe('ausente')
    expect(String(d.detalhe)).toMatch(/texto livre|401/i)
  })

  it('cai para AGENT_TOKEN quando só ele existe — é o que o orquestrador faz', async () => {
    const d = await build({ env: { AGENT_TOKEN: 'tok' }, comProjeto: 1, total: 1 })

    expect(d.credencialOrquestrador).toBe('ok')
    expect(d.ok).toBe(true)
  })

  it('bot sem token → NÃO ok', async () => {
    const d = await build({ token: '', comProjeto: 1, total: 1 })

    expect(d.ok).toBe(false)
    expect(d.botConfigurado).toBe(false)
  })

  it('polling parado → NÃO ok', async () => {
    const d = await build({ polling: false, comProjeto: 1, total: 1 })

    expect(d.ok).toBe(false)
    expect(d.pollingAtivo).toBe(false)
  })

  /**
   * Chat sem projeto vinculado responde SEM contexto — não é falha do canal, é configuração
   * incompleta. Entra como número no diagnóstico, para o HUD mostrar, mas não derruba o sensor:
   * vermelho permanente é o que se aprende a ignorar.
   */
  it('chat sem projeto conta, mas não derruba o sensor', async () => {
    const d = await build({ comProjeto: 0, total: 3 })

    expect(d.ok).toBe(true)
    expect(d.chatsSemProjeto).toBe(3)
    expect(String(d.detalhe)).toMatch(/sem projeto/i)
  })

  it('nunca expõe valor de token', async () => {
    const d = await build({ token: 'segredo-do-bot', env: { AGENT_TOKEN: 'segredo-agent' } })

    expect(JSON.stringify(d)).not.toMatch(/segredo-do-bot|segredo-agent/)
  })
})
