import axios from 'axios'
import { Task } from '@rayzen/types'

jest.mock('axios')
// Factory explícita — sem ela o automock carrega o `executor.ts` real para derivar o mock, que
// arrasta `actions/open-app.ts` → `open` (ESM) e quebra o parser.
jest.mock('../executor', () => ({ executeTask: jest.fn() }))

const post = jest.fn()
const patch = jest.fn()
;(axios.create as jest.Mock) = jest.fn().mockReturnValue({ post, patch })

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeTask } = require('../executor') as { executeTask: jest.Mock }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { poll } = require('../poller') as { poll: () => Promise<void> }

const TAREFA: Task = {
  id: 'task-longa',
  module: 'jarvis',
  action: 'supervised_session',
  payload: {},
  status: 'processing',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const heartbeats = () => post.mock.calls.filter(([url]) => String(url).includes('/heartbeat'))

/**
 * ── A05 da auditoria de 13/09, lado do executor ──────────────────────────────
 *
 * O servidor precisa distinguir "o agent morreu" de "a tarefa é longa". Não há teto de duração
 * que sirva para as duas pontas do catálogo — uma sessão supervisionada dura horas, um
 * `screenshot` dura segundos —, então a evidência não pode ser o relógio: é a renovação.
 *
 * Quem executa diz periodicamente "ainda estou aqui". Quem morre para de dizer, e só então a
 * tarefa é reconhecida como órfã. O contrário — presumir morte por tempo — reclamaria execuções
 * vivas e duplicaria efeito.
 */
describe('poller — renova a posse enquanto executa', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    post.mockReset()
    patch.mockReset()
    executeTask.mockReset()
    patch.mockResolvedValue({ data: null })
    post.mockImplementation(async (url: string) => {
      if (String(url).includes('/tasks/claim')) return { data: TAREFA }
      return { data: { ok: true } }
    })
  })

  afterEach(() => jest.useRealTimers())

  it('tarefa longa renova a posse mais de uma vez', async () => {
    let concluir: (v: unknown) => void = () => undefined
    executeTask.mockReturnValueOnce(new Promise((r) => { concluir = r }))

    const execucao = poll()
    await Promise.resolve()          // deixa o claim resolver

    expect(heartbeats()).toHaveLength(0)

    await jest.advanceTimersByTimeAsync(65_000)   // ~3 renovações a 20s
    expect(heartbeats().length).toBeGreaterThanOrEqual(3)

    concluir({ ok: true })
    await execucao
  })

  it('a renovação identifica o dono — senão qualquer agent estenderia a posse alheia', async () => {
    let concluir: (v: unknown) => void = () => undefined
    executeTask.mockReturnValueOnce(new Promise((r) => { concluir = r }))

    const execucao = poll()
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(25_000)

    const [, corpo] = heartbeats()[0]
    expect(corpo).toMatchObject({ role: 'desktop' })
    expect(typeof (corpo as { hostname?: unknown }).hostname).toBe('string')

    concluir({ ok: true })
    await execucao
  })

  /**
   * O vazamento que faria a correção se voltar contra ela mesma: um intervalo sobrevivente
   * continuaria renovando a posse de uma tarefa encerrada, e a PRÓXIMA tarefa presa neste mesmo
   * agent nunca seria reconhecida como órfã.
   */
  it('para de renovar quando a tarefa termina', async () => {
    executeTask.mockResolvedValueOnce({ ok: true })

    await poll()
    const antes = heartbeats().length

    await jest.advanceTimersByTimeAsync(120_000)

    expect(heartbeats().length).toBe(antes)
  })

  it('para de renovar também quando a tarefa lança', async () => {
    executeTask.mockRejectedValueOnce(new Error('explodiu'))

    await poll()
    const antes = heartbeats().length

    await jest.advanceTimersByTimeAsync(120_000)

    expect(heartbeats().length).toBe(antes)
  })
})
