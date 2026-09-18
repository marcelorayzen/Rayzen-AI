import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Fase 8 do plano de execução tipada — token por consumidor no lugar de um único
 * `MCP_READONLY_TOKEN` compartilhado. Hoje não há como dizer QUEM leu o quê pelo MCP, nem
 * revogar um consumidor sem derrubar os outros que apresentam o mesmo valor.
 *
 * Mesma técnica de `escopo-leitura.spec.ts`: lê o `.mjs` como texto, porque o arquivo
 * INICIA UM SERVIDOR HTTP DE VERDADE ao ser carregado (sem guard de entry-point) — importar
 * diretamente num teste abriria uma porta real. Rede de segurança aqui é textual, e é a
 * mesma que já sustenta este arquivo desde a Fase 4-B (`escopo-leitura.spec.ts`).
 */
const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')

describe('MCP — token por consumidor (Fase 8)', () => {
  it('CONSUMIDORES_LEITURA descobre por padrão de nome, não por lista fixa', () => {
    // "descoberta", não "lista fixa": um consumidor novo é uma variável de ambiente nova,
    // sem editar este arquivo — é o que "Arquivos: ... .env, compose" do plano pede.
    expect(FONTE).toMatch(/MCP_TOKEN_\[A-Z0-9_\]\+/)
    expect(FONTE).toMatch(/Object\.entries\(process\.env\)/)
  })

  it('escopoDoToken() reconhece token de consumidor com o MESMO escopo do compartilhado', () => {
    const bloco = FONTE.match(/function escopoDoToken\(token\)[\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).toMatch(/CONSUMIDORES_LEITURA\.some\(\(c\) => c\.token === token\)/)
    expect(bloco).toMatch(/return ESCOPO_LEITURA/)
  })

  it('identificarConsumidor() existe e nunca decide autorização — só identifica para o log', () => {
    const bloco = FONTE.match(/function identificarConsumidor\(token\)[\s\S]*?\n}/)?.[0] ?? ''
    expect(bloco).not.toBe('')
    // Não deve escrever em accessTokens/CONSUMIDORES_LEITURA nem retornar um escopo —
    // só nomes (string) ou null.
    expect(bloco).not.toMatch(/ESCOPO_LEITURA|ESCOPO_TOTAL/)
  })

  it('checkAuth() loga a identidade DEPOIS de autorizar, nunca antes', () => {
    const bloco = FONTE.match(/function checkAuth\(req, res\)[\s\S]*?\n}/)?.[0] ?? ''
    const posAutorizacao = bloco.indexOf('return null') // o 401 early-return
    const posLog = bloco.indexOf('identificarConsumidor')
    expect(posAutorizacao).toBeGreaterThan(-1)
    expect(posLog).toBeGreaterThan(posAutorizacao) // loga só depois do 401 já ter sido tratado
    expect(bloco).toMatch(/console\.log\(`\[MCP\] acesso de/)
  })

  it('MCP_READONLY_TOKEN compartilhado continua funcionando — aditivo, não substitutivo', () => {
    // A Fase 8 é explícita: "o token compartilhado continua válido durante a transição".
    expect(FONTE).toMatch(/if \(MCP_READONLY_TOKEN && token === MCP_READONLY_TOKEN\) return ESCOPO_LEITURA/)
  })

  it('Hermes (o único consumidor real hoje) migrou para o token nomeado', () => {
    const composeHermes = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'infra', 'hermes', 'docker-compose.hermes.yml'), 'utf8',
    )
    const configHermes = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'infra', 'hermes', 'config.yaml'), 'utf8',
    )
    expect(composeHermes).toMatch(/MCP_TOKEN_HERMES/)
    expect(configHermes).toMatch(/MCP_TOKEN_HERMES/)
    // Não sobrou referência ao token compartilhado nestes dois arquivos — a migração é
    // completa para este consumidor, não parcial.
    expect(composeHermes).not.toMatch(/MCP_READONLY_TOKEN/)
    expect(configHermes).not.toMatch(/MCP_READONLY_TOKEN/)
  })
})
