# Rayzen Guardian — Vigilância Proativa de Código

Guardian monitora mudanças de código em tempo real e detecta riscos antes do push: arquivos sem spec, padrões críticos (whitelist, schema, auth) e recomendação de deploy.

---

## Como funciona

```
workspace-watcher detecta mudança (a cada 30s)
  → POST /v2/guardian/analyze
  → TestGapDetectorService: mapeia arquivo → spec esperada
  → RiskScorerService: calcula score aditivo
  → Persiste GuardianReport no Postgres (schema v2)
  → writeCache(tmpdir/rayzen-guardian-{hash}.json, TTL 10min)
  → rayzen-context-hook lê cache sincronamente (<5ms)
  → Claude Code abre a sessão já com contexto Guardian
```

---

## Risk Levels

Score aditivo e determinístico — `apps/api-v2/src/guardian/risk-score-table.const.ts` (`RISK_SCORE_TABLE`) + `risk-scorer.service.ts`. Nenhum LLM envolvido, cada sinal soma um número fixo, sem overlap (mesmo signal nunca conta duas vezes).

| Sinal | Pontos | Dispara quando |
|---|---:|---|
| `serviceSemSpec` | 30 | `TestGapDetectorService` acha ≥1 arquivo testável sem spec correspondente |
| `moduloCritico` | 25 | arquivo alterado casa `CRITICAL_MODULE_PATTERNS` — ancorado em segmento/token do path: `auth/`, `mcp/`, `gateway/`, `policy/`, `agent/src/hooks/`, `security/` (não substring solta — evita falso positivo tipo "author" casando `/auth/`) |
| `alteracaoSchema` | 20 | `prisma/schema.prisma` alterado |
| `migrationSemTeste` | 20 | arquivo em `prisma/migrations/` alterado sem um companheiro com `__tests__` e `migration` no path |
| `semTesteRodado` | 15 | **reservado — ainda não alimentado** (exigiria evidência real de execução de teste) |
| `erroRecenteNoModulo` | 10 | **reservado — ainda não alimentado** |
| `jwtProximoDeExpirar` | 10 | JWT expira em ≤7 dias |
| `docDesatualizada` | 5 | **reservado — ainda não alimentado** |

Classificação (`classifyRisk`, mesmo arquivo):

| Level | Score | Deploy | Comportamento |
|---|---|---|---|
| **low** | < 30 | safe | silencioso |
| **medium** | 30–59 | review | contexto injetado |
| **high** | 60–84 | review | contexto injetado + log |
| **critical** | ≥ 85 | block | contexto + pré-push bloqueado |

`moduloCritico` (25) + `alteracaoSchema`/`migrationSemTeste` (20) já cruza o limiar `high` sozinho — combinações desse tipo são o caso mais comum de bloqueio real.

---

## Instalação

### 1. Variáveis de ambiente (`apps/agent/.env`)

```env
AGENT_GUARDIAN_ENABLED=true
AGENT_GUARDIAN_RISK_THRESHOLD=medium   # low | medium | high | critical
GUARDIAN_PROJECT_ID=<uuid-do-projeto>
AGENT_API_V2_URL=http://192.168.0.174:3103

# Webhook opcional (N8N, Telegram, Slack)
GUARDIAN_WEBHOOK_URL=
GUARDIAN_WEBHOOK_TOKEN=
```

### 2. Pre-push hook

```bash
pnpm guardian:install-hooks
```

Instala `.git/hooks/pre-push` — bloqueia `git push` se `riskLevel=critical` e o report não estiver overridden.

---

## Uso manual

### Disparar análise

```bash
curl -X POST http://localhost:3103/v2/guardian/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<uuid>",
    "repoPath": "/path/to/repo",
    "changedFiles": ["apps/api-v2/src/auth/auth.service.ts"]
  }'
```

### Consultar último report

```bash
curl http://localhost:3103/v2/guardian/latest/<projectId> \
  -H "Authorization: Bearer $TOKEN"
```

### Override de bloqueio critical

```bash
curl -X PATCH http://localhost:3103/v2/guardian/<reportId>/override \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "deploy emergencial aprovado por Marcelo"}'
```

### Histórico (últimos 20 reports)

```bash
curl http://localhost:3103/v2/guardian/history/<projectId> \
  -H "Authorization: Bearer $TOKEN"
```

---

## MCP tools (para Claude Code)

| Tool | Quando usar |
|---|---|
| `rayzen_guardian_status` | Checar estado antes de push ou ao início de sessão |
| `rayzen_guardian_analyze` | Análise imediata sem esperar o workspace-watcher |

Exemplo de uso durante sessão Claude Code:
```
// verificar antes de commitar
rayzen_guardian_status()
→ { riskLevel: "high", score: 6.5, filesWithoutTests: ["auth.service.ts"], ... }
```

---

## Página web

Disponível em `/guardian` — mostra último report, histórico, botão de override e hint de instalação do hook.

---

## Mapa de convenções de spec

| Arquivo modificado | Spec esperada |
|---|---|
| `apps/api-v2/src/X/X.service.ts` | `apps/api-v2/src/X/__tests__/X.service.spec.ts` |
| `apps/api/src/modules/X/X.service.ts` | `apps/api/src/modules/X/__tests__/X.service.spec.ts` |
| `apps/agent/src/actions/X.ts` | `apps/agent/src/actions/__tests__/X.spec.ts` |
| `apps/api-v2/src/X/X.controller.ts` | `apps/api-v2/src/X/__tests__/X.controller.spec.ts` |

Arquivos `.spec.ts`, `.test.ts` e `__tests__/` são excluídos automaticamente da análise.

---

## Arquitetura

```
apps/api-v2/src/guardian/
├── guardian.module.ts          — imports CoreModule, exporta GuardianService
├── guardian.controller.ts      — POST /analyze · GET /latest/:id · GET /history/:id · PATCH /:id/override
├── guardian.service.ts         — orquestra análise, persiste report, gerencia cache tmpdir
├── test-gap-detector.service.ts — mapeia source → spec; detecta ausência sem LLM/AST
├── risk-scorer.service.ts      — score aditivo por padrões; levels low/medium/high/critical
└── __tests__/
    ├── test-gap-detector.service.spec.ts
    └── risk-scorer.service.spec.ts

apps/agent/src/
├── guardian-client.ts          — triggerGuardianAnalysis() + webhook high/critical
├── workspace-watcher.ts        — chama guardian-client após emitWorkspaceEvent
└── hooks/
    ├── pre-push.mjs            — git hook: bloqueia push em critical
    └── rayzen-context-hook.mjs — readGuardianCache() + formatGuardianSection()

scripts/
└── install-guardian-hooks.mjs  — instala .git/hooks/pre-push

apps/web/app/
├── guardian/page.tsx           — página /guardian
└── hooks/useGuardian.ts        — hook React para latest + history + override
```
