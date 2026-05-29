# 005 — Context Engine

## Visão Geral

O Context Engine monta o **contexto relevante** para cada execução — seja para uma chamada de AI, para um step de missão, ou para uma skill que precisa entender o estado atual do projeto.

Contexto e memória são coisas diferentes: **memória** é o que o sistema sabe (knowledge base), **contexto** é o que é relevante agora para esta tarefa específica.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `orchestrator.getProjectContext()` | Monta snippet: nome, estado, goal, últimos eventos — injetado no system prompt |
| `apps/api/src/modules/project-state/` | Fornece `ProjectState` (objective, stage, milestones, blockers) |
| `apps/api/src/modules/graph/` | Fornece goal ativo com critérios e KPIs |

**Problema na V1:** Context assembly está dentro do Orchestrator, sem caching, sem templates por modo de trabalho e sem scoring de relevância. O mesmo contexto genérico vai para todos os tipos de tarefa.

---

## Gaps

- Serviço dedicado extraído do Orchestrator
- Templates de contexto por `WorkMode` (implementation/debugging/review/architecture/study)
- Context cache com TTL configurável por projeto (evitar rebuild desnecessário)
- Relevance scoring: prioriza partes do contexto mais úteis para a tarefa em questão
- Window management: contexto nunca ultrapassa N tokens (truncation inteligente)
- Integração com Memory Engine para adicionar chunks relevantes da memória

---

## Interface / Endpoints

```
POST /v2/context/build          # Constrói contexto para uma tarefa
GET  /v2/context/current/:pid   # Contexto atual em cache do projeto
DELETE /v2/context/cache/:pid   # Invalida cache do projeto
```

**Payload:**
```typescript
interface ContextBuildRequest {
  projectId:  string
  taskType:   AITaskType
  mode?:      WorkMode
  query?:     string            // busca semântica adicional na memória
  maxTokens?: number            // limite do contexto (default: 4000)
  include?:   ContextSection[]  // forçar seções específicas
}

type ContextSection =
  | 'project_state'
  | 'active_goal'
  | 'recent_events'
  | 'memory_relevant'
  | 'wiki_relevant'
  | 'planning'
  | 'blockers'

interface BuiltContext {
  sections:    Record<ContextSection, string>
  totalTokens: number
  cacheHit:    boolean
  builtAt:     Date
}
```

---

## Modelo de Dados

```typescript
interface ContextTemplate {
  id:       string
  mode:     WorkMode
  sections: ContextSection[]       // ordem e seleção de seções
  maxTokens: number
  systemPromptPrefix: string
}

// Cache (Redis)
interface ContextCacheEntry {
  projectId:  string
  context:    BuiltContext
  expiresAt:  Date
}
```

---

## Dependências

- **004 — Memory Engine**: fornece chunks relevantes via busca semântica
- **001 — Mission Engine**: fornece step atual e contexto acumulado da missão
- **002 — Router**: consome contexto construído antes de classificar
- **003 — AI Router**: recebe contexto construído junto com o prompt

---

## Fase de Implementação

**Fase 2** — após Router e Mission Engine estarem funcionando.

Ordem:
1. Extrair `getProjectContext()` do Orchestrator para `ContextEngineService`
2. Adicionar templates por `WorkMode`
3. Cache Redis com TTL
4. Integração com Memory Engine para `memory_relevant` section
5. Window management e relevance scoring (Fase 3)
