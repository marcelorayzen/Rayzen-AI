import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'
import { RotinaController } from '../rotina.controller'
import { RotinaService } from '../rotina.service'
import { EXECUCOES_GUARDADAS, validarGatilho, validarModelo } from '../rotina.const'

const MODELO = {
  titulo: 'Corrigir o CI do PR {{pr.numero}}',
  objetivo: 'O workflow que falhou volta a passar',
  restricoes: 'Só o que o erro do CI aponta',
  criterioDePronto: 'npm test passa no ramo do PR',
}

function prismaFalso() {
  return {
    project: { findUnique: jest.fn().mockResolvedValue({ id: 'proj-1' }) },
    rotina: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rot-1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'rot-1', status: 'ativa' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    rotinaExecucao: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ex-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  }
}

describe('regras do gatilho e do modelo', () => {
  it('agenda aceita de 5 min a uma semana, e só inteiro', () => {
    expect(validarGatilho({ tipo: 'agenda', intervaloMin: 5 })).toEqual({ tipo: 'agenda', intervaloMin: 5 })
    for (const n of [4, 0, 7.5, 7 * 24 * 60 + 1, '30']) {
      expect(() => validarGatilho({ tipo: 'agenda', intervaloMin: n })).toThrow(/intervaloMin/)
    }
  })

  it('GitHub aceita só os dois eventos do desenho, e ignora repositório no gatilho', () => {
    expect(validarGatilho({ tipo: 'github', evento: 'workflow_run.failure', repo: 'outro/repo' }))
      .toEqual({ tipo: 'github', evento: 'workflow_run.failure' })
    expect(() => validarGatilho({ tipo: 'github', evento: 'push' })).toThrow(/só/)
    expect(() => validarGatilho({ tipo: 'cron' })).toThrow(/agenda.*github/)
  })

  it('o modelo exige os mesmos três campos da proposta de sessão do Hub, todos de uma vez', () => {
    expect(validarModelo(MODELO)).toMatchObject({ ...MODELO, aprovacao: 'por_entrega' })
    expect(() => validarModelo({ titulo: 'x' })).toThrow(/objetivo.*restricoes.*criterioDePronto/)
  })
})

