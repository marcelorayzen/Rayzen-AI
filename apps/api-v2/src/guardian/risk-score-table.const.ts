export const RISK_SCORE_TABLE = {
  serviceSemSpec:      30,
  moduloCritico:       25, // auth | mcp | hook | gateway | policy
  alteracaoSchema:     20,
  migrationSemTeste:   20,
  semTesteRodado:      15,
  erroRecenteNoModulo: 10,
  jwtProximoDeExpirar: 10,
  docDesatualizada:     5,
} as const

export type RiskSignal = keyof typeof RISK_SCORE_TABLE

export function classifyRisk(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 85) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

export const CRITICAL_MODULE_PATTERNS = [/auth/i, /mcp/i, /hook/i, /gateway/i, /policy/i]
export const SCHEMA_PATTERNS          = [/prisma\/schema\.prisma$/, /\.prisma$/]
export const MIGRATION_PATTERNS       = [/prisma\/migrations\//]
