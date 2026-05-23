import { resolve } from 'path'
import { isUnderSafeRoot, SAFE_ROOTS } from '../path-guard'

const ROOT = SAFE_ROOTS[0] // e.g. ~/Downloads

describe('isUnderSafeRoot', () => {
  it('aceita caminho diretamente dentro de uma safe root', () => {
    const target = resolve(ROOT, 'arquivo.txt')
    expect(isUnderSafeRoot(target)).toBe(true)
  })

  it('aceita subdiretório dentro de uma safe root', () => {
    const target = resolve(ROOT, 'pasta', 'sub', 'arquivo.pdf')
    expect(isUnderSafeRoot(target)).toBe(true)
  })

  it('aceita o próprio safe root (rel === "")', () => {
    expect(isUnderSafeRoot(ROOT)).toBe(true)
  })

  it('rejeita caminho fora de qualquer safe root', () => {
    expect(isUnderSafeRoot(resolve('/tmp/qualquer'))).toBe(false)
    expect(isUnderSafeRoot(resolve('/etc/passwd'))).toBe(false)
  })

  it('rejeita traversal com ../', () => {
    const traversal = resolve(ROOT, '..', 'outro-dir', 'arquivo.txt')
    expect(isUnderSafeRoot(traversal)).toBe(false)
  })

  it('rejeita path que escapa da root via ../../../', () => {
    const traversal = resolve(ROOT, '..', '..', '..', 'etc', 'hosts')
    expect(isUnderSafeRoot(traversal)).toBe(false)
  })
})
