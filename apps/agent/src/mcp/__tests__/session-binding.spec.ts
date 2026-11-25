import { readFileSync } from 'fs'
import { join } from 'path'

interface AuthContext {
  principal: string
  escopo: string
  consumidor?: string | null
}

interface Session<T> extends AuthContext {
  transport: T
}

const binding = require('../session-binding.js') as {
  principalForToken(token: string): string
  bindSession<T>(sessions: Map<string, Session<T>>, id: string, transport: T, auth: AuthContext): void
  getAuthorizedSession<T>(sessions: Map<string, Session<T>>, id: string | undefined, auth: AuthContext): Session<T> | null
}

const FONTE = readFileSync(join(__dirname, '..', 'rayzen-mcp-http.mjs'), 'utf8')

describe('MCP — vínculo da sessão ao principal e escopo', () => {
  it('guarda impressão da credencial, nunca o bearer bruto', () => {
    const principal = binding.principalForToken('segredo-total')

    expect(principal).toHaveLength(64)
    expect(principal).not.toContain('segredo-total')
  })

  it('devolve a sessão para a mesma credencial e o mesmo escopo', () => {
    const sessions = new Map<string, Session<object>>()
    const transport = { id: 'transport-total' }
    const auth = { principal: binding.principalForToken('segredo-total'), escopo: 'total' }

    binding.bindSession(sessions, 'sessao-1', transport, auth)

    expect(binding.getAuthorizedSession(sessions, 'sessao-1', auth)?.transport).toBe(transport)
  })

  it('recusa outra credencial mesmo quando o escopo é igual', () => {
    const sessions = new Map<string, Session<object>>()
    const dono = { principal: binding.principalForToken('token-a'), escopo: 'total' }
    const intruso = { principal: binding.principalForToken('token-b'), escopo: 'total' }
    binding.bindSession(sessions, 'sessao-1', {}, dono)

    expect(binding.getAuthorizedSession(sessions, 'sessao-1', intruso)).toBeNull()
  })

  it('recusa escopo diferente mesmo para o mesmo principal', () => {
    const sessions = new Map<string, Session<object>>()
    const total = { principal: binding.principalForToken('token-a'), escopo: 'total' }
    const leitura = { ...total, escopo: 'leitura' }
    binding.bindSession(sessions, 'sessao-1', {}, total)

    expect(binding.getAuthorizedSession(sessions, 'sessao-1', leitura)).toBeNull()
  })

  it('recusa consumidor diferente mesmo com principal e escopo iguais', () => {
    const sessions = new Map<string, Session<object>>()
    const hermes = {
      principal: binding.principalForToken('token-a'),
      escopo: 'leitura',
      consumidor: 'hermes',
    }
    binding.bindSession(sessions, 'sessao-1', {}, hermes)

    expect(binding.getAuthorizedSession(sessions, 'sessao-1', {
      ...hermes,
      consumidor: 'outro',
    })).toBeNull()
  })

  it('POST, GET e DELETE consultam o vínculo antes de reutilizar o transporte', () => {
    expect(FONTE).toMatch(/bindSession\(transports, id, transport, auth\)/)
    expect(FONTE.match(/getAuthorizedSession\(transports, sessionId, auth\)/g)).toHaveLength(3)
    expect(FONTE).not.toMatch(/transports\.get\(sessionId\)/)
  })
})
