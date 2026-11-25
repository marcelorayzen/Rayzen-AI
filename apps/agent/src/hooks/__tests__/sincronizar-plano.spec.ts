import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const modulo = resolve(__dirname, '..', 'sincronizar-plano.mjs').replace(/\\/g, '/')

function executar(nome: string, chamada: string) {
  const script = `import { ${nome} } from 'file:///${modulo}'; const resultado = ${chamada}; console.log(JSON.stringify(resultado))`
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' })
}

describe('sincronizar-plano', () => {
  it('lê critérios e o status do bloco ativo', () => {
    const markdown = '<!-- rayzen:meta status=ativa -->\n# Meta\n- [ ] c1 Primeiro\n- [x] c2 Segundo\n<!-- /rayzen:meta -->'
    const r = executar('lerPlanoVigente', `lerPlanoVigente(${JSON.stringify(markdown)})`)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({
      status: 'ativa', title: 'Meta',
      successCriteria: [{ id: 'c1', text: 'Primeiro', done: false }, { id: 'c2', text: 'Segundo', done: true }],
    })
  })

  it('usa somente tarefas abertas como fila', () => {
    const markdown = '- [x] **A1.0 Feita**\n- [ ] **A1.1 Próxima**\n- [ ] **B1.1 Depois**'
    const r = executar('tarefasAbertas', `tarefasAbertas(${JSON.stringify(markdown)})`)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual(['A1.1 Próxima', 'B1.1 Depois'])
  })
})
