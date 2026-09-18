import { readFileSync } from 'fs'
import { join } from 'path'
import { restartApi } from '../restart-api'

/**
 * Consistência da Fase 1, não achado de exploração ativa — os dois tinham `${}` que a
 * varredura desta sessão confirmou não serem payload externo (vêm de env var do operador ou
 * são argv constante). Migrados mesmo assim: mesma regra em todo lugar é mais simples de
 * manter que "este aqui é seguro porque...".
 */
describe('restart-api.ts — migrado, sem exec cru', () => {
  const fonte = readFileSync(join(__dirname, '..', 'restart-api.ts'), 'utf8')

  it('não importa mais execSync/exec de child_process', () => {
    expect(fonte).not.toMatch(/from 'node:child_process'|from 'child_process'/)
  })

  it('despacha por executarPrograma, com argv em vez de string', () => {
    expect(fonte).toMatch(/executarPrograma\('executavel', 'docker', \['restart', container\]/)
  })

  it('dryRun não chega a chamar o programa', async () => {
    const original = process.env.AGENT_ROLE
    process.env.AGENT_ROLE = 'server'
    try {
      const r = await restartApi({ dryRun: true })
      expect(r).toMatchObject({ ok: true, dryRun: true })
    } finally {
      if (original === undefined) delete process.env.AGENT_ROLE
      else process.env.AGENT_ROLE = original
    }
  })

  it('fora do role server, recusa sem nem checar dryRun', async () => {
    const original = process.env.AGENT_ROLE
    delete process.env.AGENT_ROLE
    try {
      const r = await restartApi({})
      expect(r).toMatchObject({ ok: false, skipped: true })
    } finally {
      if (original !== undefined) process.env.AGENT_ROLE = original
    }
  })
})

describe('run-graphify.ts — sem shell:true, sem process.env espalhado', () => {
  const fonte = readFileSync(join(__dirname, '..', 'run-graphify.ts'), 'utf8')
    .split(/\r?\n/).filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n')

  it('não declara shell: true', () => {
    expect(fonte).not.toMatch(/shell:\s*true/)
  })

  it('não importa spawn de child_process', () => {
    expect(fonte).not.toMatch(/from 'node:child_process'|from 'child_process'/)
  })

  it('não espalha process.env inteiro — só ambientePadrao() + a chave que precisa', () => {
    expect(fonte).not.toMatch(/\.\.\.process\.env,/)
    expect(fonte).toMatch(/\.\.\.ambientePadrao\(\)/)
  })
})
