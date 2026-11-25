import axios from 'axios'
import { Task } from '@rayzen/types'

jest.mock('axios')
// Factory explícita — sem ela o automock do Jest carrega o `executor.ts` real para
// derivar o mock, que arrasta `actions/open-app.ts` → `open` (ESM), quebrando o parser.
jest.mock('../executor', () => ({ executeTask: jest.fn() }))

// `poller.ts` chama `axios.create()` uma vez, no module scope — o mock precisa
// devolver a MESMA instância (com post/patch espiáveis) antes do `require('../poller')`.
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
 * Item C.3 do plano de execução tipada — `poller.ts` precisa extrair `aprovadoPor` do
 * RESULTADO da execução (`RunCommandResult`, vindo de `decidir()`) e repassá-lo como
 * `approvedBy` no PATCH de audit. Antes desta mudança o PATCH nunca incluía o campo.
 */
describe('poller — approvedBy no PATCH de audit', () => {
  beforeEach(() => {
    post.mockReset()
    patch.mockReset()
    executeTask.mockReset()
    patch.mockResolvedValue({ data: null })
  })

  it('inclui approvedBy quando o resultado da execução traz aprovadoPor', async () => {
    post.mockResolvedValueOnce({ data: fakeTask() })
    executeTask.mockResolvedValueOnce({
      command: 'git status', output: 'ok', dryRun: false, risk: 'medium',
      label: 'git status', skipped: false, aprovadoPor: 'marcelo',
    })

    await poll()

    expect(patch).toHaveBeenCalledTimes(1)
    const [, body] = patch.mock.calls[0]
    expect(body.approvedBy).toBe('marcelo')
    expect(body.status).toBe('done')
  })

  it('approvedBy fica undefined quando a execução não exigiu/consumiu aprovação', async () => {
    post.mockResolvedValueOnce({ data: fakeTask({ action: 'notify' }) })
    executeTask.mockResolvedValueOnce({ ok: true })

    await poll()

    expect(patch).toHaveBeenCalledTimes(1)
    const [, body] = patch.mock.calls[0]
    expect(body.approvedBy).toBeUndefined()
  })

  it('não confia em aprovadoPor de tipo errado no resultado', async () => {
    post.mockResolvedValueOnce({ data: fakeTask() })
    // um resultado malformado (aprovadoPor não-string) nunca deveria virar identidade aceita
    executeTask.mockResolvedValueOnce({ aprovadoPor: { forjado: true } })

    await poll()

    const [, body] = patch.mock.calls[0]
    expect(body.approvedBy).toBeUndefined()
  })
})
