import { ForbiddenException } from '@nestjs/common'
import { AgentSessionController } from '../agent-session.controller'

describe('AgentSessionController.stop — autorização humana', () => {
  const svc = { solicitarParada: jest.fn() }
  const controller = new AgentSessionController(svc as never)

  beforeEach(() => jest.clearAllMocks())

  it('recusa principal de serviço, incluindo o AGENT_TOKEN', () => {
    const request = { headers: {}, rayzenPrincipal: { id: 'service:agent', type: 'service' as const } }

    expect(() => controller.stop('sessao-1', request)).toThrow(ForbiddenException)
    expect(svc.solicitarParada).not.toHaveBeenCalled()
  })

  it('aceita somente o principal humano verificado pelo guard', () => {
    const request = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }

    controller.stop('sessao-1', request)

    expect(svc.solicitarParada).toHaveBeenCalledWith('sessao-1')
  })
})
