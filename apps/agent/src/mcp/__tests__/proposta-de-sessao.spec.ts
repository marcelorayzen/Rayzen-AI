import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * G4.2 — o prompt da sessão proposta pelo Hub é montado de campos, não redigido livre.
 *
 * `proposta-de-sessao.mjs` é ESM e este spec é CommonJS: roda o módulo REAL num subprocesso
 * (mesma técnica de `projeto-padrao.spec.ts`). O servidor é lido como texto para confirmar que a
 * regra está LIGADA no handler — importá-lo abriria um servidor de verdade.
 */
const MODULO = join(__dirname, '..', 'proposta-de-sessao.mjs')
const SERVIDOR = join(__dirname, '..', 'rayzen-mcp-http.mjs')

type Resultado = { prompt: string; problemas: string[] }

function montar(args: Record<string, unknown>): Resultado {
  const script =
    `import(${JSON.stringify(pathToFileURL(MODULO).href)}).then((m) => {` +
    `process.stdout.write(JSON.stringify(m.montarPromptDaSessao(JSON.parse(process.argv[1]))))})`
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(args)], { encoding: 'utf8' })
  return JSON.parse(saida) as Resultado
}

const COMPLETO = {
  objetivo: 'README ganha a seção "Como contribuir"',
  restricoes: 'Só README.md; não tocar em código nem CI',
  criterioDePronto: 'npm test passa e a seção cita os comandos reais',
}

describe('montarPromptDaSessao — o módulo real', () => {
  it('monta o prompt nas três seções fixas, na ordem, sem detalhes quando não vêm', () => {
    const { prompt, problemas } = montar(COMPLETO)
    expect(problemas).toEqual([])
    expect(prompt).toBe(
      'Objetivo:\nREADME ganha a seção "Como contribuir"\n\n' +
      'Restrições:\nSó README.md; não tocar em código nem CI\n\n' +
      'Critério de pronto (como verificar):\nnpm test passa e a seção cita os comandos reais',
    )
  })

  it('o texto livre entra por último, como Detalhes', () => {
    const { prompt } = montar({ ...COMPLETO, prompt: '  A seção de testes fica depois de Instalação.  ' })
    expect(prompt.endsWith('Detalhes:\nA seção de testes fica depois de Instalação.')).toBe(true)
  })

  it('recusa sem objetivo, restrições ou critério — e diz todos de uma vez', () => {
    const { problemas } = montar({ prompt: 'uma instrução longa só em texto livre, como era antes' })
    expect(problemas).toHaveLength(3)
    expect(problemas.join(' ')).toMatch(/objetivo/)
    expect(problemas.join(' ')).toMatch(/restricoes/)
    expect(problemas.join(' ')).toMatch(/criterioDePronto/)
  })

  it('campo só com espaços conta como ausente', () => {
    expect(montar({ ...COMPLETO, criterioDePronto: '        ' }).problemas).toHaveLength(1)
  })
})

describe('rayzen_propose_session — usa o módulo e exige os campos', () => {
  const FONTE = readFileSync(SERVIDOR, 'utf8')

  it('o handler monta o prompt pelo módulo, sem o antigo mínimo de 20 caracteres', () => {
    const caso = FONTE.match(/case 'rayzen_propose_session': \{[\s\S]*?\n {8}\}/)?.[0] ?? ''
    expect(caso).toMatch(/const \{ prompt, problemas \} = montarPromptDaSessao\(args\)/)
    expect(caso).not.toMatch(/prompt\.length < 20/)
    expect(FONTE).toMatch(/import \{ montarPromptDaSessao \} from '\.\/proposta-de-sessao\.mjs'/)
  })

  it('o schema da ferramenta exige objetivo, restrições e critério de pronto', () => {
    expect(FONTE).toMatch(/required: \['projectId', 'titulo', 'objetivo', 'restricoes', 'criterioDePronto'\]/)
  })
})
