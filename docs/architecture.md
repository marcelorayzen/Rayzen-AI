# ARCHITECTURE — Rayzen AI

> Referência operacional. Cobre V1 (:3101) + V2 (:3103). Atualiza a versão anterior V1-only.

---

## Objetivo

Documentar o estado real da plataforma — componentes, fluxos de dados, contratos e invariantes de segurança — para orientar novas decisões sem rederivação.

---

## Visão geral

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT LAYER                                   │
│  Browser (Next.js 16)  ·  Claude Code (hooks)  ·  MCP client  ·  PC Agent │
└──────────┬────────────────────────────────────┬────────────────────────────┘
           │ HTTP / SSE                          │ BullMQ poll (3s)
┌──────────▼──────────────┐   ┌─────────────────▼─────────────────────────┐
│  V1 API — NestJS/Fastify│   │  V2 API — NestJS/Fastify                  │
│  :3101  schema: public  │   │  :3103  schema: v2  prefixo: /v2          │
│  28 módulos, uso diário │   │  26 módulos, Mission Oriented Engineering  │
└──────────┬──────────────┘   └─────────────────┬─────────────────────────┘
           │                                     │
┌──────────▼─────────────────────────────────────▼──────────────────────────┐
│                          INFRASTRUCTURE LAYER                              │
│  PostgreSQL 16+pgvector │ Redis 7+BullMQ │ LiteLLM :4100 │ Langfuse :3200 │
│  schemas: public/v2/    │  agent-tasks   │  proxy + cache │  traces LLM   │
│  langfuse               │  app cache     │  fallback chain│               │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## V1 — Módulos (:3101, schema `public`)

| Módulo | Prefixo | Responsabilidade |
|---|---|---|
| `OrchestratorModule` | `/orchestrate` | Classify intent + routing + SSE + work modes |
| `MemoryModule` | `/memory` | Indexação semântica + busca pgvector (Jina 1024-dim) |
| `BrainModule` | `/brain` | indexDocument/URL/text + similaridade |
| `ExecutionModule` | `/execution` | Dispatch para PC Agent via BullMQ |
| `SynthesisModule` | `/synthesis` | Síntese de sessão + checkpoint pipeline |
| `DocumentationModule` | `/documentation` | 5 tipos de doc gerados por LLM |
| `ProjectStateModule` | `/projects/:id/state` | Estado estruturado: milestones, backlog, activeFocus |
| `HealthModule` | `/projects/:id/health` | Score 0-100, 6 dimensões, histórico 30 dias |
| `EventModule` | `/events` | Log com hierarchy `inbox→working→consolidated→archive` |
| `WikiModule` | `/wiki` | Knowledge base versionada com lock/merge |
| `BlueprintModule` | `/blueprint` | Importação de planos → wiki + brain + state + events |
| `GraphModule` | `/projects/:id/graph` | Goal Graph com `@xyflow/react`, KPIs, gap analysis |
| `ProactiveModule` | `/projects/:id/recommendations` | 7 regras proativas |
| `DocumentProcessingModule` | `/documents` | PDF (Puppeteer) + DOCX (docxtemplater) |
| `MetricsModule` | `/metrics` | Prometheus: HTTP, tokens, Agent tasks, queue |
| `DataQualityModule` | `/data-quality` | Regras, score, schema diff |
| `QAModule` | `/qa` | JUnit XML / Allure JSON ingestion |
| `CostsModule` | `/costs` | Custo real por módulo/projeto |
| `AgentBridgeModule` | `/tasks` | Auth agent + BullMQ lifecycle |
| `AuthModule` | `/auth` | JWT 8h, throttle 10 req/min |

---

## V2 — Módulos (:3103, prefixo `/v2`, schema `v2`)

| Módulo | Prefixo | Responsabilidade |
|---|---|---|
| `RouterModule` | `/v2/route` | Entry point público — classifica e despacha para missions |
| `MissionModule` | `/v2/missions` | CRUD missões + steps + DAG dependsOn |
| `WorkflowEngineModule` | interno | Execução do DAG, gate detection, transitions |
| `StepExecutorModule` | interno | Spawn specialist, coleta prevOutputs (só `result`, max 12k chars) |
| `SpecialistModule` | `/v2/specialists` | runtime loop: tool dispatch, maxIterations, custo |
| `SpecialistRegistryModule` | interno | 7 tipos: coder/reviewer/tester/architect/researcher/debugger/synthesizer |
| `SkillEngineModule` | `/v2/skills` | Dispatch de tools para PC Agent; `toToolName()` sanitiza `:` → `__` |
| `AIRouterModule` | interno | Chamadas LLM com tool definitions, Anthropic-compatible |
| `ApprovalGatesModule` | `/v2/approvals` | Gates pending/approve/reject; gate-resume reseta step para `pending` |
| `AgentDialogueModule` | `/v2/dialogue` | ClarificationService: `checkTask` antes de spawn |
| `ContextEngineModule` | `/v2/context` | Build cirúrgico por modo (5 sections), cache 5 min in-memory |
| `MemoryModule` (V2) | `/v2/memory` | MemoryMeta lifecycle + V1 bridge para pgvector |
| `KnowledgeModule` | `/v2/knowledge` | Grafo: extractor, governance, query, impact, lineage |
| `BenchmarkModule` | `/v2/benchmark` | Casos golden + run por estratégia + extração de traces |
| `QAScientistModule` | `/v2/qa-scientist` | Ciclo 24h: collectFailures → hypotheses → experiments |
| `EvolutionaryPromptingModule` | `/v2/evolutionary` | Geração e mutação de estratégias de prompt |
| `PolicyEngineModule` | `/v2/policy` | Regras GATE/BLOCK/WARN por projeto |

