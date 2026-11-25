import { decidirPublicacao, mesclarQuandoCiPassar, temIntegracaoContinua } from '../mesclar-entrega'
import type { Executor } from '../publicar-entrega'

/** "Aprovado, mesclar" (16/11/2026): mescla só com CI verde, e a recusa fecha por padrão. */

const ok = (stdout = '') => ({ stdout, stderr: '', code: 0, timedOut: false })

describe('decidirPublicacao — o portão fecha por padrão', () => {
  it.each([
    ['Aprovado, mesclar', true, 'mesclar'],
    ['Aprovado, só abrir PR', true, 'so_pr'],
    ['Não publicar', true, 'nao'],
    ['1', true, 'mesclar'],
    ['2', true, 'so_pr'],
    ['3', true, 'nao'],
    ['sim, pode fazer o merge', true, 'mesclar'],
    ['aprovado, sem mesclar', true, 'so_pr'],
    ['não mesclar', true, 'nao'],
    ['', true, 'nao'],
    [null, true, 'nao'],
    ['talvez depois', true, 'nao'],
    // Sem CI, mesclar não é oferecido: pedir mesclar vira só abrir o PR, nunca merge.
    ['Aprovado, mesclar', false, 'so_pr'],
    ['Aprovado, publicar', false, 'so_pr'],
    ['1', false, 'so_pr'],
    ['2', false, 'nao'],
  ])('"%s" (CI=%s) → %s', (resposta, comMerge, esperado) => {
    expect(decidirPublicacao(resposta as string | null, comMerge as boolean)).toBe(esperado)
  })
})

describe('temIntegracaoContinua', () => {
  it('workflow versionado = há CI', async () => {
    const executar = jest.fn().mockResolvedValue(ok('.github/workflows/quality.yml\n')) as unknown as Executor
    await expect(temIntegracaoContinua(executar, '/r')).resolves.toBe(true)
  })
  it('sem workflow, ou git falhando, = sem CI (nunca oferece mesclar no escuro)', async () => {
    await expect(temIntegracaoContinua(jest.fn().mockResolvedValue(ok('')) as unknown as Executor, '/r')).resolves.toBe(false)
    await expect(temIntegracaoContinua(jest.fn().mockRejectedValue(new Error('x')) as unknown as Executor, '/r')).resolves.toBe(false)
  })
})

describe('mesclarQuandoCiPassar', () => {
  /** gh falso: cada chamada de `pr checks` devolve o próximo estado da lista. */
  function gh(estados: unknown[][], depoisDoMerge = { state: 'MERGED', mergeCommit: { oid: 'abc123def456aa' } }) {
    const chamadas: string[][] = []
    let i = 0
    const executar: Executor = async (_p, args) => {
      chamadas.push([...args])
      if (args[1] === 'checks') return ok(JSON.stringify(estados[Math.min(i++, estados.length - 1)]))
      if (args[1] === 'view') return ok(JSON.stringify(depoisDoMerge))
      return ok()
    }
    return { executar, chamadas, mesclou: () => chamadas.some((c) => c[1] === 'merge') }
  }
  const rapido = { intervaloMs: 10, esperaPorChecksMs: 30, tetoMs: 100, esperar: async () => {} }

  it('todos verdes: sai do rascunho, mescla com squash e confere o estado MERGED', async () => {
    const g = gh([[{ name: 'quality', bucket: 'pass' }]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'rayzen/sessao-x', rapido))
      .resolves.toEqual({ ok: true, commit: 'abc123def456aa', checks: 1 })
    expect(g.chamadas.map((c) => c.slice(0, 2).join(' '))).toEqual(['pr checks', 'pr ready', 'pr merge', 'pr view'])
    expect(g.chamadas.find((c) => c[1] === 'merge')).toContain('--squash')
    // O ramo não é apagado: o postflight mede a entrega por ele.
    expect(g.chamadas.find((c) => c[1] === 'merge')).not.toContain('--delete-branch')
  })

  it('espera o pendente terminar antes de mesclar', async () => {
    const g = gh([[{ name: 'quality', bucket: 'pending' }], [{ name: 'quality', bucket: 'pass' }]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido)).resolves.toMatchObject({ ok: true })
  })

  it('check com falha: NÃO mescla, e diz qual falhou', async () => {
    const g = gh([[{ name: 'quality', bucket: 'fail' }, { name: 'lint', bucket: 'pass' }]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido))
      .resolves.toMatchObject({ ok: false, motivo: 'ci_falhou', detalhe: expect.stringContaining('quality') })
    expect(g.mesclou()).toBe(false)
  })

  it('cancelado também não é verde', async () => {
    const g = gh([[{ name: 'quality', bucket: 'cancel' }]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido)).resolves.toMatchObject({ ok: false, motivo: 'ci_falhou' })
    expect(g.mesclou()).toBe(false)
  })

  it('nenhum check aparece: não mescla — sem CI medido, não há merge', async () => {
    const g = gh([[]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido)).resolves.toMatchObject({ ok: false, motivo: 'ci_ausente' })
    expect(g.mesclou()).toBe(false)
  })

  it('CI que não termina: desiste no teto sem mesclar', async () => {
    const g = gh([[{ name: 'quality', bucket: 'pending' }]])
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido)).resolves.toMatchObject({ ok: false, motivo: 'ci_demorou' })
    expect(g.mesclou()).toBe(false)
  })

  it('merge que não resulta em MERGED é falha, não sucesso presumido', async () => {
    const g = gh([[{ name: 'quality', bucket: 'pass' }]], { state: 'OPEN', mergeCommit: null } as never)
    await expect(mesclarQuandoCiPassar(g.executar, '/r', 'b', rapido)).resolves.toMatchObject({ ok: false, motivo: 'merge_falhou' })
  })
})
