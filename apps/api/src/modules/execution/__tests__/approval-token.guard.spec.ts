import { ApprovalTokenGuard } from '../approval-token.guard'
import { UnauthorizedException } from '@nestjs/common'

/**
 * AUTOAPROVAÇÃO — a peça inteira da Fase 5-A.
 *
 * Criar exige `APPROVAL_TOKEN`; consumir exige `AGENT_TOKEN`. Com um guard só, o agent
 * alcançaria as duas rotas e a "aprovação humana" seria uma volta a mais no mesmo lugar.
 */
describe('ApprovalTokenGuard — autoaprovação é impossível por construção', () => {
  const ctx = (auth?: string) => ({
    switchToHttp: () => ({ getRequest: () => ({ headers: auth ? { authorization: auth } : {} }) }),
  }) as never

  const guard = new ApprovalTokenGuard()
  const orig = { ...process.env }
  afterEach(() => { process.env = { ...orig } })

  it('sem APPROVAL_TOKEN configurado a rota FECHA — não abre', () => {
    delete process.env.APPROVAL_TOKEN
    expect(() => guard.canActivate(ctx('Bearer qualquer'))).toThrow(UnauthorizedException)
  })

  /**
   * Apontar as duas variáveis para o mesmo valor desfaria a separação sem ninguém perceber —
   * pior que não ter separação, porque pareceria haver uma.
   */
  it('recusa quando APPROVAL_TOKEN é igual ao AGENT_TOKEN', () => {
    process.env.APPROVAL_TOKEN = 'mesmo-valor'
    process.env.AGENT_TOKEN    = 'mesmo-valor'
    expect(() => guard.canActivate(ctx('Bearer mesmo-valor'))).toThrow(/autoaprovar/)
  })

  it('o token do agent NÃO abre a rota de criação', () => {
    process.env.APPROVAL_TOKEN = 'segredo-de-aprovacao'
    process.env.AGENT_TOKEN    = 'token-do-agent'
    expect(() => guard.canActivate(ctx('Bearer token-do-agent'))).toThrow(UnauthorizedException)
  })

  it('o token de aprovação abre', () => {
    process.env.APPROVAL_TOKEN = 'segredo-de-aprovacao'
    process.env.AGENT_TOKEN    = 'token-do-agent'
    expect(guard.canActivate(ctx('Bearer segredo-de-aprovacao'))).toBe(true)
  })
})
