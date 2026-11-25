import { readFileSync } from 'fs'
import { join } from 'path'
import { SmartCheckpointService } from '../smart-checkpoint.service'
import { baterNaV2 } from '../../../common/system-heartbeat'

jest.mock('../../../common/system-heartbeat', () => ({ baterNaV2: jest.fn() }))

/**
 * A sintese e os documentos tem ritmos naturais OPOSTOS.
 *
 * O `session_artifact` e "o que aconteceu desde o ultimo checkpoint" — janela curta,
 * faz sentido a cada 10min. Os documentos sao um rollup de 30 DIAS. Regenerar o
 * rollup a cada disparo era o que fazia `rayzen:v1:documentation` ser o maior
 * consumidor de LLM da plataforma.
 *
 * O piso de 1h mora no `generate()`; aqui so se decide QUEM tem direito de fura-lo.
 */
describe('checkpoint — quem fura o piso de frescor dos documentos', () => {
  const codigo = readFileSync(join(__dirname, '..', 'synthesis.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '')

  it('pedido humano e decisao furam; burst e tempo decorrido nao', () => {
    // Assercao no CODIGO da regra, sem comentarios: `checkpoint()` dispara a geracao
    // fire-and-forget, entao nao ha retorno para observar sem montar o servico inteiro.
    expect(codigo).toMatch(/const pedidoHumano\s*=\s*!meta\?\.autoTriggered/)
    expect(codigo).toMatch(/const ehDecisao\s*=\s*meta\?\.reason === 'decision_detected'/)
    expect(codigo).toMatch(/ignorarFrescor:\s*pedidoHumano \|\| ehDecisao/)
  })

  /**
   * `force: true` continua indo — o caminho automatico PRECISA sobrescrever documento
   * revisado a mao. Era exatamente por isso que os dois flags nao podiam ser um so.
   */
  it('o caminho automatico continua passando force', () => {
    expect(codigo).toMatch(/generateAll\(projectId,\s*\{\s*force:\s*true/)
  })
})

/**
 * O ciclo era o maior consumidor de LLM da plataforma e nao aparecia em painel
 * nenhum: se parasse, ninguem saberia. Mesmo silencio que deixou o agent desktop 28h
 * fora em 2026-09-05.
 *
 * Bate por HTTP em `POST /v2/system/heartbeat` — a V1 nao escreve no schema `v2`, e
 * nao e para comecar.
 */
describe('SmartCheckpointService — batimento no painel', () => {
  beforeEach(() => (baterNaV2 as jest.Mock).mockClear())

  function build(projetos: string[], triggered: boolean) {
    const prisma = {
      project: { findMany: jest.fn().mockResolvedValue(projetos.map((id) => ({ id }))) },
      sessionArtifact: { findFirst: jest.fn().mockResolvedValue(null) },
      event: {
        findMany: jest.fn().mockResolvedValue(
          triggered ? Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, intent: 'note' })) : [],
        ),
      },
    }
    return new SmartCheckpointService(prisma as never, { checkpoint: jest.fn() } as never)
  }

  const rodar = (svc: SmartCheckpointService) =>
    (svc as unknown as { checkAll: () => Promise<void> }).checkAll()

  /**
   * Varrer 3 projetos e nao disparar nenhum e SAUDAVEL — mas indistinguivel de um
   * ciclo parado se o batimento so disser "executei". Foi assim que o QA Scientist
   * reportou `{ ciclos: 10 }` com ok:true por 13 dias sem fazer nada.
   */
  it('detalhe separa varridos de disparados', async () => {
    await rodar(build(['p1', 'p2', 'p3'], false))

    expect(baterNaV2).toHaveBeenCalledWith('auto-checkpoint', {
      ok: true, erro: undefined, detalhe: { varridos: 3, disparados: 0 },
    })
  })

  it('conta os que dispararam', async () => {
    await rodar(build(['p1', 'p2'], true))

    expect(baterNaV2).toHaveBeenCalledWith('auto-checkpoint', {
      ok: true, erro: undefined, detalhe: { varridos: 2, disparados: 2 },
    })
  })

  /** `finally`: ciclo que lanca antes de reportar fica identico a um que nunca subiu. */
  it('bate mesmo quando a varredura explode', async () => {
    const prisma = { project: { findMany: jest.fn().mockRejectedValue(new Error('prisma caiu')) } }
    const svc = new SmartCheckpointService(prisma as never, { checkpoint: jest.fn() } as never)

    await rodar(svc)

    expect(baterNaV2).toHaveBeenCalledWith('auto-checkpoint', {
      ok: false, erro: 'prisma caiu', detalhe: { varridos: 0, disparados: 0 },
    })
  })
})