describe('RotinaService', () => {
  it('toda rotina nasce proposta, com quem criou', async () => {
    const prisma = prismaFalso()
    const r = await new RotinaService(prisma as never).criar(
      { projectId: 'proj-1', nome: 'CI do PR', gatilho: { tipo: 'github', evento: 'workflow_run.failure' }, modelo: MODELO },
      'mcp:hermes',
    )
    expect(r).toMatchObject({ status: 'proposta', criadaPor: 'mcp:hermes', projectId: 'proj-1' })
  })

  it('recusa o Geral, projeto inexistente, gatilho e modelo inválidos', async () => {
    const prisma = prismaFalso()
    const svc = new RotinaService(prisma as never)
    const base = { projectId: 'proj-1', nome: 'x', gatilho: { tipo: 'agenda', intervaloMin: 30 }, modelo: MODELO }
    await expect(svc.criar({ ...base, projectId: PROJETO_GERAL_ID }, 'p')).rejects.toBeInstanceOf(BadRequestException)
    await expect(svc.criar({ ...base, gatilho: { tipo: 'agenda', intervaloMin: 1 } }, 'p')).rejects.toBeInstanceOf(BadRequestException)
    await expect(svc.criar({ ...base, modelo: {} }, 'p')).rejects.toBeInstanceOf(BadRequestException)
    prisma.project.findUnique.mockResolvedValueOnce(null)
    await expect(svc.criar(base, 'p')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.rotina.create).not.toHaveBeenCalled()
  })

  it('aprovar só sai de proposta, de forma atômica, e grava quem aprovou', async () => {
    const prisma = prismaFalso()
    await new RotinaService(prisma as never).aprovar('rot-1', 'marcelo')
    expect(prisma.rotina.updateMany).toHaveBeenCalledWith({
      where: { id: 'rot-1', status: 'proposta' }, data: { status: 'ativa', aprovadaPor: 'marcelo' },
    })
  })

  it('transição fora de ordem é conflito, e rotina que não existe é 404', async () => {
    const prisma = prismaFalso()
    const svc = new RotinaService(prisma as never)
    prisma.rotina.updateMany.mockResolvedValue({ count: 0 })
    prisma.rotina.findUnique.mockResolvedValueOnce({ id: 'rot-1', status: 'ativa' })
    await expect(svc.aprovar('rot-1', 'marcelo')).rejects.toBeInstanceOf(ConflictException)
    prisma.rotina.findUnique.mockResolvedValueOnce(null)
    await expect(svc.pausar('nao-existe')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('pausar sai de ativa; retomar sai de pausada', async () => {
    const prisma = prismaFalso()
    const svc = new RotinaService(prisma as never)
    await svc.pausar('rot-1')
    await svc.retomar('rot-1')
    expect(prisma.rotina.updateMany.mock.calls.map(([a]) => [a.where.status, a.data.status]))
      .toEqual([['ativa', 'pausada'], ['pausada', 'ativa']])
  })

  it(`execução gravada poda o histórico para as últimas ${EXECUCOES_GUARDADAS}`, async () => {
    const prisma = prismaFalso()
    prisma.rotinaExecucao.findMany.mockResolvedValue([{ id: 'velha-1' }, { id: 'velha-2' }])
    await new RotinaService(prisma as never).registrarExecucao('rot-1', { origem: { repo: 'x/y' }, resultado: 'proposto' })
    expect(prisma.rotinaExecucao.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: EXECUCOES_GUARDADAS }))
    expect(prisma.rotinaExecucao.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['velha-1', 'velha-2'] } } })
  })

  it('listar traz as últimas execuções, mais recentes primeiro', async () => {
    const prisma = prismaFalso()
    await new RotinaService(prisma as never).listar('proj-1')
    expect(prisma.rotina.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'proj-1' },
      include: { execucoes: { orderBy: { disparadaEm: 'desc' }, take: EXECUCOES_GUARDADAS } },
    }))
  })
})

describe('RotinaController — aprovar e retomar só com pessoa', () => {
  const svc = { aprovar: jest.fn(), retomar: jest.fn(), pausar: jest.fn() }
  const disparo = { disparar: jest.fn() }
  const controller = new RotinaController(svc as never, disparo as never, {} as never)
  const servico = { headers: {}, rayzenPrincipal: { id: 'service:agent', type: 'service' as const } }
  const pessoa = { headers: {}, rayzenPrincipal: { id: 'marcelo', type: 'human' as const } }
  beforeEach(() => jest.clearAllMocks())

  it('serviço (inclusive o AGENT_TOKEN) não aprova nem retoma', () => {
    expect(() => controller.aprovar('rot-1', servico)).toThrow(ForbiddenException)
    expect(() => controller.retomar('rot-1', servico)).toThrow(ForbiddenException)
    expect(svc.aprovar).not.toHaveBeenCalled()
    expect(svc.retomar).not.toHaveBeenCalled()
  })

  it('"testar agora" também é só de pessoa, e dispara com origem manual', () => {
    expect(() => controller.testar('rot-1', servico)).toThrow(ForbiddenException)
    expect(disparo.disparar).not.toHaveBeenCalled()
    controller.testar('rot-1', pessoa)
    expect(disparo.disparar).toHaveBeenCalledWith('rot-1', { tipo: 'manual' })
  })

  it('pessoa aprova (gravando quem) e retoma; pausar não exige pessoa', () => {
    controller.aprovar('rot-1', pessoa)
    controller.retomar('rot-1', pessoa)
    controller.pausar('rot-1')
    expect(svc.aprovar).toHaveBeenCalledWith('rot-1', 'marcelo')
    expect(svc.retomar).toHaveBeenCalledWith('rot-1')
    expect(svc.pausar).toHaveBeenCalledWith('rot-1')
  })
})
