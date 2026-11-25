'use strict'

const { createHash } = require('node:crypto')

/** Identidade estável da credencial sem guardar ou logar o bearer token bruto. */
function principalForToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

/** Liga o transporte à credencial e ao escopo que criaram a sessão. */
function bindSession(sessions, sessionId, transport, auth) {
  sessions.set(sessionId, {
    transport,
    principal: auth.principal,
    escopo: auth.escopo,
    consumidor: auth.consumidor ?? null,
  })
}

/**
 * Só devolve a sessão quando identidade E escopo continuam iguais.
 * `null` também cobre ID inexistente para não revelar se uma sessão de outro principal existe.
 */
function getAuthorizedSession(sessions, sessionId, auth) {
  if (!sessionId) return null
  const session = sessions.get(sessionId)
  if (!session) return null
  if (
    session.principal !== auth.principal ||
    session.escopo !== auth.escopo ||
    session.consumidor !== (auth.consumidor ?? null)
  ) return null
  return session
}

module.exports = { principalForToken, bindSession, getAuthorizedSession }
