import { BadRequestException } from '@nestjs/common'
import { ehCaminhoDeCheckoutValido } from '../checkout-do-projeto.const'
import { ProjectService } from '../../modules/project/project.service'

/**
 * ── O vínculo entre o registro e o disco era heurístico ─────────────────────
 *
 * `jarvis:create_project_folder` cria a pasta com o nome CRU e registra o projeto com o slug
 * em kebab, e nada guardava onde o checkout ficou. Resolver "qual pasta é deste projeto"
 * virava casamento de nome, com `repo-slug.mjs` devolvendo duas grafias para compensar.
 *
 * Medido em 24/09 na máquina de trabalho: **3 dos 6 projetos reais** têm pasta diferente do
 * slug (`Alfa soluções`/`alfa-solues`, `Rayzen Commerce Platform`/`rayzen-commerce-platform`,
 * `VB-ferragens`/`vb_ferragens`). Funcionava por tolerância, não por construção — e a Fase 4
 * pede reconciliação entre filesystem, catálogo e Git, que exige vínculo exato.
 */
describe('ehCaminhoDeCheckoutValido', () => {
  it.each([
    'C:\\Users\\dev\\Projects\\rayzen-ai',
    'C:/Users/dev/Projects/rayzen-ai',
    '/home/rayzen/projects/rayzen-ai',
    '\\\\servidor\\share\\projeto',
  ])('aceita caminho absoluto: %s', (c) => {
    expect(ehCaminhoDeCheckoutValido(c)).toBe(true)
  })

  /**
   * Caminho relativo só significa alguma coisa junto com o `cwd` de quem o escreveu, e esse
   * `cwd` não é gravado em lugar nenhum. Guardá-lo seria guardar a resposta de uma pergunta
   * perdida — pior que nulo, porque parece resposta.
   */
  it.each(['Projects/rayzen-ai', './rayzen-ai', '../rayzen-ai', 'rayzen-ai', '', '   '])(
    'recusa caminho que não localiza nada sozinho: %s',
    (c) => {
      expect(ehCaminhoDeCheckoutValido(c)).toBe(false)
    },
  )
})

function build() {
  const prisma = {
    project: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p1', ...data })),
    },
  }
  const notion = { createProjectPage: jest.fn().mockResolvedValue({ id: 'n1' }) }
  return { service: new ProjectService(prisma as never, notion as never), prisma }
}

describe('ProjectService — checkoutPath é validado na escrita', () => {
  it('grava o caminho absoluto na criação', async () => {
    const { service, prisma } = build()
    await service.create({ name: 'Projeto X', checkoutPath: 'C:\\Users\\dev\\Projects\\projeto-x' })

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ checkoutPath: 'C:\\Users\\dev\\Projects\\projeto-x' }),
    })
  })

  /**
   * Mesma disciplina do `domain` e do `status`: valor inválido é recusado, não ignorado.
   * Aceitar em silêncio produziria o efeito colateral certo pelo motivo errado — um vínculo
   * gravado que nunca resolve, e nada acusando.
   */
  it('recusa caminho relativo na criação', async () => {
    const { service, prisma } = build()
    await expect(service.create({ name: 'Projeto X', checkoutPath: 'Projects/projeto-x' }))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.project.create).not.toHaveBeenCalled()
  })

  it('recusa caminho relativo na atualização', async () => {
    const { service, prisma } = build()
    await expect(service.update('p1', { checkoutPath: './outro' }))
      .rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  /** Desclassificar é legítimo: `null` diz "não sei mais onde está", que pode ser a verdade. */
  it('aceita null para esquecer onde está', async () => {
    const { service, prisma } = build()
    await service.update('p1', { checkoutPath: null })
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { checkoutPath: null } })
  })

  it('não exige o campo — projeto antigo continua sendo atualizável', async () => {
    const { service, prisma } = build()
    await service.update('p1', { name: 'Outro nome' })
    expect(prisma.project.update).toHaveBeenCalled()
  })
})
