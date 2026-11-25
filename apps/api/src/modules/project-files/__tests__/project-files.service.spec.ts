import { ProjectFilesService, traduzirErro } from '../project-files.service'

describe('ProjectFilesService — leitura do checkout pelo agent (item 3)', () => {
  function montar(projeto: { id: string } | null, dispatch: jest.Mock) {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue(projeto) } }
    return { svc: new ProjectFilesService(prisma as never, { dispatch } as never), dispatch }
  }

  it('lista e lê despachando as ações de leitura com o projectId', async () => {
    const { svc, dispatch } = montar({ id: 'p1' }, jest.fn().mockResolvedValue({ ok: 1 }))
    await svc.listar('p1', 'src')
    await svc.ler('p1', 'src/a.ts')
    expect(dispatch).toHaveBeenNthCalledWith(1, 'project_list_files', { projectId: 'p1', path: 'src' })
    expect(dispatch).toHaveBeenNthCalledWith(2, 'project_read_file', { projectId: 'p1', path: 'src/a.ts' })
  })

  it('projeto inexistente é 404 e nada vai ao agent', async () => {
    const { svc, dispatch } = montar(null, jest.fn())
    await expect(svc.listar('x')).rejects.toMatchObject({ status: 404 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ler sem path é 400', async () => {
    const { svc } = montar({ id: 'p1' }, jest.fn())
    await expect(svc.ler('p1', '  ')).rejects.toMatchObject({ status: 400 })
  })

  it.each([
    ['Agent desktop offline (visto há 5min)', 503, 'agente_indisponivel'],
    ['Timeout aguardando o PC Agent executar a tarefa', 503, 'agente_indisponivel'],
    ['caminho fora do checkout do projeto', 400, 'caminho_fora_do_projeto'],
    ['o projeto p1 não tem checkout resolvível nesta máquina', 409, 'checkout_indisponivel'],
    ['algo inesperado', 502, 'leitura_falhou'],
  ])('traduz "%s" em %i', (msg, status, code) => {
    const e = traduzirErro(msg)
    expect(e.getStatus()).toBe(status)
    expect(e.getResponse()).toMatchObject({ code })
  })
})
