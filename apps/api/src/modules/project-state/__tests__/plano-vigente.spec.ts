import { proximoPassoDoPlano } from '../project-state.service'

describe('plano vigente', () => {
  it('prioriza a primeira tarefa aberta declarada pelo plano', () => {
    expect(proximoPassoDoPlano({
      source: 'docs/plano-duas-trilhas.md',
      status: 'ativa',
      nextSteps: ['A1.0 O plano manda, o Rayzen espelha', 'A1.1 O pacote do Hub leva sempre a fila'],
    })).toBe('A1.0 O plano manda, o Rayzen espelha')
  })

  it('não declara próximo passo quando o plano está concluído', () => {
    expect(proximoPassoDoPlano({
      source: 'docs/plano-duas-trilhas.md',
      status: 'concluida',
      nextSteps: ['A3.1 Web Studio'],
    })).toBeNull()
  })
})
