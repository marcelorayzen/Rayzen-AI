import { parsePorcelainPaths } from '../workspace-watcher'

describe('parsePorcelainPaths', () => {
  // Bug real (2026-08-06): runGit fazia .trim() na saída inteira, o que removia o
  // espaço da coluna 1 da PRIMEIRA linha. O slice(3) então comia a primeira letra do
  // nome e o Guardian recebia "ICENSE" em vez de "LICENSE" — score calculado sobre um
  // caminho inexistente e busca de spec para um arquivo que não existe.
  it('preserva o nome quando o arquivo está modificado mas não staged', () => {
    expect(parsePorcelainPaths(' M LICENSE')).toEqual(['LICENSE'])
  })

  it('lê os três estados de staging sem perder caractere', () => {
    const raw = [
      ' M nao-staged.ts',   // modificado na árvore
      'M  staged.ts',       // modificado no índice
      'MM ambos.ts',        // modificado nos dois
    ].join('\n')

    expect(parsePorcelainPaths(raw)).toEqual(['nao-staged.ts', 'staged.ts', 'ambos.ts'])
  })

  it('reconhece adicionados, deletados e não rastreados', () => {
    const raw = ['A  novo.ts', ' D removido.ts', '?? sem-rastreio.ts'].join('\n')
    expect(parsePorcelainPaths(raw)).toEqual(['novo.ts', 'removido.ts', 'sem-rastreio.ts'])
  })

  it('usa o destino em rename', () => {
    expect(parsePorcelainPaths('R  antigo.ts -> novo.ts')).toEqual(['novo.ts'])
  })

  it('desembrulha caminho entre aspas', () => {
    expect(parsePorcelainPaths('?? "com espaço.ts"')).toEqual(['com espaço.ts'])
  })

  it('ignora entrada vazia e linhas curtas demais para ter caminho', () => {
    expect(parsePorcelainPaths('')).toEqual([])
    expect(parsePorcelainPaths('\n\n')).toEqual([])
    expect(parsePorcelainPaths(' M ')).toEqual([])
  })

  it('respeita o limite de arquivos', () => {
    const raw = Array.from({ length: 20 }, (_, i) => ` M arquivo${i}.ts`).join('\n')
    expect(parsePorcelainPaths(raw, 3)).toEqual(['arquivo0.ts', 'arquivo1.ts', 'arquivo2.ts'])
  })
})
