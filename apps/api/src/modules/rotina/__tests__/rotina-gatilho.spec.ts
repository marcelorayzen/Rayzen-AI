import { BadRequestException } from '@nestjs/common'
import { RotinaGatilhoService } from '../rotina-gatilho.service'

/**
 * G6, fatia 6 — evento do GitHub para as rotinas. A api revalida a forma dos campos, só aceita
 * repositório do Marcelo, acha o projeto pelo repoSlug e dispara só as rotinas que casam.
 */
function cenario(rotinas: Array<Record<string, unknown>>, projeto: { id: string } | null = { id: 'proj-1' }) {
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue(projeto) },
    rotina: { findMany: jest.fn().mockResolvedValue(rotinas) },
  }
  const disparo = { disparar: jest.fn().mockResolvedValue({ resultado: 'proposto', envelopeId: 'env-1' }) }
  return { svc: new RotinaGatilhoService(prisma as never, disparo as never), prisma, disparo }
}

const FALHA_DE_CI = {
  evento: 'workflow_run.failure' as const,
  repo: 'marcelorayzen/rayzen-marcenaria',
  autor: 'marcelorayzen',
  numero: 7,
  ramo: 'feature/pr-7',
  sha: 'abc1234',
  workflow: 'ci',
  url: 'https://github.com/marcelorayzen/rayzen-marcenaria/actions/runs/1',
}

describe('RotinaGatilhoService.receber', () => {
  it('dispara só a rotina ativa cujo evento casa, partindo do ramo do PR e com chave do evento', async () => {
    const { svc, disparo, prisma } = cenario([
      { id: 'ci', gatilho: { tipo: 'github', evento: 'workflow_run.failure' } },
      { id: 'pr', gatilho: { tipo: 'github', evento: 'pull_request.opened' } },
      { id: 'agenda', gatilho: { tipo: 'agenda', intervaloMin: 30 } },
    ])

    const r = await svc.receber(FALHA_DE_CI)

    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { repoSlug: { equals: 'rayzen-marcenaria', mode: 'insensitive' } },
    }))
    expect(disparo.disparar).toHaveBeenCalledTimes(1)
    expect(disparo.disparar).toHaveBeenCalledWith('ci', expect.objectContaining({
      tipo: 'github',
      baseRef: 'feature/pr-7',
      chave: 'marcelorayzen/rayzen-marcenaria#workflow_run.failure#abc1234#ci',
      valores: expect.objectContaining({ 'pr.numero': 7, 'pr.ramo': 'feature/pr-7', workflow: 'ci' }),
    }))
    expect(r).toMatchObject({ projeto: 'proj-1', disparos: [{ rotinaId: 'ci', resultado: 'proposto' }] })
  })

  it('repositório de outro dono não dispara nada (decisão 4 do desenho)', async () => {
    const { svc, disparo } = cenario([{ id: 'ci', gatilho: { tipo: 'github', evento: 'workflow_run.failure' } }])
    await expect(svc.receber({ ...FALHA_DE_CI, repo: 'estranho/rayzen-marcenaria' })).rejects.toBeInstanceOf(BadRequestException)
    expect(disparo.disparar).not.toHaveBeenCalled()
  })

  it('repositório público: PR aberto por outra pessoa, ou sem autor, não dispara', async () => {
    const { svc, disparo } = cenario([{ id: 'ci', gatilho: { tipo: 'github', evento: 'workflow_run.failure' } }])
    await expect(svc.receber({ ...FALHA_DE_CI, autor: 'estranho' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(svc.receber({ ...FALHA_DE_CI, autor: undefined })).rejects.toBeInstanceOf(BadRequestException)
    expect(disparo.disparar).not.toHaveBeenCalled()
  })

  it('campo fora da forma estrutural recusa o evento inteiro', async () => {
    const { svc, disparo } = cenario([])
    for (const ruim of [
      { ...FALHA_DE_CI, ramo: '--upload-pack=x' },
      { ...FALHA_DE_CI, ramo: 'a..b' },
      { ...FALHA_DE_CI, sha: 'abc 123' },
      { ...FALHA_DE_CI, repo: 'sem-barra' },
      { ...FALHA_DE_CI, evento: 'push' as never },
    ]) {
      await expect(svc.receber(ruim)).rejects.toBeInstanceOf(BadRequestException)
    }
    expect(disparo.disparar).not.toHaveBeenCalled()
  })

  it('repositório sem projeto no Rayzen não é erro: nada a disparar', async () => {
    const { svc, disparo } = cenario([], null)
    expect(await svc.receber(FALHA_DE_CI)).toEqual({ projeto: null, disparos: [] })
    expect(disparo.disparar).not.toHaveBeenCalled()
  })
})