---

## Data stores

### PostgreSQL 16 + pgvector

| Schema | Tabelas-chave |
|---|---|
| `public` (V1) | `documents` (embedding vector(1024)), `conversation_messages`, `events`, `project_states`, `project_documents`, `session_artifacts`, `project_goals`, `wiki_pages`, `task_logs`, `agent_audit_logs` |
| `v2` (V2) | `Mission`, `MissionStep`, `ApprovalGate`, `SpecialistInstance`, `BenchmarkCase`, `BenchmarkResult`, `KnowledgeNode`, `KnowledgeEdge`, `MemoryMeta`, `PromptStrategy`, `TraceSpan` |
| `langfuse` | Banco dedicado, isolado — traces de todas as chamadas LiteLLM |

### Redis 7

| Uso | TTL |
|---|---|
| BullMQ `agent-tasks` (dispatch V1) | Lifecycle (sem TTL) |
| App cache ProjectState | 10 min |
| App cache Wiki | 15 min |
| App cache Brain search | 5 min |
| LiteLLM exact-match | 5 min |
| Context Engine (in-memory Map) | 5 min |

---

## LiteLLM Proxy (:4100)

**Invariante:** toda chamada LLM passa pelo proxy. Nunca apontar direto para OpenAI/Groq/Anthropic.

| Alias | Primary | Fallback |
|---|---|---|
| `gpt-4o` | Groq llama-3.3-70b-versatile | Claude Sonnet 4.6 |
| `gpt-4o-mini` | Groq llama-3.1-8b-instant | Claude Haiku 4.5 |
| `gpt-4o-premium` | Claude Sonnet 4.6 (direto) | — |
| `gpt-local` | Groq llama-3.1-8b | `gpt-4o-mini` |

Fallback chain em `infra/litellm/config.yaml` — evita bloqueio por Groq TPD (100k tokens/dia).

---

## Contratos críticos

### V1 Agent dispatch (BullMQ)

```
POST /execution/dispatch → { projectId, module, action, payload }
PATCH /tasks/:id         → { status, result?, actor, module, action, risk, dryRun, durationMs }
```

### V2 prevOutputs injection

```
// StepExecutorService injeta só output.result (texto puro), truncado a 12k chars
### Step "título" output
<conteúdo do resultado>
[... truncado após 12k chars]
```

### V2 Specialist types e inferência

| Tipo | Modelo | Regex de inferência |
|---|---|---|
| `synthesizer` | gpt-4o-premium | `summarize\|tabela\|com base\|relatorio\|resumo` |
| `researcher` | gpt-4o | `leia\|liste\|inspect\|read.*file` |
| `coder` | gpt-4o | `implement\|build\|develop\|code` |
| `reviewer` | gpt-4o | `review\|check\|audit\|validate` |
| `tester` | gpt-4o | `\btests?\b\|\bspecs?\b\|coverage\|assert` (word boundary) |
| `architect` | gpt-4o-premium | `architect\|design\|structure\|\badr\b` |
| `debugger` | gpt-4o | `debug\|fix\|error\|bug\|crash` |

---

## Modelo de segurança

| Controle | Onde |
|---|---|
| JWT 8h, throttle login | `AuthModule` + `@Throttle` |
| CORS whitelist | `CORS_ORIGINS` env var |
| Security headers | `@fastify/helmet` — CSP, HSTS 1 ano |
| Agent whitelist (44 ações) | `apps/agent/src/security/whitelist.ts` |
| Role policy (desktop/server) | `apps/agent/src/role-policy.ts` |
| Path traversal bloqueado | `path.relative()` em todo acesso filesystem |
| dryRun obrigatório | Ações de risco médio/alto |
| Prompt injection | `ValidationService.assertValidPrompt()` |
| Audit trail | `agent_audit_logs` — toda execução persistida |

---

## Riscos conhecidos

| Risco | Mitigação atual |
|---|---|
| V1/V2 coexistindo indefinidamente | V1BridgeService: V2 lê `public`, nunca escreve |
| Groq TPD (100k/dia) bloqueando specialists | Fallback `gpt-4o → gpt-4o-premium` |
| `prisma db push` sem histórico no schema v2 | Decisão documentada em ADR — shadow DB falha multi-schema |
| Anthropic rejeita tool names com `:` | `toToolName()` sanitiza `jarvis:x → jarvis__x` |

---

## Critérios de pronto

- Toda rota nova documentada neste arquivo antes do merge
- Mudança de schema → `pnpm --filter api db:generate` antes do commit
- Novo specialist type → `infer()` atualizado + missão de verificação executada
- Novo módulo V2 → V1BridgeService auditado (sem escrita em `public`)

---

## Próximos ajustes

- Definir plano de convergência V1→V2 ou separação intencional de responsabilidades
- Testes de inferência de tipo de specialist automatizados (evitar regressão do `spec` em `specialist`)
- Documentar limites do `file_read` no context do researcher (500KB, paginação por `lines`)
