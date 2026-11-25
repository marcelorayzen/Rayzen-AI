import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * O Hub conversa; quem executa são os trabalhadores do Rayzen.
 *
 * Em 07-08/11 o runtime Hermes (plataforma `api_server`, a do Hub) tinha terminal e escrita por
 * PADRÃO e criou uma cópia paralela de um repositório dentro do container. A trava é
 * `agent.disabled_toolsets` no `config.yaml` montado do repositório — este teste falha se uma
 * edição futura tirar qualquer mão da lista ou voltar a `agent: {}`.
 */
const CONFIG = join(__dirname, '..', '..', '..', '..', '..', '..', 'infra', 'hermes', 'config.yaml')

const MAOS = [
  'terminal',
  'file',
  'code_execution',
  'browser',
  'computer_use',
  'cronjob',
  'delegation',
  'connections',
] as const

/** Itens de `agent.disabled_toolsets`, lidos como texto (sem parser YAML no app). */
function toolsetsDesligados(yaml: string): string[] {
  const linhas = yaml.split(/\r?\n/)
  const inicio = linhas.findIndex((l) => /^agent:\s*$/.test(l))
  if (inicio < 0) return []
  const itens: string[] = []
  let dentro = false
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^\S/.test(linha)) break // próxima chave de raiz
    if (/^\s+disabled_toolsets:\s*$/.test(linha)) { dentro = true; continue }
    if (!dentro) continue
    const item = /^\s+-\s+([\w-]+)\s*(#.*)?$/.exec(linha)
    if (item) { itens.push(item[1]); continue }
    if (/^\s*(#.*)?$/.test(linha)) continue
    break // outra chave dentro de `agent:`
  }
  return itens
}

describe('Hub sem mãos — runtime Hermes não executa por conta própria', () => {
  const yaml = readFileSync(CONFIG, 'utf8')

  it.each(MAOS)('desliga %s globalmente', (toolset) => {
    expect(toolsetsDesligados(yaml)).toContain(toolset)
  })

  it('um fio não lê outro: session_search desligado (item 7.5)', () => {
    expect(toolsetsDesligados(yaml)).toContain('session_search')
  })

  it('não volta a `agent: {}`, que herda o padrão com terminal e escrita', () => {
    expect(yaml).not.toMatch(/^agent:\s*\{\s*\}\s*$/m)
  })

  // 13/11 (item 8.2, Marcelo): o Hub ganhou mãos DIRETAS — escrita dentro do Rayzen,
  // reversível (decisão, nota, planejamento, aprendizado, ciclo de vida). O que executa no PC,
  // dispara LLM em lote ou cria coisa nova continua fora: isso é envelope ou trabalhador.
  it('do MCP do Rayzen, nada que execute ou crie fora de envelope', () => {
    expect(yaml).not.toMatch(/-\s+rayzen_(checkpoint|agent_task|create_|blueprint_|guardian_)/)
  })

  // 13/11: com tool_search ligado toda ferramenta MCP é deferida, e o modelo pediu para criar
  // projeto, buscou uma vez, não achou rayzen_propose_project e disse que não podia.
  it('as ferramentas do Rayzen ficam à vista: tool_search desligado', () => {
    expect(yaml).toMatch(/^tools:\n\s+tool_search:\n\s+enabled:\s*"off"\s*$/m)
  })

  it('o leitor de texto reconhece a forma e recusa a forma vazia', () => {
    expect(toolsetsDesligados('agent:\n  disabled_toolsets:\n    - terminal\n    - file\nplugins: {}\n'))
      .toEqual(['terminal', 'file'])
    expect(toolsetsDesligados('agent: {}\n')).toEqual([])
    expect(toolsetsDesligados('agent:\n  outra: 1\n')).toEqual([])
  })
})
