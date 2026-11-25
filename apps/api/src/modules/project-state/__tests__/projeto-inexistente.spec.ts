import { NotFoundException } from '@nestjs/common'
import { ProjectStateService } from '../project-state.service'

/**
 * ── H2 / C09: "erro de consulta não vira ausência de conhecimento" ───────────
 *
 * `GET /projects/<uuid inexistente>/state` devolvia **HTTP 200 com `null`**. Medido contra o
 * Hermes: perguntado pelo estado de um id que não existe, ele respondeu com o estado do projeto
 * DEFAULT do ambiente, sem qualquer aviso de que o id não existia.
 *
 * `200 + null` é a pior resposta possível — não é erro, então ninguém trata; e não é dado, então
 * quem consome preenche a lacuna. "Não encontrei" e "não consegui consultar" colapsam no mesmo
 * silêncio, que é exatamente o que o critério proíbe.
 *
 * A correção precisa ser fina, e o motivo é que `null` **tem** um significado legítimo aqui:
 * projeto real que ainda não teve estado sintetizado. Quatro consumidores dependem disso — o
 * `rayzen-context-hook` (fallback), as duas pontas do MCP (`get_state` e a leitura do
 * `update_planning`) e a página da web. Transformar tudo em 404 consertaria um caso e quebraria
 * quatro.
 *
 * Daí a distinção: **404 quando o PROJETO não existe** (id errado, erro de quem chamou);
 * `null` quando o projeto existe e o estado ainda não foi gerado.
 */
describe('ProjectStateService.get — id inexistente não se confunde com estado ausente', () => {
  function build(opts: { state?: unknown; projeto?: unknown }) {
    const prisma = {
      projectState: { findUnique: jest.fn().mockResolvedValue(opts.state ?? null) },
      project: { findUnique: jest.fn().mockResolvedValue(opts.projeto ?? null) },
    }
    const cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) }

    const svc = Object.create(ProjectStateService.prototype) as ProjectStateService
    Object.assign(svc, { prisma, cache })
    return { svc, prisma }
  }

  it('projeto que NÃO existe → 404, nunca um resultado vazio silencioso', async () => {
    const { svc } = build({ state: null, projeto: null })

    await expect(svc.get('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('a mensagem do 404 nomeia o projeto pedido — quem consome precisa saber qual id falhou', async () => {
    const { svc } = build({ state: null, projeto: null })

    await expect(svc.get('id-que-nao-existe')).rejects.toThrow(/id-que-nao-existe/)
  })

  /**
   * O caso legítimo, e o que impede a correção de virar uma regressão: projeto de verdade que
   * ainda não teve estado sintetizado continua devolvendo `null`.
   */
  it('projeto que existe mas ainda não tem estado → null, como antes', async () => {
    const { svc } = build({ state: null, projeto: { id: 'proj-1' } })

    await expect(svc.get('proj-1')).resolves.toBeNull()
  })

  it('projeto com estado não paga a consulta extra de existência', async () => {
    const agora = new Date()
    const { svc, prisma } = build({
      state: {
        id: 's1', projectId: 'proj-1', objective: 'x', stage: 'building',
        milestones: [], backlog: [], blockers: [], risks: [], nextSteps: [],
        activeFocus: '', definitionOfDone: '',
        updatedAt: agora, contentChangedAt: agora,
      },
      projeto: { id: 'proj-1' },
    })

    await svc.get('proj-1')

    expect(prisma.project.findUnique).not.toHaveBeenCalled()
  })
})
