# 010 — Observability

## Visão Geral

Observabilidade na V2 vai além de métricas e logs isolados. O objetivo é ter **correlação total**: dado um `traceId`, é possível ver toda a cadeia de execução de uma requisição — desde o routing até o step da missão, o modelo chamado, o custo gerado e o resultado entregue.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/metrics/` | Contadores Prometheus: HTTP, tokens LLM, tasks do agente, duração |
| `apps/api/src/modules/event/` | Log de todas as ações (chat, memory, execution, manual, cli) |
| `apps/api/prisma/schema.prisma` → `AgentAuditLog` | Auditoria de execução do agente: action, risk, dryRun, durationMs |

**O que já funciona:**
- Métricas Prometheus em `/metrics` (JWT protegido)
- Event log com intent, source, metadata
- Audit log do agente com risk e status

**Gap principal:** Sem `traceId` — impossível correlacionar uma mensagem do usuário com todas as operações que ela gerou. Cada módulo loga de forma independente.

---

## Gaps

- `traceId` gerado no Router e propagado para todos os módulos
- `spanId` por operação dentro do trace (cada step de missão é um span)
- Mission timeline: visão cronológica completa de uma missão (routing → steps → AI calls → custo)
- Custo no metadata de eventos (tokens + USD por evento)
- Dashboard de observabilidade integrado ao painel web
- Correlação de falhas: dado um erro, quais eventos precederam

---

## Interface / Endpoints

```
GET /v2/observe/trace/:traceId        # Trace completo de uma requisição
GET /v2/observe/mission/:missionId    # Timeline da missão
GET /v2/observe/errors                # Erros recentes com contexto
GET /metrics                          # Prometheus (mantém compatibilidade V1)
```

---

## Modelo de Dados

```typescript
interface TraceSpan {
  traceId:    string          // propagado do Router até o final
  spanId:     string          // único por operação
  parentSpanId?: string       // hierarquia de spans
  service:    string          // 'router' | 'mission-engine' | 'ai-router' | 'skill-engine' | ...
  operation:  string          // nome da operação
  startedAt:  Date
  endedAt?:   Date
  durationMs?: number
  status:     'ok' | 'error' | 'timeout'
  attributes: Record<string, unknown>   // projectId, missionId, model, cost, etc.
  error?:     string
}

// Extensão do Event existente
interface EventV2 extends Event {
  traceId?:   string
  spanId?:    string
  costUsd?:   number
  tokensUsed?: number
  modelUsed?: string
}
```

**Métricas Prometheus adicionais:**
```
rayzen_mission_duration_seconds{status, project_id}
rayzen_mission_steps_total{status, step_type}
rayzen_ai_cost_usd_total{model, project_id}
rayzen_skill_executions_total{skill_id, status}
rayzen_router_decisions_total{type, confidence_bucket}
```

---

## Dependências

- Todos os componentes V2 propagam `traceId` recebido
- **001 — Mission Engine**: emite eventos de lifecycle com traceId
- **009 — Cost Controller**: custo incluído nos spans
- **002 — Router**: gera o `traceId` raiz

---

## Fase de Implementação

**Fase 4** — implementado incrementalmente: cada componente adiciona spans conforme é construído.

Ordem:
1. `TraceContext` — classe/middleware para propagar traceId via AsyncLocalStorage
2. `SpanService` — registra e persiste spans no Postgres
3. Adicionar `traceId` ao `Event` model (migration leve)
4. Endpoint `/v2/observe/trace/:traceId`
5. Mission timeline
6. Dashboard web (Fase 5)
