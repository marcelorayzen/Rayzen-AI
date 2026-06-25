# OBSERVABILITY — Rayzen AI

> Três camadas de observabilidade: traces LLM (Langfuse), métricas de sistema (Prometheus) e audit de agent (PostgreSQL).

---

## Objetivo

Tornar visível o que acontece no sistema: custo e latência de cada chamada LLM, saúde da infraestrutura, execuções do agent e qualidade das respostas — sem instrumentação manual por feature.

---

## Camada 1 — Traces LLM (Langfuse)

### O que captura

Toda chamada LLM que passa pelo LiteLLM proxy é automaticamente trackeada no Langfuse. Inclui:
- `model`, `provider` (Groq/Anthropic)
- `input_tokens`, `output_tokens`, `total_tokens`
- `duration_ms`, `cost_usd`
- `status` (success/failure)
- `project_id`, `module` (quando passados como metadata)
- Fallback chain (qual provider foi usado após falha do primary)

### Acesso

```
http://192.168.0.174:3200
```

Banco dedicado `langfuse` (isolado do `rayzen_ai` e `v2`).

### Uso operacional

- Monitorar custo diário por módulo
- Detectar quando Groq TPD (100k tokens/dia) está sendo esgotado
- Verificar se fallback Groq→Claude está ativando
- Identificar prompts com `duration_ms` alto (p95/p99)
- Confirmar que specialists têm traces após execução de missão

### Eventos de latência do hook

O hook PostToolUse emite evento especial `kind: hook_timing` com:
```json
{
  "hookDurationMs": 1840,
  "contextEngineDurationMs": 820,
  "cacheHit": false,
  "mode": "implementation"
}
```
Filtrar em Langfuse: `metadata.kind = hook_timing` para medir p50/p95/p99 do context pipeline.

---

## Camada 2 — Métricas de sistema (Prometheus)

### Endpoint

```
GET /metrics (JWT-protected)
http://192.168.0.174:3101/metrics
```

### Métricas coletadas

| Métrica | Tipo | Descrição |
|---|---|---|
| `http_request_duration_seconds` | Histogram | Duração HTTP por route + status code |
| `llm_tokens_total` | Counter | Tokens por módulo + modelo |
| `agent_tasks_total` | Counter | Tasks por action + status + role |
| `bullmq_queue_size` | Gauge | Tamanho da fila `agent-tasks` |
| `nodejs_heap_used_bytes` | Gauge | Memória heap (collectDefaultMetrics) |
| `nodejs_gc_duration_seconds` | Histogram | Garbage collection |
| `nodejs_eventloop_lag_seconds` | Gauge | Latência do event loop |

### Implementação

- `MetricsModule` com `prom-client`
- Hooks Fastify em `main.ts` para HTTP duration
- Hookup em `OrchestratorService` para `llm_tokens_total`
- Hookup em `AgentBridgeController` para `agent_tasks_total`

### Uso operacional

- Detectar routes com latência crescente (p99 acima do baseline)
- Monitorar crescimento de tokens por módulo ao longo do tempo
- Detectar agent tasks com alta taxa de falha por action

---

## Camada 3 — Audit log do Agent (PostgreSQL)

### Tabela `agent_audit_logs`

```sql
taskId       uuid
actor        text    -- 'system' | email do usuário
module       text    -- ex: 'memory', 'execution'
action       text    -- ex: 'jarvis:file_write'
command      text    -- null exceto run_command
risk         text    -- 'none' | 'low' | 'medium' | 'high'
dryRun       bool
durationMs   int
status       text    -- 'done' | 'failed'
hostname     text
workspace    text    -- path do projeto
targetRole   text    -- 'desktop' | 'server'
createdAt    datetime
```

### Acesso

```
GET /tasks/audit?action=jarvis:file_write&status=done&actor=system
```

### Uso operacional

- Verificar se ações destrutivas tiveram dryRun antes da execução real
- Auditar execuções de `run_command` (campo `command` preenchido)
- Detectar ações `failed` recorrentes por action (sinal de bug na implementação)
- Comprovar tempo de execução por tipo de ação

---

## Saúde da infraestrutura

### Health check

```
GET /infra/health
→ {
    postgres: 'ok'|'error',
    redis: 'ok'|'error',
    litellm: 'ok'|'error',
    apiV2: 'ok'|'error',
    mcp: 'ok'|'error',
    jwtExpiry: '2026-07-04T...'
  }
```

Retorna validade do JWT — sinal de alerta quando `jwtExpiry` está próximo.

### Health score por projeto

```
GET /projects/:id/health
→ { score: 74, breakdown: { activity: 82, docs: 100, consistency: 40, ... }, history: [...] }
```

6 dimensões, histórico 30 dias, calculado ao final de cada refresh de ProjectState.

---

## Observabilidade de missões V2

Cada execução de missão gera:
- `SpecialistInstance` no banco v2 com `status`, `costUsd`, `iterations`, `startedAt`, `completedAt`
- `TraceSpan` com duração por step
- ApprovalGate se clarificação ou aprovação necessária

Verificar traces no Langfuse para confirmar que cada specialist gerou spans visíveis.

---

## Contratos críticos

| Sinal | Onde consultar | Latência do sinal |
|---|---|---|
| Custo por sessão | Langfuse dashboard | Real-time |
| Hook timing (p50/p95/p99) | Langfuse filter: `kind=hook_timing` | Por sessão |
| HTTP latência | Prometheus `/metrics` | Por scrape |
| Agent tasks falhas | `agent_audit_logs` / GET /tasks/audit | Por execução |
| JWT expiry | GET /infra/health | Real-time |
| Benchmark fitness | `BenchmarkResult` / GET /v2/benchmark/strategy/:id | Por ciclo QA |

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Langfuse sem auth interna | Isolado na rede Docker; sem exposição externa via Cloudflare |
| Prometheus endpoint sem rate limit | Protegido por JWT |
| Audit log crescimento ilimitado | Não há TTL/purge hoje — considerar archive após 90 dias |
| Traces de specialists sem projectId | Metadata `projectId` deve ser passado na chamada LiteLLM |

---

## Critérios de pronto

- Toda chamada LLM nova → span visível no Langfuse com model + tokens + duration
- Novo módulo com tasks de agent → hookup em `AgentBridgeController` para `agent_tasks_total`
- JWT renovado antes de `jwtExpiry` (alerta via GET /infra/health)
- Specialist execution → SpecialistInstance com `costUsd` e `iterations` preenchidos

---

## Próximos ajustes

- Alertas automáticos: Groq TPD > 80% → notificação (webhook/email)
- Dashboard Grafana sobre o Prometheus (hoje consultado manualmente via `/metrics`)
- Purge automático de `agent_audit_logs` após 90 dias
- `projectId` como campo obrigatório nos metadata LiteLLM para todos os módulos V2
