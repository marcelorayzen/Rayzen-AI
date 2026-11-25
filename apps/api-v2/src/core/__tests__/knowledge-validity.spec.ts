import { readFileSync } from 'fs'
import { join } from 'path'
import { conhecimentoVigente, motivoDeNaoVigencia } from '../knowledge-validity.const'

const ativo = { status: 'active', validFrom: null, validUntil: null }
const agora = new Date('2026-09-24T12:00:00.000Z')

describe('vigência do conhecimento canônico', () => {
  it('ativo e sem janela declarada vale agora', () => {
    expect(motivoDeNaoVigencia(ativo, agora)).toBeNull()
    expect(conhecimentoVigente(ativo, agora)).toBe(true)
  })

  it('diz POR QUE não vale, não só que não vale', () => {
    expect(motivoDeNaoVigencia({ ...ativo, status: 'superseded' }, agora)).toBe('superseded')
    expect(motivoDeNaoVigencia({ ...ativo, validFrom: new Date('2026-09-25T00:00:00Z') }, agora)).toBe('not_yet_valid')
    expect(motivoDeNaoVigencia({ ...ativo, validUntil: new Date('2026-09-24T11:00:00Z') }, agora)).toBe('expired')
  })

  it('o instante exato de validUntil já está fora', () => {
    expect(conhecimentoVigente({ ...ativo, validUntil: new Date(agora) }, agora)).toBe(false)
    expect(conhecimentoVigente({ ...ativo, validUntil: new Date(agora.getTime() + 1) }, agora)).toBe(true)
  })

  it('o instante exato de validFrom já está dentro', () => {
    expect(conhecimentoVigente({ ...ativo, validFrom: new Date(agora) }, agora)).toBe(true)
  })

  /**
   * Anti-drift por leitura, como `memory-ranking` e `event-derived-text`: o defeito que
   * este teste pega não daria erro nenhum. Uma cópia da condição de volta na busca
   * continuaria funcionando — até o dia em que a borda de `validUntil` mudasse num lugar
   * só, e o mesmo conhecimento passasse a valer na busca e não no pacote.
   */
  it('a busca e o pacote perguntam à mesma função, não a cópias', () => {
    const leitores = ['../../memory/memory.service.ts', '../../context-engine/context-pack.service.ts']
    for (const caminho of leitores) {
      const fonte = readFileSync(join(__dirname, caminho), 'utf8')
      expect(fonte).toMatch(/knowledge-validity\.const/)
      expect(fonte).not.toMatch(/status === 'active'\s*&&/)
    }
  })
})
