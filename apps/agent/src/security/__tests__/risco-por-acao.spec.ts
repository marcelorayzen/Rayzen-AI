import { readFileSync } from 'fs'
import { join } from 'path'
import { RISCO_POR_ACAO, riscoDaAcao, exigeAprovacaoHumana } from '../risco-por-acao.const'
import { ALLOWED_ACTIONS } from '../whitelist'

/**
 * Anti-drift por leitura, como `memory-ranking` e `event-derived-text`.
 *
 * A classificação canônica mora no registro da V2, junto com nome, categoria e schema — é de lá
 * que sai `docs/agent-actions.md`. O agent não importa da api-v2, então a tabela é duplicada, e
 * a divergência não daria erro nenhum: daria uma ação `high` na V2 executando sem gate aqui,
 * que é exatamente o defeito que a tabela existe para fechar.
 */
function riscosDoRegistroV2(): Record<string, string> {
  const fonte = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'api-v2', 'src', 'skill-engine', 'skill-registry.ts'),
    'utf8',
  )
  const re = /id:\s*'(jarvis:[a-z_]+)'[\s\S]{0,400}?risk:\s*'(none|low|medium|high)'/g
  const mapa: Record<string, string> = {}
  let m: RegExpExecArray | null
  while ((m = re.exec(fonte)) !== null) mapa[m[1]] = m[2]
  return mapa
}

describe('RISCO_POR_ACAO — a cópia não pode divergir do registro da V2', () => {
  const v2 = riscosDoRegistroV2()

  it('a extração do registro da V2 realmente encontrou as ações', () => {
    // Sem isto, um registro renomeado faria o regex casar zero e todas as comparações abaixo
    // passariam por vacuidade — o teste diria "não divergem" sobre um conjunto vazio.
    expect(Object.keys(v2).length).toBeGreaterThan(40)
  })

  it('as duas tabelas classificam exatamente as mesmas ações', () => {
    expect(Object.keys(RISCO_POR_ACAO).sort()).toEqual(Object.keys(v2).sort())
  })

  it.each(Object.keys(RISCO_POR_ACAO))('%s tem o mesmo risco nos dois lados', (acao) => {
    expect({ acao, risco: RISCO_POR_ACAO[acao] }).toEqual({ acao, risco: v2[acao] })
  })
})

describe('cobertura da whitelist', () => {
  /**
   * Ação despachável sem risco declarado passa pelo gate sem ser pesada. A direção importa:
   * `whitelist.spec.ts` já testa "toda ação documentada está na whitelist"; esta é a outra
   * ponta, a mesma lacuna que deixou `jarvis:guardian_analyze` sem handler.
   */
  it('toda ação da whitelist tem risco declarado', () => {
    const semRisco = [...ALLOWED_ACTIONS].filter((a) => riscoDaAcao(a) === undefined)
    expect(semRisco).toEqual([])
  })
})

describe('exigeAprovacaoHumana — só `high` interpõe uma pessoa', () => {
  it('exige aprovação para as ações de risco alto', () => {
    const altas = Object.keys(RISCO_POR_ACAO).filter((a) => RISCO_POR_ACAO[a] === 'high')
    expect(altas.length).toBeGreaterThan(0)
    for (const a of altas) expect(exigeAprovacaoHumana(riscoDaAcao(a))).toBe(true)
  })

  /**
   * `medium` fica de fora pela lição do Guardian: até 13/08 qualquer nível acima de `low` abria
   * gate, e como um service sem spec já valia o limiar, todo service tocado virava pedido de
   * aprovação. Gate que dispara sempre é gate que alguém desliga.
   */
  it.each(['none', 'low', 'medium'] as const)('não exige para risco %s', (r) => {
    expect(exigeAprovacaoHumana(r)).toBe(false)
  })

  /** Desconhecido não é `none`: quem chama precisa poder distinguir "sem risco" de "não sei". */
  it('ação fora da tabela devolve undefined, não um risco inventado', () => {
    expect(riscoDaAcao('jarvis:acao_que_nao_existe')).toBeUndefined()
  })
})
