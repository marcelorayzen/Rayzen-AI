# 009 — Cost Controller

## Visão Geral

O Cost Controller monitora e **enforça** limites de custo de IA por projeto e missão. Na V1 os custos são registrados mas nunca bloqueiam execução. Na V2, o Cost Controller é um guardião ativo: antes de chamar um modelo de AI, o AI Router consulta se há budget disponível.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/costs/` (se existir) ou campos em `ConversationMessage` | `tokensUsed` é registrado por mensagem mas sem agregação centralizada |
| `apps/api/src/modules/orchestrator/` | Loga `tokens_used` e `duration_ms` por chamada LLM |
| Cada módulo LLM | Loga tokens individualmente, sem budget check |

**Status na V1:** Existe logging de tokens mas não existe um `CostController` como módulo dedicado. Budget enforcement = inexistente.

---

## Gaps

- Modelo `CostBudget` por projeto com limite diário/mensal/por missão
- `CostControllerService.canSpend(projectId, estimatedCost)` — chamado antes de toda IA
- Alertas quando budget atinge 80%/100%
- Sugestões automáticas de downgrade de modelo quando custo está alto
- Custo por skill (skills que usam IA têm custo estimado no `SkillDefinition`)
- Dashboard de custos: breakdown por projeto, missão, modelo, dia

---

## Interface / Endpoints

```
GET  /v2/costs/:projectId             # Custos do projeto (total, por modelo, por missão)
GET  /v2/costs/:projectId/budget      # Budget atual e consumo
POST /v2/costs/:projectId/budget      # Define budget
GET  /v2/costs/:projectId/breakdown   # Breakdown detalhado por missão
POST /v2/costs/estimate               # Estima custo antes de executar
```

---

## Modelo de Dados

```typescript
interface CostBudget {
  id:         string
  projectId:  string
  daily?:     number    // USD
  monthly?:   number    // USD
  perMission?: number   // USD por missão
  alertAt:    number    // % do budget para alertar (ex: 0.8)
  blockAt:    number    // % do budget para bloquear (ex: 1.0)
  createdAt:  Date
}

interface CostRecord {
  id:        string
  projectId: string
  missionId?: string
  stepId?:   string
  model:     string
  tokensIn:  number
  tokensOut: number
  costUsd:   number
  module:    string     // qual componente gerou o custo
  createdAt: Date
}

interface BudgetStatus {
  projectId:    string
  period:       'daily' | 'monthly'
  limit:        number
  consumed:     number
  remaining:    number
  percentUsed:  number
  status:       'ok' | 'warning' | 'blocked'
}
```

**Preços por modelo (atualizar conforme API):**
```typescript
const MODEL_COST_PER_1M: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':   { input:  0.25, output:  1.25 },
  'groq/llama-3.3-70b': { input:  0.59, output:  0.79 },
  'groq/llama-3.1-8b':  { input:  0.05, output:  0.08 },
  'ollama/*':           { input:  0.00, output:  0.00 },
}
```

---

## Dependências

- **003 — AI Router**: consulta `canSpend()` antes de chamar modelo
- **006 — Skill Engine**: registra custo de skills pagas
- **001 — Mission Engine**: budget por missão
- **010 — Observability**: métricas de custo expostas via Prometheus

---

## Fase de Implementação

**Fase 4** — após AI Router e Skill Engine funcionando.

Ordem:
1. `CostRecord` model (migration Prisma)
2. `CostControllerService` com `canSpend()` e `record()`
3. `CostBudget` model + endpoints
4. Integração no AI Router (consulta antes de cada chamada)
5. Alertas e sugestões de downgrade
