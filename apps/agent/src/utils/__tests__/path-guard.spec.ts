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

  /**
   * Consolidação de 4 cópias ad-hoc de "safe root" (`actions/file-search.ts`,
   * `parse-test-report.ts`, `capture-test-failure.ts`, `create-project-folder.ts`) — todas
   * tinham `C:\Projects`/`D:\Projects`, que a canônica não tinha. Sem isso, migrar essas 4
   * ações para `isUnderSafeRoot()` teria quebrado um caso real que já funcionava.
   */
  // Caminho com letra de unidade só existe no Windows — no runner Linux do CI,
  // `path.resolve` nunca reconhece `C:\...` como absoluto, e a asserção não tem como valer.
  const itWindows = process.platform === 'win32' ? it : it.skip
  itWindows('aceita C:\\Projects e D:\\Projects — presentes nas 4 cópias ad-hoc que esta lista substitui', () => {
    expect(isUnderSafeRoot('C:\\Projects\\algum-repo\\arquivo.ts')).toBe(true)
    expect(isUnderSafeRoot('D:\\Projects\\outro-repo')).toBe(true)
  })

  /**
   * As 4 cópias ad-hoc usavam `path.startsWith(root)` — comparação de PREFIXO, não de
   * fronteira de diretório. `C:\ProjectsEvil` começa com `C:\Projects` como string, mas não é
   * um subdiretório dele. `isUnderSafeRoot()` usa `relative()` e não tem esse defeito — este
   * teste é a prova de que a consolidação não herda o bug junto com a lista.
   */
  it('rejeita C:\\ProjectsEvil — prefixo de string, não subdiretório real', () => {
    expect(isUnderSafeRoot('C:\\ProjectsEvil\\arquivo.ts')).toBe(false)
  })
})
