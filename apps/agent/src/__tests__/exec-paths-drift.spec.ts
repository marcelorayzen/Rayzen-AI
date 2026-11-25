import { execFileSync } from 'child_process'
import { join } from 'path'

/**
 * `docs/exec-paths.md` e GERADO por `scripts/scan-exec-paths.mjs`. Este teste roda o
 * scanner em `--check` e falha se o documento divergir do codigo.
 *
 * Existe porque o inventario da Fase 0 so vale enquanto for verdade. A superficie de
 * execucao era conhecida por leitura, e leitura envelhece: em 2026-09-07 a varredura
 * manual achou 26 pontos, o scanner achou 53. Sem trava, este documento vira a proxima
 * tabela mantida a mao que discorda do codigo — a mesma falha de `whitelist.ts` x
 * `ExecutionService`, e a mesma razao pela qual `memory-ranking.spec.ts` le o arquivo da
 * V1 como texto.
 *
 * Ponto de execucao NOVO que ninguem declarou quebra a suite. E o objetivo: adicionar
 * `execSync` passa a exigir um gesto explicito.
 */
describe('docs/exec-paths.md — anti-drift do inventário de execução', () => {
  it('o documento está em dia com o código', () => {
    const raiz = join(__dirname, '..', '..', '..', '..')
    // Falha do scanner sai como exceção com o stderr dele, que já diz o que fazer.
    const saida = execFileSync(
      process.execPath,
      [join(raiz, 'scripts', 'scan-exec-paths.mjs'), '--check'],
      { encoding: 'utf8', cwd: raiz },
    )
    expect(saida).toMatch(/em dia/)
  })
})
