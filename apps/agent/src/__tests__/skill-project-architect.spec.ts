import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * A skill `rayzen-project-architect` não pode citar o que não existe.
 *
 * A v1 (escrita no ChatGPT) listava 9 referências, 11 modelos e 3 scripts que não existiam —
 * convite para o modelo "carregar" e descrever arquivos inventados, o mesmo defeito medido no
 * Hub em 12/11. Este teste lê o SKILL.md e as referências e exige que todo caminho citado
 * dentro da pasta da skill exista.
 */
const RAIZ = join(__dirname, '..', '..', '..', '..', 'core', 'skills', 'rayzen-project-architect')
const SKILL = readFileSync(join(RAIZ, 'SKILL.md'), 'utf8')

function citados(texto: string): string[] {
  return [...new Set([...texto.matchAll(/`((?:referencias|modelos)\/[^`\s]+)`/g)].map((m) => m[1]))]
}

describe('skill rayzen-project-architect', () => {
  it('cabeçalho no formato Agent Skills: name igual à pasta, description presente', () => {
    const cab = /^---\n([\s\S]*?)\n---/.exec(SKILL)?.[1] ?? ''
    expect(cab).toMatch(/^name: rayzen-project-architect$/m)
    expect(cab).toMatch(/^description: /m)
  })

  it('todo arquivo de referência ou modelo citado existe', () => {
    const lista = citados(SKILL)
    expect(lista.length).toBeGreaterThan(10)
    const faltando = lista.filter((p) => !existsSync(join(RAIZ, p)))
    expect(faltando).toEqual([])
  })

  /**
   * `existsSync` passa na máquina de quem escreveu mesmo quando o arquivo está no `.gitignore` —
   * foi assim que `modelos/CLAUDE.local.md` (casado pela regra `CLAUDE.local.md`) passou verde
   * aqui e quebrou o CI em quatro pushes seguidos em 12-13/11, registrado como "flaky". Pior:
   * o servidor também não o tinha, então o Hub seguia uma skill citando modelo inexistente.
   * Existir no disco não basta; precisa ir para o git.
   */
  it('nenhum arquivo citado está no .gitignore — senão só existe nesta máquina', () => {
    const repo = join(RAIZ, '..', '..', '..')
    const ignorados = citados(SKILL).filter((p) => {
      try {
        execFileSync('git', ['check-ignore', '-q', join(RAIZ, p)], { cwd: repo, stdio: 'ignore' })
        return true // saída 0 = ignorado
      } catch {
        return false
      }
    })
    expect(ignorados).toEqual([])
  })

  it('as referências também só citam o que existe', () => {
    for (const ref of ['referencias/integracao-rayzen.md', 'referencias/descoberta-e-diagnostico.md']) {
      const faltando = citados(readFileSync(join(RAIZ, ref), 'utf8')).filter((p) => !existsSync(join(RAIZ, p)))
      expect(faltando).toEqual([])
    }
  })

  it('não promete a pasta .rayzen/ nem o orquestrador de missões como coisa ativa', () => {
    expect(SKILL).toMatch(/\*\*Não crie\*\* um diretório `\.rayzen\/`/)
    expect(SKILL).not.toMatch(/Mission Orchestrator|Context Broker/)
  })

  it('a criação no disco passa pelo handoff governado, não por palavra no chat', () => {
    expect(SKILL).toMatch(/handoff governado/)
    expect(SKILL).toMatch(/"Aprovado" na conversa aprova o PLANO/)
  })

  it('as ferramentas citadas na integração existem no MCP', () => {
    const mcp = readFileSync(join(__dirname, '..', 'mcp', 'rayzen-mcp-http.mjs'), 'utf8')
    const ref = readFileSync(join(RAIZ, 'referencias', 'integracao-rayzen.md'), 'utf8')
    const ferramentas = [...new Set([...ref.matchAll(/`(rayzen_[a-z_]+)`/g)].map((m) => m[1]))]
    expect(ferramentas.length).toBeGreaterThan(8)
    const inexistentes = ferramentas.filter((f) => !mcp.includes(`name: '${f}'`))
    expect(inexistentes).toEqual([])
  })
})
