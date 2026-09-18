import { Test, TestingModule } from '@nestjs/testing'
import { CostsService } from '../costs.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { RayzenConfigService } from '../../configuration/configuration.service'

// 982.244 tokens de `project-state` — a fatia real medida em 19/08, que sozinha
// respondia por 84% do total exibido no painel.
const TOKENS_PROJECT_STATE = 982_244

const mockPrisma = {
  conversationMessage: { groupBy: jest.fn() },
  project: { findMany: jest.fn() },
}

const mockConfig = { getConfig: jest.fn() }

function comModulo(module: string, tokens: number) {
  mockPrisma.conversationMessage.groupBy
    .mockResolvedValueOnce([{ module, _sum: { tokensUsed: tokens }, _count: { id: 427 } }])
    .mockResolvedValueOnce([])
  mockPrisma.project.findMany.mockResolvedValue([])
}

describe('CostsService — o modelo do módulo vem da configuração, não de constante', () => {
  let service: CostsService

  beforeEach(async () => {
    jest.clearAllMocks()
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CostsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RayzenConfigService, useValue: mockConfig },
      ],
    }).compile()
    service = mod.get(CostsService)
  })

  it('com premiumStateRefresh=false, project-state custa como gpt-4o — não como premium', async () => {
    mockConfig.getConfig.mockReturnValue({ premiumStateRefresh: false })
    comModulo('project-state', TOKENS_PROJECT_STATE)

    const r = await service.summary('month')
    const linha = r.byModule[0]

    expect(linha.model).toBe('gpt-4o')
    // 982.244 × $0,70/1M
    expect(linha.costUSD).toBeCloseTo(0.6876, 3)

    // A regressão que este teste existe para barrar: o valor que o painel exibia.
    expect(linha.costUSD).not.toBeCloseTo(8.8402, 2)
  })

  it('com premiumStateRefresh=true, volta a custar como premium', async () => {
    mockConfig.getConfig.mockReturnValue({ premiumStateRefresh: true })
    comModulo('project-state', TOKENS_PROJECT_STATE)

    const r = await service.summary('month')
    expect(r.byModule[0].model).toBe('gpt-4o-premium')
    // 982.244 × $9,00/1M
    expect(r.byModule[0].costUSD).toBeCloseTo(8.8402, 2)
  })

  it('premiumStateRefresh ausente conta como false — é o default do project-state', async () => {
    mockConfig.getConfig.mockReturnValue({})
    comModulo('project-state', TOKENS_PROJECT_STATE)

    expect((await service.summary('month')).byModule[0].model).toBe('gpt-4o')
  })

  it('config indisponível não derruba o painel: cai no estático', async () => {
    mockConfig.getConfig.mockImplementation(() => { throw new Error('rayzen.config.json não encontrado') })
    comModulo('project-state', TOKENS_PROJECT_STATE)

    const r = await service.summary('month')
    expect(r.byModule[0].model).toBe('gpt-4o-premium')  // comportamento anterior, preservado
  })

  it('módulo de modelo estático não consulta a configuração', async () => {
    mockConfig.getConfig.mockReturnValue({ premiumStateRefresh: true })
    comModulo('documentation', 1_000_000)

    const r = await service.summary('month')
    expect(r.byModule[0].model).toBe('gpt-4o')
    expect(r.byModule[0].costUSD).toBeCloseTo(0.70, 4)
  })

  it('módulo desconhecido continua caindo em gpt-4o', async () => {
    mockConfig.getConfig.mockReturnValue({ premiumStateRefresh: false })
    comModulo('modulo-que-nao-existe', 1_000_000)

    expect((await service.summary('month')).byModule[0].model).toBe('gpt-4o')
  })
})
