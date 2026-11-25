import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Item 3 — `rayzen_list_files` / `rayzen_read_file` ligados de ponta a ponta no MCP HTTP e liberados
 * ao Hermes. Teste textual (importar o .mjs abriria um servidor de verdade).
 */
const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')
const HERMES = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'infra', 'hermes', 'config.yaml'), 'utf8')

describe('ferramentas de arquivos do projeto no MCP', () => {
  it.each(['rayzen_list_files', 'rayzen_read_file'])('%s está declarada, no escopo de leitura e liberada ao Hermes', (nome) => {
    expect(FONTE).toContain(`name: '${nome}'`)
    const leitura = FONTE.slice(FONTE.indexOf('const FERRAMENTAS_DE_LEITURA'), FONTE.indexOf('// ── MCP Server'))
    expect(leitura).toContain(`'${nome}'`)
    expect(HERMES).toMatch(new RegExp(`-\\s+${nome}\\b`))
  })

  it('as duas exigem projectId explícito — nunca o projeto padrão do ambiente', () => {
    const lista = FONTE.slice(FONTE.indexOf("case 'rayzen_list_files'"), FONTE.indexOf("case 'rayzen_get_wiki'"))
    expect(lista.match(/requireProjectId\(args\)/g)).toHaveLength(2)
    expect(lista).not.toContain('resolveProjectIdLoud')
  })

  it('chamam só GET nas rotas de arquivos do projeto', () => {
    const lista = FONTE.slice(FONTE.indexOf("case 'rayzen_list_files'"), FONTE.indexOf("case 'rayzen_get_wiki'"))
    expect(lista).toMatch(/api\('GET', `\/projects\/\$\{encodeURIComponent\(pid\)\}\/files\$\{q\}`\)/)
    expect(lista).toMatch(/api\('GET', `\/projects\/\$\{encodeURIComponent\(pid\)\}\/files\/content\?path=/)
    expect(lista).not.toMatch(/api\('(POST|PUT|PATCH|DELETE)'/)
  })
})
