export const RISK_SCORE_TABLE = {
  serviceSemSpec:      30,
  moduloCritico:       25, // auth | mcp | hook | gateway | policy | security
  alteracaoSchema:     20,
  migrationSemTeste:   20,
  semTesteRodado:      15, // reservado — requer evidência real de execução de teste, ainda não alimentado
  erroRecenteNoModulo: 10, // reservado — ainda não alimentado
  jwtProximoDeExpirar: 10,
  docDesatualizada:     5, // reservado — ainda não alimentado
} as const

export type RiskSignal = keyof typeof RISK_SCORE_TABLE

export function classifyRisk(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 85) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

// Ancorados em segmento/token do path — substring pura marcava falso positivo
// ("author" casava /auth/, "webhook" e hooks React casavam /hook/).
export const CRITICAL_MODULE_PATTERNS = [
  /(^|[/.-])auth([/.-]|$)/i,    // auth/, auth.guard.ts, auth-*.ts
  /(^|[/.-])mcp([/.-]|$)/i,
  /(^|[/.-])gateway([/.-]|$)/i, // módulos gateway e *.gateway.ts
  /(^|[/.-])policy([/.-]|$)/i,  // policy-engine, role-policy
  /agent\/src\/hooks\//i,       // hooks do Rayzen no agent — não hooks React
  /(^|\/)security\//i,          // whitelist do agent
]
export const SCHEMA_PATTERNS          = [/prisma\/schema\.prisma$/, /\.prisma$/]
export const MIGRATION_PATTERNS       = [/prisma\/migrations\//]
