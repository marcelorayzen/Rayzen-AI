# CONTEXT_PIPELINE — Rayzen AI

> Pipeline de injeção de contexto cirúrgico antes de cada prompt ao Claude. Implementado no hook UserPromptSubmit + ContextEngineService.

---

## Objetivo

Garantir que o Claude receba, automaticamente e antes de pensar, o contexto do projeto mais relevante para a intenção detectada — sem chamadas MCP manuais, sem tokens gastos em re-derivação.

---

## Fluxo real

```
Usuário digita prompt
  │
  ▼ UserPromptSubmit (rayzen-context-hook.mjs)
  │
  ├─ [1] classifyIntent(text) → mode: debugging|implementation|architecture|review|study
  ├─ [2] extractQuery(text) → primeiros 200 chars, sem code fences
  ├─ [3] resolveProjectId() → git remote → /projects?repoSlug → slug cache 5 min
  │
  ├─ [4] cacheKey = MD5(projectId:mode:query)
  │      ├─ HIT  → retorna contexto cached (TTL 3 min) → skip para [8]
  │      └─ MISS → continua
  │
  ├─ [5] POST /v2/context/build (timeout 2.2s)
  │      └─ ContextEngineService.build()
  │           ├─ sections = MODE_SECTIONS[mode]
  │           ├─ v1Bridge.getProjectState() → project_state section
  │           ├─ v1Bridge.getActiveGoal()   → active_goal section
  │           ├─ v1Bridge.getRecentEvents() → recent_events section
  │           ├─ memory.search(query, mode) → memory_relevant section (com mode boost)
  │           ├─ v1Bridge.getPlanning()     → planning section
  │           ├─ knowledge.query(query)     → knowledge_graph section
  │           ├─ policy.getConstraints()    → policy_constraints section
  │           └─ gates.findPending()        → approval_gates section
  │
  ├─ [6] fallback (se /v2/context/build falhar) → GET /projects/:id/state
  │
  ├─ [7] Paralelo: GET /v2/missions/next-pending → missão ativa appended ao contexto
  │
  ├─ [8] formatContextEngine() → string Markdown estruturada por seção
  │
  └─ [9] console.log({ additionalContext: "..." }) → Claude recebe antes de processar
```

---

## ContextEngineService (`apps/api-v2/src/context-engine/context-engine.service.ts`)

### Interface

```ts
interface ContextBuildRequest {
  projectId:  string
  mode?:      'implementation' | 'debugging' | 'review' | 'architecture' | 'study'
  query?:     string       // busca semântica para memory_relevant e knowledge_graph
  maxTokens?: number       // default 4000 → ~16k chars
  include?:   ContextSection[]  // override das sections do modo
}

interface BuiltContext {
  sections:   Partial<Record<ContextSection, string>>
  text:       string       // concatenado, pronto para injetar
  totalChars: number
  cacheHit:   boolean
  builtAt:    Date
}
```

### Sections por modo

| Modo | Seções |
|---|---|
| `implementation` | project_state, planning, policy_constraints, memory_relevant, recent_events, approval_gates |
| `debugging` | project_state, blockers, memory_relevant, recent_events, knowledge_graph, approval_gates |
| `review` | project_state, active_goal, memory_relevant, planning, knowledge_graph |
| `architecture` | project_state, active_goal, planning, blockers, policy_constraints, knowledge_graph |
| `study` | project_state, memory_relevant, recent_events, knowledge_graph |

### Cache

- In-memory `Map<string, { ctx, expiresAt }>` dentro do serviço NestJS
- TTL: 5 minutos
- Cache key: `${projectId}:${mode}:${query}`
- Hook-side cache: arquivo `rayzen-ctx-smart-cache.json` no tmpdir, TTL 3 min
- Dois níveis de cache evitam chamadas desnecessárias em prompts consecutivos similares

---

## Memory search com mode boost

```ts
// MemoryService aplica boost de score por classe conforme modo
const MODE_CLASS_BOOST = {
  debugging:      { working: +0.15, inbox: +0.05 },
  review:         { consolidated: +0.15, archive: +0.05 },
  architecture:   { consolidated: +0.20 },
  implementation: { working: +0.10, inbox: +0.05 },
  study:          { consolidated: +0.10, inbox: +0.05 },
}
// Resultado: modo "architecture" prefere memórias consolidadas (decisões)
// Modo "debugging" prefere memórias em working (problemas em andamento)
```

---

## Formato do contexto injetado

```markdown
### Rayzen — contexto [implementation]
Objective: ...
Stage: stabilizing

**Memória relevante:**
...

**Próximos passos:**
...

**Atividade recente:**
...

**Políticas ativas:**
[GATE] deployment_requires_review: ...

**Gates pendentes:**
[IRREVERSIBLE] Specialist Software Architect requires approval (gate=..., mission=...)

_(contexto cirúrgico injetado pelo hook — mode: implementation)_

### Missão ativa
**Título da missão**
Objetivo: ...
Status: active · N/M steps concluídos
...
```

---

## Fallback chain

```
POST /v2/context/build (timeout 2.2s)
  └─ falha ou timeout
       └─ GET /projects/:id/state (timeout 1.5s)
            └─ fallback → { objective, stage, blockers, nextSteps } formatados
                 └─ falha → process.exit(0) → Claude segue sem contexto
```

---

## Contratos críticos

| Endpoint | Método | Timeout |
|---|---|---|
| `/v2/context/build` | POST | 2.2s (hook) |
| `/projects/:id/state` | GET | 1.5s (fallback) |
| `/v2/missions/next-pending?projectId=` | GET | 1.0s (paralelo) |

---

## Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| api-v2 fora do ar | Claude recebe contexto básico do /state (V1) | Fallback automático |
| Context > 2.5s | Hook timeout → Claude sem contexto cirúrgico | Cache de 3 min absorve a maioria dos casos |
| Modo classificado errado | Seções incorretas injetadas | regex testada; casos edge registrados nos hooks/qa-scientist |
| Cache stale (3 min) com contexto desatualizado | Decisões antigas injetadas | TTL curto (3 min) minimiza; missão ativa é sempre fresca (sem cache) |
| Memory search retorna docs de outro projeto | Contaminação de contexto | `projectId` sempre passado na busca |

---

## Critérios de pronto

- p99 do hook < 2.5s (medido via eventos `kind: hook_timing` no Langfuse)
- Cache hit rate > 60% em sessões normais de trabalho
- Modo classificado corretamente para os 5 perfis de intenção
- Missão ativa sempre reflete estado atual (sem cache)
- Fallback para /state funciona quando api-v2 estiver offline

---

## Próximos ajustes

- Métricas de cache hit rate por modo no Langfuse
- Seção `diff_recent` para modo `review` (arquivos modificados recentemente)
- Limite de chars por seção configurável por projeto (projetos grandes geram seções mais longas)
- Teste automatizado do fallback chain com api-v2 simulada offline
