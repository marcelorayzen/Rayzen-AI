import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 13/11 — o que a rota PÚBLICA do mcp-http aceita, depois que o Hub ganhou mãos (item 8.2).
 *
 * Lido como texto, mesma técnica de `escopo-leitura.spec.ts`: o `.mjs` sobe um servidor HTTP
 * ao carregar, e importá-lo num teste abriria porta de verdade.
 */
const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')
const checkAuth = FONTE.match(/function checkAuth\(req, res\) \{[\s\S]*?\n\}/)?.[0] ?? ''
const escopoDoToken = FONTE.match(/function escopoDoToken\(token, peloProxy = false\) \{[\s\S]*?\n\}/)?.[0] ?? ''

describe('token de consumidor que escreve só vale de dentro', () => {
  it('as funções existem (senão os outros casos passariam por não achar nada)', () => {
    expect(checkAuth).not.toBe('')
    expect(escopoDoToken).not.toBe('')
  })

  /**
   * `/mcp` é público em example.com. O Hermes fala direto com `mcp-http:3102`; quem chega
   * pelo Caddy carrega os cabeçalhos que o proxy acrescenta e que o cliente não remove.
   * A regra mora em `escopoDoToken` — autorização —, nunca em `identificarConsumidor`, que só
   * nomeia para o log (Fase 8).
   */
  it('consumidor que escreve chegando pelo proxy é recusado inteiro, antes de ganhar escopo', () => {
    expect(checkAuth).toMatch(/escopoDoToken\(token, veioPeloProxy\(req\)\)/)
    expect(escopoDoToken).toMatch(/const escreve = CONSUMIDORES_ASSISTENTE\.has\(consumidor\.nome\) \|\| CONSUMIDORES_PROPOSTA\.has\(consumidor\.nome\)/)
    expect(escopoDoToken).toMatch(/if \(escreve && peloProxy\) \{[\s\S]*?return null/)
    expect(escopoDoToken.indexOf('escreve && peloProxy')).toBeLessThan(escopoDoToken.indexOf('return ESCOPO_ASSISTENTE'))
  })

  it('o sinal de proxy são os cabeçalhos que o Caddy acrescenta', () => {
    expect(FONTE).toMatch(/function veioPeloProxy\(req\) \{\s*return Boolean\(req\.headers\['x-forwarded-for'\] \|\| req\.headers\['x-forwarded-host'\]\)/)
  })

  it('leitura NÃO entra na regra: consumidor só de leitura externo segue valendo de fora', () => {
    expect(escopoDoToken).toMatch(/return CONSUMIDORES_PROPOSTA\.has\(consumidor\.nome\) \? ESCOPO_PROPOSTA : ESCOPO_LEITURA/)
  })
})

describe('login OAuth (escopo total) — uma autoridade e porta que fecha', () => {
  const authorize = FONTE.match(/url\.pathname === '\/oauth\/authorize'\) \{\s*const body[\s\S]*?issueCode/)?.[0] ?? ''

  it('o handler existe', () => {
    expect(authorize).not.toBe('')
  })

  /** Em produção o ADMIN_PASSWORD é argon2: comparar texto com ele nunca batia. */
  it('não compara a senha localmente — pergunta à API', () => {
    expect(FONTE).not.toMatch(/password !== ADMIN_PASSWORD/)
    expect(FONTE).not.toMatch(/process\.env\.ADMIN_PASSWORD/)
    expect(authorize).toMatch(/await senhaDoAdminConfere\(password\)/)
    expect(FONTE).toMatch(/fetch\(`\$\{cfg\.apiUrl\}\/auth\/login`/)
  })

  it('bloqueio por falhas vem ANTES de conferir a senha, e falha conta', () => {
    expect(authorize.indexOf('loginOAuthBloqueado()')).toBeGreaterThan(-1)
    expect(authorize.indexOf('loginOAuthBloqueado()')).toBeLessThan(authorize.indexOf('senhaDoAdminConfere'))
    expect(authorize).toMatch(/falhasDeLogin\.push\(Date\.now\(\)\)/)
  })

  it('API fora do ar recusa, nunca aprova', () => {
    const conferir = FONTE.match(/async function senhaDoAdminConfere\(password\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(conferir).toMatch(/catch \{[\s\S]*return false/)
    expect(conferir).toMatch(/return res\.ok/)
  })
})
