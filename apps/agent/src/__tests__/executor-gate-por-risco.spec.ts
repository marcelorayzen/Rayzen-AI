import { executeTask } from '../executor'
import { consumirAprovacao } from '../exec/approval-client'
import { fileDelete, fileRead } from '../actions/file-ops'
import { createProjectFolder } from '../actions/create-project-folder'

jest.mock('../exec/approval-client', () => ({
  consumirAprovacao: jest.fn(),
}))
// `executor.ts` importa as 44 ações, e `open-app`/`open-url` puxam o pacote `open`, que é
// ESM-only — o parser do jest quebra antes de qualquer teste rodar. Factory explícita corta o
// import transitivo; é a mesma armadilha registrada no Item C.3.
jest.mock('../actions/open-app', () => ({ openApp: jest.fn() }))
jest.mock('../actions/open-url', () => ({ openUrl: jest.fn() }))
jest.mock('../actions/browse-screenshot', () => ({ browseAndScreenshot: jest.fn() }))
jest.mock('../actions/create-project-folder', () => ({
  createProjectFolder: jest.fn().mockResolvedValue({ path: 'C:\\Projects\\Fixture', created: true }),
}))
jest.mock('../actions/file-ops', () => ({
  fileDelete: jest.fn().mockResolvedValue({ deleted: true }),
  fileRead: jest.fn().mockResolvedValue({ content: 'x' }),
  fileWrite: jest.fn().mockResolvedValue({ written: true }),
}))

const aprovacao = consumirAprovacao as jest.MockedFunction<typeof consumirAprovacao>
const criarPasta = createProjectFolder as jest.MockedFunction<typeof createProjectFolder>

function tarefa(action: string, payload: Record<string, unknown> = {}) {
  return { id: 't1', module: 'jarvis', action, payload } as never
}

/**
 * ── Autorização depende do RISCO, não da porta ──────────────────────────────
 *
 * `consumirAprovacao()` era chamado só pelo `decidir()`, que cobre `run_command`. As cinco
 * ações `high` chegavam aqui com whitelist e role-policy, e mais nada — o motor de skills da V2
 * as barra desde o A08, mas tarefa enfileirada direto no agent nunca passava por lá.
 *
 * O defeito que estes testes pegam não daria erro: daria um `file_delete` executando sozinho.
 */
describe('executeTask — gate por risco', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // `clearAllMocks` zera CHAMADAS, não implementações — restaurar aqui é o que impede o
    // vazamento de mock entre casos que já mordeu o `voice.service.spec` em 20/09.
    ;(fileDelete as jest.Mock).mockResolvedValue({ deleted: true })
    ;(fileRead as jest.Mock).mockResolvedValue({ content: 'x' })
  })

  it('ação de risco alto sem aprovação é recusada antes de executar', async () => {
    aprovacao.mockResolvedValue({ ok: false, motivo: 'nenhuma aprovação pendente' })

    await expect(executeTask(tarefa('file_delete', { path: 'C:\\x\\y.txt' })))
      .rejects.toThrow(/risco alto e exige aprovação humana/)

    expect(fileDelete).not.toHaveBeenCalled()
  })

  it('ação de risco alto COM aprovação executa', async () => {
    aprovacao.mockResolvedValue({ ok: true, id: 'ap-1', createdBy: 'admin' })

    await executeTask(tarefa('file_delete', { path: 'C:\\x\\y.txt' }))

    expect(aprovacao).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'jarvis:file_delete' }),
      { taskId: 't1' },
    )
    expect(fileDelete).toHaveBeenCalled()
  })

  /**
   * Provar o negativo não basta — um gate que recusa tudo passa em todo teste negativo, que foi
   * a lição do login do HUB. Ação de risco baixo não pode ter ficado presa junto.
   */
  it('ação de risco baixo não pede aprovação nenhuma', async () => {
    await executeTask(tarefa('file_read', { path: 'C:\\x\\y.txt' }))

    expect(aprovacao).not.toHaveBeenCalled()
    expect(fileRead).toHaveBeenCalled()
  })

  /**
   * `dryRun` é a PRÉVIA que a regra da casa manda fazer antes de executar risco médio/alto.
   * Exigir aprovação para prever inverteria a regra: ninguém conseguiria ver o que vai
   * acontecer sem antes autorizar que aconteça.
   */
  it('dryRun de ação alta não exige aprovação', async () => {
    await executeTask(tarefa('file_delete', { path: 'C:\\x\\y.txt', dryRun: true }))

    expect(aprovacao).not.toHaveBeenCalled()
    expect(fileDelete).toHaveBeenCalled()
  })

  it('handoff de risco médio sem aprovação é recusado antes de criar pasta', async () => {
    aprovacao.mockResolvedValue({ ok: false, motivo: 'sem aprovação válida' })

    await expect(executeTask(tarefa('create_project_folder', {
      name: 'Fixture', root: 'C:\\Projects', handoffId: 'h1', contentHash: 'sha256',
    }))).rejects.toThrow(/efeito de handoff e exige aprovação humana/)

    expect(aprovacao).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'jarvis:create_project_folder', args: expect.objectContaining({ handoffId: 'h1' }) }),
      { taskId: 't1' },
    )
    expect(criarPasta).not.toHaveBeenCalled()
  })

  it('handoff de risco médio consome aprovação vinculada à tarefa antes do efeito', async () => {
    aprovacao.mockResolvedValue({ ok: true, id: 'ap-1', createdBy: 'approval-token:abc' })

    await executeTask(tarefa('create_project_folder', {
      name: 'Fixture', root: 'C:\\Projects', handoffId: 'h1', contentHash: 'sha256',
    }))

    expect(aprovacao).toHaveBeenCalledTimes(1)
    expect(criarPasta).toHaveBeenCalledTimes(1)
    expect(aprovacao.mock.invocationCallOrder[0]).toBeLessThan(criarPasta.mock.invocationCallOrder[0])
  })

  it('ação média fora de handoff continua sem gate; dryRun de handoff não consome', async () => {
    await executeTask(tarefa('create_project_folder', { name: 'Fixture', root: 'C:\\Projects' }))
    await executeTask(tarefa('create_project_folder', {
      name: 'Fixture', root: 'C:\\Projects', handoffId: 'h1', contentHash: 'sha256', dryRun: true,
    }))

    expect(aprovacao).not.toHaveBeenCalled()
    expect(criarPasta).toHaveBeenCalledTimes(2)
  })
})
