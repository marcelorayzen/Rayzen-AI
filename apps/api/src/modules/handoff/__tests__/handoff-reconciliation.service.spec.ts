import { HandoffService } from '../handoff.service'
import { HandoffReconciliationService } from '../handoff-reconciliation.service'

jest.mock('../../../common/system-heartbeat', () => ({ baterNaV2: jest.fn() }))

/**
 * O ciclo existe porque `reconciling` é estado de passagem.
 *
 * Sem alguém para resolvê-lo, o envelope fica ali para sempre dizendo "estou verificando"
 * sobre algo que ninguém verifica — a forma exata das três tarefas presas em `processing`
 * desde 17/06 que o A05 consertou. Deixar a resolução para uma chamada manual seria a família
 * do `setCostController()`, o wiring que ninguém lembrou e que manteve a V2 três meses sem
 * registrar custo.
 */
function cicloCom(handoffs: Partial<HandoffService>) {
  return new HandoffReconciliationService(handoffs as HandoffService)
}

describe('HandoffReconciliationService', () => {
  /**
   * Contador de execuções não é medida de trabalho — a lição do QA Scientist, que batia `ok`
   * todo dia sem produzir uma hipótese sequer. O detalhe separa "quieto porque está tudo bem"
   * de "quieto porque parou de chegar trabalho".
   */
  it('conta o que fez, para distinguir quieto-porque-ok de quieto-porque-parou', async () => {
    const ciclo = cicloCom({
      emReconciliacao: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
      reconciliar: jest.fn()
        .mockResolvedValueOnce({ status: 'completed' })
        .mockResolvedValueOnce({ status: 'effect_unknown' })
        .mockResolvedValueOnce({ status: 'reconciling' }),
    })

    expect(await ciclo.varrer()).toEqual({ varridos: 3, concluidos: 1, incertos: 1, semResposta: 1 })
  })

  /** Um envelope que falha não pode parar a varredura dos outros. */
  it('erro num envelope não interrompe os demais', async () => {
    const ciclo = cicloCom({
      emReconciliacao: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      reconciliar: jest.fn()
        .mockRejectedValueOnce(new Error('explodiu'))
        .mockResolvedValueOnce({ status: 'completed' }),
    })

    expect(await ciclo.varrer()).toEqual({ varridos: 2, concluidos: 1, incertos: 0, semResposta: 1 })
  })

  it('varredura vazia é saudável, e diz isso', async () => {
    const ciclo = cicloCom({ emReconciliacao: jest.fn().mockResolvedValue([]), reconciliar: jest.fn() })
    expect(await ciclo.varrer()).toEqual({ varridos: 0, concluidos: 0, incertos: 0, semResposta: 0 })
  })

  /**
   * A varredura que falha inteira ainda bate — em `finally`. Ciclo que lança antes de reportar
   * fica idêntico a ciclo que nunca subiu, que é o caso que mais importa aparecer no painel.
   */
  it('falha da varredura inteira não lança para quem chamou', async () => {
    const ciclo = cicloCom({
      emReconciliacao: jest.fn().mockRejectedValue(new Error('banco fora')),
      reconciliar: jest.fn(),
    })

    await expect(ciclo.varrer()).resolves.toEqual({ varridos: 0, concluidos: 0, incertos: 0, semResposta: 0 })
  })
})
