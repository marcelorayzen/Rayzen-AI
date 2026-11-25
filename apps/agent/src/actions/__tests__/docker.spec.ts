import { readFileSync } from 'fs'
import { join } from 'path'
import { dockerStart, dockerStop } from '../docker'

/**
 * Primeira migração da Fase 1 — `docker.ts` de string montada (`execSync`) para
 * `executarPrograma('executavel', ...)`.
 *
 * Nenhum teste aqui inicia processo de verdade (mesma regra de `executar-helper.ts`): os casos
 * que exercitam o `docker` real ficam em `executar-programa.spec.ts`, no Windows real. Aqui só o
 * que é observável ANTES de qualquer spawn — sanitização de nome e o próprio código-fonte.
 */
describe('docker actions — sanitização não muda com a migração', () => {
  it('dryRun não chega a chamar o programa', async () => {
    const r = await dockerStart({ name: 'rayzen-ai-api-1', dryRun: true })
    expect(r).toEqual({ dryRun: true, wouldStart: 'rayzen-ai-api-1' })
  })

  it.each(['nome; rm -rf /', 'nome && whoami', 'nome`whoami`', 'nome$(whoami)'])(
    'nome com metacaractere "%s" é sanitizado antes de qualquer coisa',
    async (nome) => {
      const r = await dockerStart({ name: nome, dryRun: true })
      expect((r as { wouldStart: string }).wouldStart).not.toMatch(/[;&`$()]/)
    },
  )

  it('nome que sobra vazio depois da sanitização é rejeitado', async () => {
    await expect(dockerStart({ name: ';;;', dryRun: false })).rejects.toThrow(/inválido/)
    await expect(dockerStop({ name: '&&', dryRun: false })).rejects.toThrow(/inválido/)
  })
})

describe('docker actions — código não volta a montar string de comando', () => {
  const fonte = readFileSync(join(__dirname, '..', 'docker.ts'), 'utf8')

  it('não importa mais execSync/exec de child_process', () => {
    expect(fonte).not.toMatch(/from 'child_process'/)
  })

  it('despacha por executarPrograma, com estratégia "executavel"', () => {
    expect(fonte).toMatch(/executarPrograma\('executavel'/)
  })

  it('nenhum template string interpolando valor dentro do argv do docker', () => {
    // `docker(['start', name])` é vetor; `docker(\`start ${name}\`)` seria o defeito antigo.
    expect(fonte).not.toMatch(/docker\([`'"]\S*\$\{/)
  })
})
