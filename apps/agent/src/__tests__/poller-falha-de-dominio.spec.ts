import axios from 'axios'
import { Task } from '@rayzen/types'

jest.mock('axios')
// Factory explícita — sem ela o automock do Jest carrega o `executor.ts` real para
// derivar o mock, que arrasta `actions/open-app.ts` → `open` (ESM), quebrando o parser.
jest.mock('../executor', () => ({ executeTask: jest.fn() }))

const post = jest.fn()
const patch = jest.fn()
;(axios.create as jest.Mock) = jest.fn().mockReturnValue({ post, patch })

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeTask } = require('../executor') as { executeTask: jest.Mock }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { poll } = require('../poller') as { poll: () => Promise<void> }

function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    module: 'jarvis',
    action: 'run_command',
    payload: {},
    status: 'processing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * ── A04 da auditoria de 13/09, reproduzido em P3 ──────────────────────────────
 *
 * `processTask()` marcava `status: 'done'` sempre que a promessa de `executeTask` RESOLVIA.
 * Só exceção lançada virava `failed`. Uma ação que devolve `{ ok: false, error: '...' }` —
 * falha de domínio, o caso normal de quem não lança — era gravada como concluída, e o evento
 * publicado em seguida dizia "Task concluída" para o contexto futuro.
 *
 * A distinção que o conserto preserva: **`ok === false` estrito**. A maioria das 43 ações não
 * devolve `ok` nenhum, e tratar ausência como falha (`!result.ok`) mudaria o comportamento de
 * todas elas de graça. O que se corrige é a ação que DECLARA fracasso ser ignorada.
 */
describe('poller — resultado de domínio com ok:false não vira sucesso', () => {
  beforeEach(() => {
    post.mockReset()
    patch.mockReset()
    executeTask.mockReset()
    patch.mockResolvedValue({ data: null })
  })

  it('ok:false vira status failed, com o erro de domínio preservado', async () => {
    post.mockResolvedValueOnce({ data: fakeTask() })
    executeTask.mockResolvedValueOnce({ ok: false, error: 'simulated failure' })

    await poll()

    expect(patch).toHaveBeenCalledTimes(1)
    const [, body] = patch.mock.calls[0]
    expect(body.status).toBe('failed')
    expect(body.error).toContain('simulated failure')
  })

  it('ok:false sem campo error ainda falha, com mensagem utilizável', async () => {
    post.mockResolvedValueOnce({ data: fakeTask() })
    executeTask.mockResolvedValueOnce({ ok: false })

    await poll()

    const [, body] = patch.mock.calls[0]
    expect(body.status).toBe('failed')
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('falha de domínio NÃO publica evento de tarefa concluída', async () => {
    post.mockResolvedValueOnce({ data: fakeTask({ payload: { projectId: 'proj-1' } }) })
    executeTask.mockResolvedValueOnce({ ok: false, error: 'simulated failure' })

    await poll()

    // O único POST deve ser o claim; nenhum `/events/cli` dizendo "concluída".
    const eventos = post.mock.calls.filter(([url]) => String(url).includes('/events/cli'))
    expect(eventos).toHaveLength(0)
  })

  it('ok:true continua sendo sucesso', async () => {
    post.mockResolvedValueOnce({ data: fakeTask() })
    executeTask.mockResolvedValueOnce({ ok: true })

    await poll()

    const [, body] = patch.mock.calls[0]
    expect(body.status).toBe('done')
  })

  /**
   * O teste que impede o conserto de virar um problema diferente: a maioria das ações devolve
   * um objeto SEM `ok`. Nenhuma delas pode passar a falhar por causa desta mudança.
   */
  it.each([
    ['objeto sem ok', { path: 'C:/tmp/foto.png', takenAt: '2026-09-13T00:00:00Z' }],
    ['string', 'saída de texto'],
    ['array', [{ nome: 'arquivo.ts' }]],
    ['null', null],
    ['undefined', undefined],
  ])('resultado sem campo ok (%s) continua done', async (_nome, resultado) => {
    post.mockResolvedValueOnce({ data: fakeTask({ action: 'screenshot' }) })
    executeTask.mockResolvedValueOnce(resultado)

    await poll()

    const [, body] = patch.mock.calls[0]
    expect(body.status).toBe('done')
  })
})
