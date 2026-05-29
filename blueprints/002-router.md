# 002 — Router

## Visão Geral

O Router é o ponto de entrada de toda requisição V2. Ele recebe a intenção do usuário, classifica, enriquece com contexto e decide o próximo passo: criar uma missão, executar uma skill diretamente, ou responder via AI.

Na V1 esse papel é feito pelo `orchestrator`, mas misturado com síntese, confirmações e geração de resposta. Na V2, o Router tem responsabilidade única: **decidir para onde a requisição vai**.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/orchestrator/orchestrator.service.ts` | Classificação LLM de intent + routing para 5 módulos |
| `apps/api/src/modules/orchestrator/orchestrator.controller.ts` | `POST /orchestrate` e `POST /orchestrate/stream` |
| `ACTION_RISK` dict no orchestrator | Modelo de risco de ações já existe |

**Problema na V1:** classificação, enriquecimento de contexto, síntese e roteamento estão no mesmo serviço. Difícil de testar e evoluir separadamente.

---

## Gaps

- Separação clara: `RouterService` só decide, não executa
- Regras de prioridade explícitas: skill > AI local > AI cloud
- Feedback loop: resultado da execução melhora futuras classificações
- Decouple do enriquecimento de contexto (vai para `005-context-engine`)
- Suporte a routing de missões (não só mensagens únicas)
- Roteamento por tipo: `message | mission | skill | query`

---

## Interface / Endpoints

```
POST /v2/route          # Rota principal — classifica e despacha
POST /v2/route/stream   # Versão streaming com SSE
GET  /v2/route/debug    # Explica a última decisão de routing (dev only)
```

**Payload entrada:**
```typescript
interface RouteRequest {
  content:   string
  projectId: string
  sessionId?: string
  mode?:     'auto' | 'mission' | 'skill' | 'chat'
  context?:  Record<string, unknown>
}
```

**Payload saída:**
```typescript
interface RouteDecision {
  type:        'mission' | 'skill' | 'ai' | 'clarification'
  target:      string           // missionId | skillId | 'chat' | 'opus'
  confidence:  number           // 0-1
  reasoning:   string
  payload:     Record<string, unknown>
}
```

---

## Modelo de Dados

```typescript
interface RoutingRule {
  id:       string
  pattern:  string         // regex ou keyword
  type:     RouteDecision['type']
  target:   string
  priority: number         // maior = avaliado primeiro
  enabled:  boolean
}

interface RoutingLog {
  id:         string
  projectId:  string
  input:      string
  decision:   RouteDecision
  outcome?:   'success' | 'failure' | 'pending'
  createdAt:  Date
}
```

---

## Dependências

- **001 — Mission Engine**: cria ou retoma missões
- **003 — AI Router**: delega classificação de intent quando não há regra determinística
- **005 — Context Engine**: fornece contexto enriquecido antes da classificação
- **006 — Skill Engine**: executa skills quando o routing é direto
- **010 — Observability**: loga decisão de routing com trace ID

---

## Fase de Implementação

**Fase 1** — junto com Mission Engine e Memory Engine.

Ordem:
1. `RouterService.classify()` — adapta lógica existente do orchestrator
2. `RouterService.route()` — despacha para destino certo
3. `RouterController` — expõe endpoints
4. Regras determinísticas (sem LLM) para casos comuns
5. Feedback loop (Fase 3)
