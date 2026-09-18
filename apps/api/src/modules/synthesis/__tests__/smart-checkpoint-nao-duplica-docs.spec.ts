import { readFileSync } from 'fs'
import { join } from 'path'
import { SmartCheckpointService } from '../smart-checkpoint.service'

/**
 * O auto-checkpoint regenerava TODOS os documentos duas vezes por gatilho.
 *
 * `SynthesisService.checkpoint()` termina disparando `generateAll(force: true)`, e o
 * `SmartCheckpointService` chamava `generateAll(force: true)` de novo logo depois —
 * duas execuções concorrentes, ambas com `force`, escrevendo as mesmas linhas de
 * `project_documents`.
 *
 * Medido em 2026-09-06 no Langfuse: `rayzen:v1:documentation` e o MAIOR consumidor de
 * LLM da plataforma (3.374 chamadas em 30 dias, mais que todos os outros modulos
 * somados), e naquele dia 285 das 519 falharam. Nada acusava: as duas chamadas sao
 * fire-and-forget com `.catch()` mudo.
 *
 * O custo nao e dinheiro — sao menos de dois centavos por mes. E cota: gerar em dobro
 * num free tier poe o grupo em cooldown de ~8min (`No deployments available ... Try
 * again in 497 seconds`) e derruba quem chegar depois.
 */
describe('SmartCheckpointService — nao duplica a geracao de documentos', () => {
  // SEM comentarios. A primeira versao deste teste leu o arquivo inteiro e falhou
  // batendo nas explicacoes que eu mesmo tinha acabado de escrever ("checkpoint() JA
  // dispara generateAll"). Teste que casa com a documentacao do conserto passa a
  // vigiar a prosa em vez do codigo — e um dia passa verde com o defeito de volta,
  // desde que alguem apague o comentario.
  const codigo = readFileSync(join(__dirname, '..', 'smart-checkpoint.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('nao chama generateAll — quem gera e o checkpoint', () => {
    expect(codigo).not.toMatch(/generateAll/)
  })

  /**
   * A injecao vinha por `forwardRef` e existia SO para a chamada removida. Mantida,
   * seria uma referencia circular viva esperando alguem usa-la de novo por engano —
   * e o defeito voltaria sem que nenhum teste falhasse.
   */
  it('nao injeta mais o DocumentationService', () => {
    expect(codigo).not.toMatch(/DocumentationService/)
    expect(codigo).not.toMatch(/forwardRef/)
  })

  /**
   * O gatilho continua chamando o checkpoint — remover a duplicata nao pode ter
   * removido o trabalho. Asserido no comportamento, nao no texto.
   */
  it('o gatilho ainda dispara o checkpoint, com a razao', async () => {
    const checkpoint = jest.fn().mockResolvedValue({})
    const prisma = {
      sessionArtifact: { findFirst: jest.fn().mockResolvedValue(null) },
      event: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, intent: 'note' })),
        ),
      },
    }
    const svc = new SmartCheckpointService(prisma as never, { checkpoint } as never)

    const r = await svc.checkProject('p1')

    expect(r).toEqual({ triggered: true, reason: 'activity_burst' })
    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(checkpoint).toHaveBeenCalledWith('p1', undefined, undefined, {
      autoTriggered: true,
      reason: 'activity_burst',
    })
  })

  it('abaixo do minimo de eventos nao dispara nada', async () => {
    const checkpoint = jest.fn()
    const prisma = {
      sessionArtifact: { findFirst: jest.fn().mockResolvedValue(null) },
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', intent: 'note' }]) },
    }
    const svc = new SmartCheckpointService(prisma as never, { checkpoint } as never)

    expect(await svc.checkProject('p1')).toEqual({ triggered: false })
    expect(checkpoint).not.toHaveBeenCalled()
  })
})
