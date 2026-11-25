import { ApprovalController } from '../approval.controller'
import { ApprovalTokenGuard } from '../approval-token.guard'
import { AgentTokenGuard } from '../../agent-bridge/agent-token.guard'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * A separacao dos DOIS GUARDS e a peca inteira da Fase 5-A.
 *
 * Criar aprovacao exige `APPROVAL_TOKEN`, que o agent nao possui. Consumir exige
 * `AGENT_TOKEN`, que ele possui. Com um guard so, o agent alcancaria as duas rotas e a
 * "aprovacao humana" seria uma volta a mais no mesmo lugar — que e exatamente o que o
 * `force: true` era.
 *
 * Por isso o teste principal aqui e sobre QUAL guard esta em QUAL rota. E o tipo de coisa
 * que um refactor bem-intencionado unifica "para simplificar" e destroi em silencio.
 */
describe('ApprovalController — guards diferentes por rota', () => {
  const guardsDe = (metodo: string): unknown[] =>
    Reflect.getMetadata('__guards__', (ApprovalController.prototype as never)[metodo]) ?? []

  it('criar exige APPROVAL_TOKEN — não o token do agent', () => {
    expect(guardsDe('criar')).toContain(ApprovalTokenGuard)
    expect(guardsDe('criar')).not.toContain(AgentTokenGuard)
  })

  it('consumir exige AGENT_TOKEN — quem executa é o agent', () => {
    expect(guardsDe('consumir')).toContain(AgentTokenGuard)
    expect(guardsDe('consumir')).not.toContain(ApprovalTokenGuard)
  })

  /**
   * Se um dia as duas rotas usarem o MESMO guard, a separacao morreu — e morreu em silencio,
   * porque tudo continua respondendo 200. Esta assercao e a que avisa.
   */
  it('as duas rotas NÃO compartilham guard', () => {
    const criar = guardsDe('criar')
    const consumir = guardsDe('consumir')
    expect(criar.some((g) => consumir.includes(g))).toBe(false)
  })

  /**
   * `@Public()` desliga o `JwtAuthGuard` GLOBAL — sem ele a criacao e impossivel, porque
   * `APPROVAL_TOKEN` e um hex de 64 e nao um JWT (medido em producao: 401 antes de chegar ao
   * guard da rota). Mas `@Public()` SEM guard por rota abriria tudo.
   *
   * As duas condicoes juntas, num teste so: e a combinacao que precisa se manter, nao cada
   * metade.
   */
  it('é @Public() E toda rota tem guard próprio — as duas coisas, sempre', () => {
    expect(Reflect.getMetadata('isPublic', ApprovalController)).toBe(true)
    for (const metodo of ['criar', 'consumir', 'pendentes']) {
      expect(guardsDe(metodo).length).toBeGreaterThan(0)
    }
  })
})

describe('ApprovalController — delega ao serviço sem reinterpretar', () => {
  function build() {
    const svc = {
      criar:           jest.fn().mockResolvedValue({ id: 'a1' }),
      consumir:        jest.fn().mockResolvedValue({ ok: true }),
      listarPendentes: jest.fn().mockResolvedValue([]),
    }
    return { svc, ctrl: new ApprovalController(svc as never) }
  }

  const principal = { id: 'approval-token:abc123', type: 'approval_token' as const }

  /**
   * A identidade vem do PRINCIPAL que o guard autenticou. Antes vinha do corpo — um campo de
   * auditoria preenchido por quem esta sendo auditado.
   */
  it('criar usa o principal do guard, ignorando qualquer createdBy no corpo', async () => {
    const { ctrl, svc } = build()
    const corpo = { actionKey: 'jarvis:run_command', actor: 'desktop', resource: '/r', args: { command: 'x' } }
    await ctrl.criar({ ...corpo, createdBy: 'marcelo-falsificado' } as never, { principal })
    expect(svc.criar).toHaveBeenCalledWith(corpo, principal, undefined)
  })

  /** Guard que parar de preencher o principal FECHA a rota, em vez de gravar anonimo. */
  it('sem principal, recusa em vez de gravar auditoria anônima', async () => {
    const { ctrl, svc } = build()
    expect(() => ctrl.criar({ actionKey: 'x', actor: 'desktop' }, {})).toThrow(/principal ausente/)
    expect(svc.criar).not.toHaveBeenCalled()
  })

  /** `args` ausente vira `{}` — nunca `undefined`, que mudaria o hash canônico. */
  it('args ausente vira objeto vazio, não undefined', async () => {
    const { ctrl, svc } = build()
    await ctrl.consumir({ actionKey: 'x', actor: 'desktop' })
    expect(svc.consumir.mock.calls[0][0].args).toEqual({})
  })
})

/**
 * O corpo nao pode influenciar a identidade gravada. A assercao e no CODIGO SEM COMENTARIOS —
 * a primeira versao deste teste lia o arquivo inteiro e falhou batendo na prosa que eu mesmo
 * escrevi explicando o conserto. Teste que casa com a documentacao vigia a prosa, e um dia
 * passa verde com o defeito de volta porque alguem apagou um comentario.
 */
describe('ApprovalController — identidade não vem do corpo', () => {
  const semComentarios = (arquivo: string) =>
    readFileSync(join(__dirname, '..', arquivo), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('o controller não lê createdBy do dto', () => {
    expect(semComentarios('approval.controller.ts')).not.toMatch(/dto\.createdBy/)
  })

  it('o guard não lê nada do corpo — só o header', () => {
    const guard = semComentarios('approval-token.guard.ts')
    expect(guard).not.toMatch(/req\.body|dto\./)
    expect(guard).toMatch(/req\.headers/)
  })
})
