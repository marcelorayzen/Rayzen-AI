import { Test, TestingModule } from '@nestjs/testing'
import { readFileSync } from 'fs'
import { join } from 'path'
import { OPCAO_NAO_PUBLICAR, PendingReplyService, recusaPublicacao } from '../pending-reply.service'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * ── A06 da auditoria de 13/09 ─────────────────────────────────────────────────
 *
 * O roteamento da resposta humana era um callback global em memória. Este serviço o substitui
 * por uma consulta ao estado que já era persistido (`AgentSession.status === 'waiting'`), o que
 * resolve de uma vez a colisão entre sessões e a perda no restart.
 *
 * A regra mais importante aqui é o que ele **se recusa** a fazer: com duas pendências, não
 * escolhe. Escolher "a mais recente" mandaria a aprovação de uma etapa de código para o
 * trabalho errado — e o custo de errar é assimétrico, porque do outro lado há um `Bash(git
 * commit:*)` liberado.
 */
describe('PendingReplyService', () => {
  let service: PendingReplyService
  let prisma: { agentSession: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock } }

  const sessaoA = { id: 'aaaa1111-0000-0000-0000-000000000000', projectId: 'p1', pendingQuestion: 'Etapa A concluída' }
  const sessaoB = { id: 'bbbb2222-0000-0000-0000-000000000000', projectId: 'p2', pendingQuestion: 'Etapa B concluída' }

  beforeEach(async () => {
    jest.clearAllMocks()
    prisma = {
      agentSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [PendingReplyService, { provide: PrismaService, useValue: prisma }],
    }).compile()

    service = mod.get(PendingReplyService)
  })

  describe('resolver', () => {
    it('sem pendência nenhuma, a mensagem não é sequestrada', async () => {
      prisma.agentSession.findMany.mockResolvedValue([])

      expect(await service.resolver('oi, tudo bem?')).toEqual({ tipo: 'nenhuma' })
    })

    it('com uma pendência, a resposta vai para ela', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA])

      expect(await service.resolver('pode continuar')).toEqual({
        tipo: 'unica',
        sessionId: sessaoA.id,
        reply: 'pode continuar',
      })
    })

    it('com DUAS pendências, não adivinha — devolve ambígua', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA, sessaoB])

      const r = await service.resolver('pode continuar')

      expect(r.tipo).toBe('ambigua')
      expect((r as { sessoes: unknown[] }).sessoes).toHaveLength(2)
    })

    it('o prefixo com id curto endereça explicitamente, mesmo havendo duas', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA, sessaoB])

      expect(await service.resolver('bbbb2222: pode continuar')).toEqual({
        tipo: 'unica',
        sessionId: sessaoB.id,
        reply: 'pode continuar',
      })
    })

    it('o prefixo também vale quando há só uma — endereçar nunca atrapalha', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA])

      expect(await service.resolver('aaaa1111: ok')).toEqual({
        tipo: 'unica',
        sessionId: sessaoA.id,
        reply: 'ok',
      })
    })

    /**
     * O caso que separa "endereçamento" de "resposta que por acaso tem dois-pontos". Sem isto,
     * uma instrução legítima seria partida ao meio e perderia a primeira palavra.
     */
    it('dois-pontos numa resposta comum NÃO é prefixo de endereçamento', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA])

      expect(await service.resolver('faça assim: use cache em memória')).toEqual({
        tipo: 'unica',
        sessionId: sessaoA.id,
        reply: 'faça assim: use cache em memória',
      })
    })

    it('prefixo que não casa com sessão nenhuma não vira endereçamento', async () => {
      prisma.agentSession.findMany.mockResolvedValue([sessaoA, sessaoB])

      const r = await service.resolver('cccc9999: pode continuar')

      expect(r.tipo).toBe('ambigua')
    })
  })

  describe('responder', () => {
    it('grava a resposta e tira a sessão de waiting', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ id: sessaoA.id, status: 'waiting' })

      expect(await service.responder(sessaoA.id, 'ok')).toBe(true)
      expect(prisma.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sessaoA.id },
          data: expect.objectContaining({ pendingReply: 'ok', status: 'active' }),
        }),
      )
    })

    /** Mensagem repetida no celular não pode aprovar de novo uma etapa que já passou. */
    it('responder duas vezes não tem efeito na segunda', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ id: sessaoA.id, status: 'active' })

      expect(await service.responder(sessaoA.id, 'ok')).toBe(false)
      expect(prisma.agentSession.update).not.toHaveBeenCalled()
    })

    it('sessão inexistente não grava nada', async () => {
      prisma.agentSession.findUnique.mockResolvedValue(null)

      expect(await service.responder('nao-existe', 'ok')).toBe(false)
      expect(prisma.agentSession.update).not.toHaveBeenCalled()
    })

    // 21/11 (aceite do G6): a recusa de publicar fica registrada pela API, com quem recusou.
    const PORTAO = { id: sessaoA.id, status: 'waiting', pendingRequiresApproval: true, pendingApprovalOptions: ['Aprovado, mesclar', 'Aprovado, só abrir PR', 'Não publicar'] }

    it('"Não publicar" no portão do diff grava a recusa com quem respondeu', async () => {
      prisma.agentSession.findUnique.mockResolvedValue(PORTAO)
      await service.responder(sessaoA.id, 'Não publicar', 'hub:8c69')
      expect(prisma.agentSession.update.mock.calls[0][0].data).toMatchObject({
        pendingReply: 'Não publicar', publicacaoRecusadaPor: 'hub:8c69', publicacaoRecusadaEm: expect.any(Date),
      })
    })

    it.each([
      ['aprovação', 'Aprovado, só abrir PR', PORTAO],
      ['texto livre que o agent pode ler como recusa', 'não, espera', PORTAO],
      ['"Não publicar" numa pergunta que não é o portão', 'Não publicar', { ...PORTAO, pendingRequiresApproval: false }],
      ['opções sem "Não publicar"', 'Não publicar', { ...PORTAO, pendingApprovalOptions: ['Sim', 'Não'] }],
    ])('%s não grava recusa', async (_caso, resposta, sessao) => {
      prisma.agentSession.findUnique.mockResolvedValue(sessao)
      await service.responder(sessaoA.id, resposta, 'hub:8c69')
      expect(prisma.agentSession.update.mock.calls[0][0].data).not.toHaveProperty('publicacaoRecusadaEm')
    })
  })
})

