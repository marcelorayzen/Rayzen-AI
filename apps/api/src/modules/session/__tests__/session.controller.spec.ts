import { SessionController } from '../session.controller'

describe('SessionController — retomada H1', () => {
  it('deriva o principal do request e nunca do projectId enviado pelo cliente', () => {
    const sessaoAtualDoPrincipal = jest.fn()
    const controller = new SessionController({ sessaoAtualDoPrincipal } as never)

    controller.atual('project-A', {
      headers: {},
      rayzenPrincipal: { id: 'marcelo', type: 'human' },
    })

    expect(sessaoAtualDoPrincipal).toHaveBeenCalledWith('marcelo', 'project-A')
  })

  it('mantém a rota testável sem pipeline HTTP, usando apenas o principal legado explícito', () => {
    const sessaoAtualDoPrincipal = jest.fn()
    const controller = new SessionController({ sessaoAtualDoPrincipal } as never)

    controller.atual(undefined)

    expect(sessaoAtualDoPrincipal).toHaveBeenCalledWith('legacy:unknown', null)
  })
})
