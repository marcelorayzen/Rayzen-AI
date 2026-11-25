import {
  SpecialistRegistry,
  SPECIALIST_DEFINITIONS,
  buildToolsForSkills,
  toToolName,
  fromToolName,
  type SpecialistType,
} from '../specialist-registry'
import { SKILL_DEFINITIONS_EXPORT } from '../../skill-engine/skill-registry'

/**
 * Inferência de specialist a partir do título/prompt do step.
 *
 * `infer()` é o único ponto onde uma missão sem `type` explícito escolhe quem executa
 * o step — errar aqui não quebra nada visivelmente, só entrega o step ao specialist
 * errado (com o system prompt errado e o conjunto de skills errado). Foi assim que
 * "inspect the schema" virou tester e "specialist registry" virou tester: as regressões
 * só apareceram rodando missão real. Estes testes fixam a ordem das regras e as duas
 * regressões conhecidas.
 */
describe('SpecialistRegistry.infer()', () => {
  const registry = new SpecialistRegistry()

  describe('synthesizer', () => {
    it.each([
      'Summarize the previous step outputs',
      'Sintetize os achados da auditoria',
      'Gerar relatório final da missão',
      'Crie um documento com o resultado da análise',
      'Com base nos outputs anteriores, escreva o texto final',
      'Monte uma tabela com os módulos sem uso',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('synthesizer')
    })
  })

  describe('coder', () => {
    it.each([
      'Implement retry with backoff in StepExecutor',
      'Build the /infra/health endpoint',
      'Develop the pagination for the researcher',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('coder')
    })
  })

  describe('reviewer', () => {
    it.each([
      'Review the pending diff before push',
      'Check the whitelist entries',
      'Validate the DTO payload',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('reviewer')
    })
  })

  describe('tester', () => {
    it.each([
      'Write unit tests for AuthService',
      'Add spec for the poller',
      'Increase coverage of the guardian module',
      'Assert the response shape of /v2/missions',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('tester')
    })

    // As missões deste projeto são escritas em português e o tester era o único branch
    // do infer() sem pt-BR — todos estes caíam no coder, que ganha file_write e não
    // recebe parse_test_report nem o system prompt de QA.
    it.each([
      'Escrever testes unitários para o poller',
      'Adicionar teste para o SpecialistRegistry',
      'Corrigir os testes que quebraram',
      'Aumentar a cobertura do módulo guardian',
      'Rodar a suíte de testes do agent',
    ])('pt-BR: %s', (text) => {
      expect(registry.infer(text)).toBe('tester')
    })

    it('não confunde "teste" com palavras que apenas o contêm', () => {
      expect(registry.infer('Atestar a origem do commit')).not.toBe('tester')
      expect(registry.infer('Protestar contra o rate limit')).not.toBe('tester')
    })
  })

  describe('architect', () => {
    it.each([
      'Design the schema isolation between v1 and v2',
      'Write an ADR for the mission scheduler',
      'Diagram the mission lifecycle',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('architect')
    })
  })

  describe('researcher', () => {
    it.each([
      'Inspect the prisma schema and report the models',
      'Analyze why missions stall on step 2',
      'Compare V1 and V2 event schemas',
      'Read the file apps/agent/src/poller.ts',
      'Leia o arquivo poller.ts e liste as ações do agent',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('researcher')
    })
  })

  describe('debugger', () => {
    it.each([
      'Debug the gate that never executes',
      'Fix the crash on startup',
      'The mission throws an error on step 2',
    ])('%s', (text) => {
      expect(registry.infer(text)).toBe('debugger')
    })
  })

  describe('regressões conhecidas', () => {
    // "specialist" contém "spec" — sem \b no regex do tester, todo step que falava em
    // specialist ia parar no QA Engineer.
    it('não confunde "specialist" com "spec"', () => {
      expect(registry.infer('Configure the specialist registry profiles')).toBe('coder')
      expect(registry.infer('List the specialists available in V2')).not.toBe('tester')
    })

    // "inspection"/"inspect" idem — continha "spec" e caía no tester em vez do researcher.
    it('manda "inspect" para o researcher, não para o tester', () => {
      expect(registry.infer('Inspection of the agent whitelist')).toBe('researcher')
      expect(registry.infer('inspect_schema on apps/api/prisma/schema.prisma')).toBe('researcher')
    })
  })

  describe('precedência entre regras (a ordem das regras é o contrato)', () => {
    it('synthesizer vence coder — "create doc" não é implementação', () => {
      // Motivo do synthesizer estar em primeiro lugar no infer().
      expect(registry.infer('Create a doc about the build pipeline')).toBe('synthesizer')
    })

    it('coder vence reviewer quando o texto contém "implement"', () => {
      // Limitação conhecida e aceita: "review the implementation" casa em coder primeiro,
      // porque "implementation" contém "implement". Steps de review devem evitar a palavra
      // ou passar `type` explícito.
      expect(registry.infer('Review the implementation of the poller')).toBe('coder')
    })

    it('researcher vence debugger quando o texto pede investigação', () => {
      expect(registry.infer('Investigate the bug in the poller')).toBe('researcher')
    })
  })

  describe('fallback', () => {
    it('cai em coder quando nada casa', () => {
      expect(registry.infer('Refatorar o poller do agent')).toBe('coder')
      expect(registry.infer('')).toBe('coder')
    })

    it('nunca retorna um tipo sem definição', () => {
      const amostras = [
        '', 'qualquer coisa', 'summarize', 'inspect', 'fix', 'design',
        'tests', 'review', 'implement', 'ãéíõü 123 !@#',
      ]
      for (const texto of amostras) {
        expect(SPECIALIST_DEFINITIONS[registry.infer(texto)]).toBeDefined()
      }
    })

    it('é case-insensitive', () => {
      expect(registry.infer('SUMMARIZE THE OUTPUTS')).toBe('synthesizer')
      expect(registry.infer('Fix The Crash')).toBe('debugger')
    })
  })
})