describe('recusaPublicacao', () => {
  const COM_MERGE = ['Aprovado, mesclar', 'Aprovado, só abrir PR', 'Não publicar']
  const SEM_MERGE = ['Aprovado, publicar', 'Não publicar']

  it.each([
    ['Não publicar', COM_MERGE, true],
    ['  Não publicar ', SEM_MERGE, true],
    ['3', COM_MERGE, true],
    ['2', SEM_MERGE, true],
    // O índice segue as opções mostradas: com merge, "2" é "só abrir PR".
    ['2', COM_MERGE, false],
    ['1', SEM_MERGE, false],
    ['não publicar, mas guarda', COM_MERGE, false],
    ['Não publicar', null, false],
  ])('%j em %j → %s', (resposta, opcoes, esperado) => {
    expect(recusaPublicacao(resposta as string, opcoes)).toBe(esperado)
  })

  it('o rótulo é o mesmo que o agent oferece (anti-drift)', () => {
    const fonte = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'agent', 'src', 'exec', 'mesclar-entrega.ts'), 'utf8')
    for (const lista of ['OPCOES_COM_MERGE', 'OPCOES_SEM_MERGE']) {
      const m = fonte.match(new RegExp(`export const ${lista} = \\[([^\\]]*)\\]`))
      expect(m?.[1]).toContain(`'${OPCAO_NAO_PUBLICAR}'`)
    }
  })
})
