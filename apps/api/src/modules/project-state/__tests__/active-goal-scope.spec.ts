import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Todo ponto que busca "a meta do projeto" tem que filtrar por status 'active'.
 *
 * Bug real (2026-08-07): três consultas usavam `status: { not: 'achieved' }`, que
 * inclui paused E cancelled. Assim que a meta corrente foi fechada, o objetivo do
 * projeto passou a ser derivado de uma meta pausada em junho — o painel voltou no
 * tempo sozinho, sem erro nenhum. Pausada significa deixada de lado; cancelada,
 * abandonada. Nenhuma das duas é o norte atual.
 *
 * Verificação estática de propósito: o que se quer travar é a convenção em todos os
 * módulos, não o comportamento de um serviço só — e montar o grafo de dependências
 * de cada um deles para um teste de unidade custaria muito mais do que protege.
 */
describe('escopo da meta ativa', () => {
  const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

  const FILES = [
    'apps/api/src/modules/project-state/project-state.service.ts',
    'apps/api/src/modules/documentation/documentation.service.ts',
    'apps/api/src/modules/graph/graph.service.ts',
    'apps/api/src/modules/graph/knowledge-graph.service.ts',
    'apps/api/src/modules/orchestrator/orchestrator.service.ts',
    'apps/api/src/modules/proactive/proactive.service.ts',
    'apps/api-v2/src/core/v1-bridge.service.ts',
  ]

  it.each(FILES)('%s não trata meta pausada ou cancelada como ativa', (relPath) => {
    const source = readFileSync(join(REPO_ROOT, relPath), 'utf8')

    // Ignora linhas de comentário — a explicação do bug cita o padrão antigo.
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

    expect(code).not.toMatch(/status:\s*\{\s*not:\s*'achieved'\s*\}/)
  })

  it('quem consulta projectGoal filtra explicitamente por status', () => {
    for (const relPath of FILES) {
      const source = readFileSync(join(REPO_ROOT, relPath), 'utf8')
      const queries = source.match(/projectGoal\.findFirst\(\{[\s\S]{0,200}?\}\)/g) ?? []

      for (const q of queries) {
        // findFirstOrThrow por id é lookup pontual, não busca da meta corrente.
        if (q.includes('id: goalId')) continue
        expect(q).toContain("status: 'active'")
      }
    }
  })
})