describe('SpecialistRegistry — get / list / has', () => {
  const registry = new SpecialistRegistry()

  it('get() devolve a definição do tipo pedido', () => {
    expect(registry.get('coder').name).toBe('Software Engineer')
    expect(registry.get('synthesizer').allowedSkills).toEqual([])
  })

  it('get() cai no researcher quando o tipo não existe', () => {
    // Fallback conservador: researcher é read-only, então um tipo desconhecido nunca
    // ganha file_write/run_command por acidente.
    expect(registry.get('nao_existe' as SpecialistType).type).toBe('researcher')
  })

  it('list() devolve todas as definições', () => {
    expect(registry.list()).toHaveLength(Object.keys(SPECIALIST_DEFINITIONS).length)
  })

  it('has() usa hasOwnProperty — propriedade de Object.prototype não é um tipo válido', () => {
    expect(registry.has('coder')).toBe(true)
    expect(registry.has('nao_existe')).toBe(false)
    expect(registry.has('toString')).toBe(false)
    expect(registry.has('constructor')).toBe(false)
  })
})

describe('SPECIALIST_DEFINITIONS — invariantes', () => {
  const skillIds = new Set(SKILL_DEFINITIONS_EXPORT.map((s) => s.id))

  it('a chave do registro bate com o campo type', () => {
    for (const [key, def] of Object.entries(SPECIALIST_DEFINITIONS)) {
      expect(def.type).toBe(key)
    }
  })

  it('toda skill em allowedSkills existe no SkillRegistry', () => {
    // buildToolsForSkills() descarta silenciosamente ids desconhecidos — sem este teste,
    // renomear uma skill tira a tool do specialist sem nenhum erro em runtime.
    for (const def of Object.values(SPECIALIST_DEFINITIONS)) {
      for (const id of def.allowedSkills) {
        expect({ specialist: def.type, skillId: id, existe: skillIds.has(id) })
          .toEqual({ specialist: def.type, skillId: id, existe: true })
      }
    }
  })

  it('só o debugger tem run_command', () => {
    // Regra do CLAUDE.md: coder não executa comandos arbitrários.
    const comRunCommand = Object.values(SPECIALIST_DEFINITIONS)
      .filter((d) => d.allowedSkills.includes('jarvis:run_command'))
      .map((d) => d.type)
    expect(comRunCommand).toEqual(['debugger'])
  })

  it('limites de custo e iteração são positivos', () => {
    for (const def of Object.values(SPECIALIST_DEFINITIONS)) {
      expect(def.maxIterations).toBeGreaterThan(0)
      expect(def.maxCostUsd).toBeGreaterThan(0)
    }
  })
})

