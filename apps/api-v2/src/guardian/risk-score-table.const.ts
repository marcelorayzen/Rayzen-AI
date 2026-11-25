export const RISK_SCORE_TABLE = {
  serviceSemSpec:      30,
  moduloCritico:       25, // auth | mcp | hook | gateway | policy | security
  alteracaoSchema:     20,
  migrationSemTeste:   20,
  semTesteRodado:      15, // nenhuma execução de teste recente cobriu as mudanças
  jwtProximoDeExpirar: 10,
  docDesatualizada:     5, // gerador tocado sem regenerar o doc que ele produz
} as const

// `erroRecenteNoModulo` (10) foi REMOVIDO, não implementado. Medido em 2026-08-13:
// `v2.trace_spans` com status error tem 0 registros, e nenhum evento carrega
// `metadata.graphify.modules` — não há como associar erro a módulo. Um sinal que
// nunca dispara é pior que sinal nenhum: dá impressão de cobertura que não existe.
// Para ressuscitá-lo, primeiro alimentar uma das duas fontes.

/**
 * Docs gerados por script e as fontes que os tornam obsoletos.
 * Se a fonte muda e o doc não é regenerado no mesmo changeset, o doc mente.
 */
export const DOCS_GERADOS = [
  {
    doc:     'docs/agent-actions.md',
    comando: 'pnpm gen:catalog',
    fontes:  [/^apps\/agent\/src\/actions\//i, /^apps\/agent\/src\/security\/whitelist\.ts$/i],
  },
  {
    doc:     'docs/security/data-inventory.md',
    comando: 'pnpm scan:secrets',
    fontes:  [/^apps\/[^/]+\/\.env\.example$/i, /^infra\/.*\.ya?ml$/i],
  },
] as const

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
