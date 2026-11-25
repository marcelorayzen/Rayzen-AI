import { AgentSessionService, linkDoFio } from '../agent-session.service'
import { CanalTelegram } from '../canal-de-aviso'

/**
 * G7.1 — todo aviso da sessão supervisionada leva ao fio do projeto no Hub (`/?projeto=<id>`).
 * O link vem do `projectId` da PRÓPRIA sessão gravada, nunca de um projeto ativo qualquer.
 */
describe('avisos da sessão levam ao fio do projeto', () => {
  const LINK = 'https://example.com/?projeto=proj-1'

  function montar(sessao: Record<string, unknown>) {
    const prisma = {
      agentSession: {
        create: jest.fn().mockResolvedValue({ id: 'sess-1', ...sessao }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'sess-1', ...sessao }),
      },
    }
    const canal = { enviar: jest.fn().mockResolvedValue(undefined) }
    const execution = { enqueue: jest.fn().mockResolvedValue(undefined) }
    const service = new AgentSessionService(prisma as never, canal, execution as never, {} as never)
    return { service, canal, prisma }
  }

  const enviado = (canal: { enviar: jest.Mock }) => String(canal.enviar.mock.calls[0][0])

  it.each([
    ['início', (s: AgentSessionService) => s.create('proj-1', 'faça X')],
    ['pergunta', (s: AgentSessionService) => s.postQuestion('sess-1', 'qual caminho?')],
    ['aprovação', (s: AgentSessionService) => s.postQuestion('sess-1', 'aprova?', true)],
    ['conclusão', (s: AgentSessionService) => s.complete('sess-1', 'feito')],
    ['erro', (s: AgentSessionService) => s.error('sess-1', 'quebrou')],
  ])('aviso de %s contém o link do fio', async (_nome, acionar) => {
    const { service, canal } = montar({ projectId: 'proj-1' })
    await acionar(service)
    expect(enviado(canal)).toContain(LINK)
  })

  it('sessão sem projeto sai sem link, em vez de apontar para outro projeto', async () => {
    const { service, canal } = montar({ projectId: null })
    await service.complete('sess-1', 'feito')
    expect(enviado(canal)).not.toContain('?projeto=')
  })

  it('G7.2: o CanalTelegram entrega o texto inteiro ao chat raiz', async () => {
    const telegram = { send: jest.fn().mockResolvedValue(undefined) }
    await new CanalTelegram(telegram as never).enviar('oi')
    expect(telegram.send).toHaveBeenCalledWith('oi')
  })

  it('HUB_PUBLIC_URL troca a base e o id é codificado', () => {
    expect(linkDoFio('a b', { HUB_PUBLIC_URL: 'https://hub.exemplo/' })).toContain('https://hub.exemplo/?projeto=a%20b')
  })

  // HC6: o botão "Abrir prévia" do cartão lê `previewUrl` da sessão enquanto ela espera no portão.
  it('o portão grava a prévia na sessão; pergunta sem prévia não apaga a gravada', async () => {
    const { service, prisma } = montar({ projectId: 'proj-1' })
    await service.postQuestion('sess-1', 'publicar?', true, ['sim'], 'https://preview.example.com')
    expect(prisma.agentSession.update.mock.calls[0][0].data.previewUrl).toBe('https://preview.example.com')
    await service.postQuestion('sess-1', 'qual caminho?')
    expect(prisma.agentSession.update.mock.calls[1][0].data).not.toHaveProperty('previewUrl')
  })
})

describe('appendLog guarda o link do VS Code só se for do VS Code Remote (G2.9)', () => {
  function montar() {
    const prisma = {
      agentSession: {
        findUnique: jest.fn().mockResolvedValue({ liveLog: 'antes\n' }),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new AgentSessionService(prisma as never, { enviar: jest.fn() } as never, {} as never, {} as never)
    return { service, prisma }
  }
  const BOM = 'vscode://vscode-remote/ssh-remote+rayzen@192.0.2.10/home/rayzen/workspaces/rayzen-marcenaria/sessao-cmwulv7za000'

  it('link do VS Code Remote é gravado junto com o log', async () => {
    const { service, prisma } = montar()
    await service.appendLog('s1', '[pasta pronta]\n', BOM)
    expect(prisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: 's1' }, data: { liveLog: 'antes\n[pasta pronta]\n', vscodeUrl: BOM },
    })
  })

  it.each([
    'javascript:alert(1)',
    'https://evil.example/x',
    'vscode://vscode-remote/ssh-remote+a b/x',
    'vscode://vscode-remote/ssh-remote+rayzen@h/x"onclick',
  ])('%s não vira botão: só o log é gravado', async (url) => {
    const { service, prisma } = montar()
    await service.appendLog('s1', 'x', url)
    expect(prisma.agentSession.update.mock.calls[0][0].data).toEqual({ liveLog: 'antes\nx' })
  })
})
