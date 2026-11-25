import { readFileSync } from 'fs'
import { join } from 'path'
import { ISOLAMENTO_POR_EFEITO, isolamentoDoEfeito } from '../isolamento-por-efeito.const'

/** As ações que a V1 sabe despachar, lidas do `ACTION_ROLE` — mesma app, sem cópia. */
function acoesDespachaveis(): string[] {
  const fonte = readFileSync(
    join(__dirname, '..', '..', 'execution', 'execution.service.ts'),
    'utf8',
  )
  const bloco = fonte.slice(fonte.indexOf('const ACTION_ROLE'), fonte.indexOf('@Injectable'))
  return [...bloco.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1])
}

describe('ISOLAMENTO_POR_EFEITO', () => {
  const acoes = acoesDespachaveis()

  it('a leitura do ACTION_ROLE encontrou as ações de verdade', () => {
    // Sem isto, um `ACTION_ROLE` renomeado faria o regex casar zero e a cobertura abaixo
    // passaria por vacuidade — dizendo "todas cobertas" sobre um conjunto vazio.
    expect(acoes.length).toBeGreaterThan(40)
  })

  /**
   * Sem default e sem heurística: efeito novo sem decisão reprova aqui, em vez de herdar em
   * silêncio a proteção — ou a falta dela — de outro. É a mesma disciplina das estratégias de
   * `executarPrograma()`.
   */
  it('toda ação despachável tem isolamento declarado', () => {
    const semDeclaracao = acoes.filter((a) => isolamentoDoEfeito(a) === undefined)
    expect(semDeclaracao).toEqual([])
  })

  it('não declara isolamento para ação que não existe', () => {
    const inventadas = Object.keys(ISOLAMENTO_POR_EFEITO).filter((a) => !acoes.includes(a))
    expect(inventadas).toEqual([])
  })

  /**
   * A lista descreve o que É, não o que seria bom. `worktree` só onde o isolamento de fato
   * acontece hoje — `run_command` pelo `decidir()` e `supervised_session` pela própria sessão.
   */
  it('só os efeitos que rodam isolados hoje declaram worktree', () => {
    const isolados = Object.keys(ISOLAMENTO_POR_EFEITO)
      .filter((a) => ISOLAMENTO_POR_EFEITO[a] === 'worktree')
      .sort()
    expect(isolados).toEqual(['run_command', 'supervised_session'])
  })

  /**
   * `create_project_folder` é o caso que explica a regra: ele CRIA o checkout, então não há
   * repositório de onde tirar um worktree — e o resultado precisa ficar no lugar real, porque
   * abrir o VS Code ali é o objetivo.
   */
  it('criar projeto não é isolado, e isso é deliberado', () => {
    expect(isolamentoDoEfeito('create_project_folder')).toBe('nenhum')
    expect(isolamentoDoEfeito('jarvis:create_project_folder')).toBe('nenhum')
  })

  /** Ausência não é permissão: desconhecido devolve `undefined`, nunca `'nenhum'`. */
  it('efeito desconhecido não vira "sem isolamento"', () => {
    expect(isolamentoDoEfeito('jarvis:acao_que_nao_existe')).toBeUndefined()
  })
})
