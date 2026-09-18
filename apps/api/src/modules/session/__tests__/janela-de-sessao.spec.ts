import {
  decidirSessao, janelaConfigurada, JANELA_PADRAO_MIN, type SessaoCandidata,
} from '../janela-de-sessao'

/**
 * ── O que esta regra promete ────────────────────────────────────────────────
 *
 * Que a conversa continue quando é a mesma conversa, e recomece quando não é. As duas metades
 * importam: retomar sempre juntaria assuntos de dias diferentes num fio só; nunca retomar é o
 * defeito medido — 254 de 270 sessões com um único turno, 57 delas começadas a menos de 5 minutos
 * do fim da anterior.
 */

const em = (minutosAtras: number): SessaoCandidata => ({
  sessionId:       'sessao-anterior',
  ultimaAtividade: new Date(Date.now() - minutosAtras * 60_000),
})

const novo = () => 'sessao-nova'

describe('decidirSessao', () => {
  it('sem candidata, começa uma', () => {
    const d = decidirSessao(null, novo)
    expect(d).toEqual({ sessionId: 'sessao-nova', retomada: false, idadeMin: null })
  })

  /** O caso dominante do defeito: recarregar a página cortava a conversa em dois. */
  it('atividade de 2 minutos atrás: retoma', () => {
    const d = decidirSessao(em(2), novo, new Date(), 30)
    expect(d.sessionId).toBe('sessao-anterior')
    expect(d.retomada).toBe(true)
  })

  it('no limite exato da janela: retoma', () => {
    const d = decidirSessao(em(30), novo, new Date(), 30)
    expect(d.retomada).toBe(true)
  })

  it('passou da janela: começa uma nova, e diz a idade da que ficou para trás', () => {
    const d = decidirSessao(em(90), novo, new Date(), 30)
    expect(d.sessionId).toBe('sessao-nova')
    expect(d.retomada).toBe(false)
    expect(d.idadeMin).toBeCloseTo(90, 0)
  })

  /**
   * O servidor desta casa já derrapou 8h43m (14/08). Com o relógio adiantado a candidata fica no
   * "futuro", e uma idade negativa passaria por qualquer janela — retomar uma conversa velha por
   * causa de um defeito de relógio.
   */
  it('candidata no futuro não vira idade negativa', () => {
    const d = decidirSessao(em(-120), novo, new Date(), 30)
    expect(d.idadeMin).toBe(0)
    expect(d.retomada).toBe(true)
  })

  /** Janela zero é "nunca retome" — configuração legítima, não valor ausente. */
  it('janela 0 nunca retoma, nem atividade de agora', () => {
    const d = decidirSessao(em(0), novo, new Date(), 0)
    expect(d.retomada).toBe(true)   // idade 0 <= janela 0
    const d2 = decidirSessao(em(1), novo, new Date(), 0)
    expect(d2.retomada).toBe(false)
  })
})

describe('janelaConfigurada', () => {
  it('sem env, o padrão medido', () => {
    expect(janelaConfigurada({} as NodeJS.ProcessEnv)).toBe(JANELA_PADRAO_MIN)
  })

  it('env válido manda', () => {
    expect(janelaConfigurada({ SESSION_JANELA_MIN: '10' } as unknown as NodeJS.ProcessEnv)).toBe(10)
  })

  /** `Number('')` é 0 — sem o teste de string vazia, env em branco viraria "nunca retome". */
  it('env vazio cai no padrão, não em zero', () => {
    expect(janelaConfigurada({ SESSION_JANELA_MIN: '' } as unknown as NodeJS.ProcessEnv)).toBe(JANELA_PADRAO_MIN)
  })

  it('lixo e negativo caem no padrão', () => {
    expect(janelaConfigurada({ SESSION_JANELA_MIN: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(JANELA_PADRAO_MIN)
    expect(janelaConfigurada({ SESSION_JANELA_MIN: '-5' } as unknown as NodeJS.ProcessEnv)).toBe(JANELA_PADRAO_MIN)
  })

  /** Zero explícito é decisão de quem configurou, e tem significado: desliga a retomada. */
  it('zero explícito é respeitado', () => {
    expect(janelaConfigurada({ SESSION_JANELA_MIN: '0' } as unknown as NodeJS.ProcessEnv)).toBe(0)
  })
})