describe('toToolName / buildToolsForSkills', () => {
  it('sanitiza ":" para "__" e volta', () => {
    expect(toToolName('jarvis:file_write')).toBe('jarvis__file_write')
    expect(fromToolName('jarvis__file_write')).toBe('jarvis:file_write')
    expect(fromToolName(toToolName('guardian:approve_review'))).toBe('guardian:approve_review')
  })

  it('todo tool name gerado passa no padrão exigido pela Anthropic', () => {
    const padrao = /^[a-zA-Z0-9_-]{1,128}$/
    for (const def of Object.values(SPECIALIST_DEFINITIONS)) {
      for (const tool of buildToolsForSkills(def.allowedSkills)) {
        expect(tool.name).toMatch(padrao)
      }
    }
  })

  it('descarta skillIds que não existem mais', () => {
    expect(buildToolsForSkills(['jarvis:nao_existe_mais'])).toEqual([])
    expect(buildToolsForSkills([])).toEqual([])
    expect(buildToolsForSkills(['jarvis:git_status', 'jarvis:nao_existe_mais'])).toHaveLength(1)
  })

  it('campos primitivos viram { type } obrigatório', () => {
    const [tool] = buildToolsForSkills(['jarvis:file_write'])
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path:    { type: 'string' },
        content: { type: 'string' },
        dryRun:  { type: 'boolean' },
      },
      required: ['path', 'content', 'dryRun'],
    })
  })

  it('campo com optional:true fica fora de required e não vaza a flag para o JSON Schema', () => {
    const [tool] = buildToolsForSkills(['jarvis:file_read'])
    const params = tool.parameters as { properties: Record<string, unknown>; required: string[] }

    expect(params.required).toEqual(['path'])
    expect(params.properties.lines).toEqual({
      type:       'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required:   ['start'],
    })
    expect(params.properties.lines).not.toHaveProperty('optional')
  })

  describe('atalho de tipo vira JSON Schema válido', () => {
    // `{ type: 'string[]' }` não é um tipo JSON Schema. O provider rejeita a definição
    // da tool inteira, não o campo — então a skill sumiria em silêncio no dia em que
    // entrasse em algum allowedSkills.
    it('string[] vira array com items', () => {
      const [tool] = buildToolsForSkills(['jarvis:guardian_analyze'])
      const params = tool.parameters as { properties: Record<string, unknown> }

      expect(params.properties.changedFiles).toEqual({ type: 'array', items: { type: 'string' } })
    })

    it('array sem tipo de elemento ganha items', () => {
      const [tool] = buildToolsForSkills(['jarvis:git_add'])
      const params = tool.parameters as { properties: Record<string, unknown> }

      expect(params.properties.files).toEqual({ type: 'array', items: { type: 'string' } })
    })

    it('nenhuma skill do registry gera tipo fora do JSON Schema', () => {
      const validos = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])
      for (const skill of SKILL_DEFINITIONS_EXPORT) {
        const [tool] = buildToolsForSkills([skill.id])
        const params = tool.parameters as { properties: Record<string, { type?: string }> }
        for (const [campo, schema] of Object.entries(params.properties)) {
          expect({ skill: skill.id, campo, tipo: schema.type, valido: validos.has(schema.type ?? '') })
            .toEqual({ skill: skill.id, campo, tipo: schema.type, valido: true })
        }
      }
    })
  })

  it('usa a description da skill como description da tool', () => {
    const [tool] = buildToolsForSkills(['jarvis:git_diff'])
    const skill  = SKILL_DEFINITIONS_EXPORT.find((s) => s.id === 'jarvis:git_diff')
    expect(tool.description).toBe(skill?.description)
  })
})
