import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * S1 (15/11) — `rayzen_get_autonomy`: o Hub responde "o que fiz sozinho / proponho / precisa de
 * você / detectei e não toco" a partir do registro. Teste textual: importar o .mjs abriria um servidor.
 */
const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')
const HERMES = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'infra', 'hermes', 'config.yaml'), 'utf8')
const CASO = FONTE.slice(FONTE.indexOf("case 'rayzen_get_autonomy'"), FONTE.indexOf("case 'rayzen_get_resume'"))

describe('rayzen_get_autonomy', () => {
  it('está declarada, no escopo de LEITURA e liberada ao Hermes', () => {
    expect(FONTE).toContain("name: 'rayzen_get_autonomy'")
    const leitura = FONTE.slice(FONTE.indexOf('const FERRAMENTAS_DE_LEITURA'), FONTE.indexOf('const FERRAMENTAS_DE_PROPOSTA'))
    expect(leitura).toContain("'rayzen_get_autonomy'")
    expect(HERMES).toMatch(/-\s+rayzen_get_autonomy\b/)
  })

  it('exige projectId explícito — o fio é dono do escopo', () => {
    expect(CASO).toContain('requireProjectId(args)')
    expect(CASO).not.toContain('resolveProjectIdLoud')
  })

  it('só lê: GET no resumo e nos invariantes, nenhuma escrita', () => {
    expect(CASO).toMatch(/api\('GET', `\/handoffs\/resumo\?projectId=/)
    expect(CASO).toMatch(/apiV2\('GET', `\/v2\/invariants\/latest\//)
    expect(CASO).not.toMatch(/api(V2)?\('(POST|PUT|PATCH|DELETE)'/)
  })

  it('falha ao ler invariantes é dita, nunca vira "nada detectado"', () => {
    expect(CASO).toMatch(/catch \(e\)[\s\S]*erro: `não consegui ler os invariantes/)
  })
})
