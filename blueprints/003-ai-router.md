# 003 — AI Router

## Visão Geral

O AI Router decide **qual modelo de IA usar** para cada tarefa, balanceando custo, qualidade e latência. A premissa central: a IA mais cara (Opus) só é acionada quando modelos menores não são suficientes.

Hierarquia de seleção:
```
Tier 0: Determinístico / Skill (custo zero)
Tier 1: Modelo local via Ollama (custo zero)
Tier 2: Claude Haiku / Groq llama-3.1-8b (barato)
Tier 3: Claude Sonnet / Groq llama-3.3-70b (médio)
Tier 4: Claude Opus (caro — apenas tarefas estratégicas)
```

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `orchestrator.classify()` | Usa `gpt-local` (Groq 8b) para classificar intent |
| `infra/litellm/config.yaml` | Aliases `gpt-4o`, `gpt-4o-mini`, `gpt-4o-premium` já mapeiam tiers |
| `ACTION_RISK` dict | Risco de ação já categorizado (low/medium/high) |
| `docker-compose.yml` → `ollama` service | Ollama disponível em `:11434` mas **sem uso real** |

**Problema na V1:** Sem seleção dinâmica — cada módulo hardcoda o modelo. Não existe lógica de escalação ou fallback por complexidade.

---

## Gaps

- Serviço dedicado de seleção de modelo com lógica de escalação
- Integração real com Ollama (tier 0) para tarefas simples
- Threshold de confiança configurável por projeto/missão
- Log de decisões de modelo (qual tier foi usado, por quê, custo estimado)
- Retry automático subindo tier se resposta for insuficiente
- Interface com `009-cost-controller` para budget enforcement

---

## Interface / Endpoints

```
POST /v2/ai/complete       # Completa com seleção automática de modelo
POST /v2/ai/complete/force # Força modelo específico
GET  /v2/ai/models         # Lista modelos disponíveis por tier
GET  /v2/ai/models/health  # Status dos modelos (Ollama online? Groq latência?)
```

**Payload entrada:**
```typescript
interface AIRequest {
  prompt:      string
  systemPrompt?: string
  tier?:       0 | 1 | 2 | 3 | 4   // forçar tier mínimo
  maxTier?:    0 | 1 | 2 | 3 | 4   // limitar tier máximo
  projectId?:  string               // para aplicar budget do projeto
  taskType?:   AITaskType
}

type AITaskType =
  | 'classify'        // → tier 1-2
  | 'summarize'       // → tier 1-2
  | 'generate_code'   // → tier 2-3
  | 'analyze'         // → tier 3
  | 'strategic'       // → tier 4
  | 'embed'           // → Jina (fora dos tiers)
```

**Payload saída:**
```typescript
interface AIResponse {
  content:     string
  modelUsed:   string
  tier:        number
  tokensIn:    number
  tokensOut:   number
  costUsd:     number
  durationMs:  number
  retries:     number
}
```

---

## Modelo de Dados

```typescript
interface ModelTierConfig {
  tier:      number
  models:    string[]          // ex: ['ollama/llama3.2', 'groq/llama-3.1-8b']
  maxTokens: number
  costPer1M: number            // USD por 1M tokens
  taskTypes: AITaskType[]      // task types adequados para este tier
  online:    boolean           // saúde atual
}
```

---

## Dependências

- **002 — Router**: recebe tarefa e nível de complexidade estimado
- **009 — Cost Controller**: verifica budget antes de usar tier alto
- **013 — Local Models**: tier 0 e 1 dependem de Ollama configurado
- **010 — Observability**: log de cada decisão de modelo

---

## Fase de Implementação

**Fase 2** — após Mission Engine e Router.

Ordem:
1. `AIRouterService.selectModel(task)` — lógica de tier por task type
2. Integração Ollama como tier 1 (verificação de saúde)
3. `AIRouterService.complete()` com retry escalando tier
4. Endpoints REST
5. Budget check via Cost Controller (Fase 4)
