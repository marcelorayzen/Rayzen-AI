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
│  34 módulos, uso diário │   │  30 módulos, Mission Oriented Engineering  │
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
| `GuardianModule` | `/v2/guardian` | Monitoramento de risco de código em tempo real via lineage + detecção de arquivos sem teste — ver `docs/GUARDIAN.md` |

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

| Alias | Primary | Cadeia de fallback |
|---|---|---|
| `gpt-4o` | Groq `openai/gpt-oss-120b` | `gpt-4o-gemini` → `gpt-4o-mini-gemini` → `gpt-4o-premium` |
| `gpt-4o-mini` | Groq `openai/gpt-oss-20b` | `gpt-4o-mini-gemini` → `gpt-4o-gemini` → `gpt-4o-mini-premium` |
| `gpt-4o-gemini` | `gemini-3-flash-preview` | — |
| `gpt-4o-mini-gemini` | `gemini-3.1-flash-lite` | — |
| `gpt-4o-premium` | Claude Sonnet (direto) | — |
| `gpt-local` | Ollama `llama3.2:3b` **local** | `gpt-4o-mini` |

> ⚠️ **A tabela anterior deste documento estava errada desde 2026-08-17**: listava
> `llama-3.3-70b-versatile` e `llama-3.1-8b-instant`, os **dois** descontinuados pela Groq naquele
> dia. Todo `gpt-4o` virou 404 e a plataforma inteira devolveu 500 — corrigido no `config.yaml` na
> época, e só agora aqui.

**Até 22/08 não existia fallback.** `gpt-4o` caía em `gpt-4o-premium` e `gpt-4o-mini` em
`gpt-4o-mini-premium`, os dois na Anthropic **sem crédito** — é por isso que a descontinuação da
Groq virou queda total em vez de degradação. Os grupos Gemini entraram para que a queda de um
provedor deixe de ser queda da plataforma.

**Escolha medida na conta, não pelo catálogo:** `gemini-2.5-flash` e `gemini-2.5-pro` **aparecem**
em `GET /v1beta/models` e devolvem `NOT_FOUND — no longer available to new users` quando chamados.
Os grupos Pro exigem billing.

> **O que a cadeia custa, e ainda não está resolvido:** o fallback é por *alias*, não por
> política — a cadeia não sabe **por que** aquele grupo foi pedido.
>
> Medido em 06/09 sobre 2.780 chamadas de 7 dias (`docs/baseline-roteamento-llm.md`): o
> `gpt-4o-gemini` erra **52,4%** e é o **primeiro** fallback do `gpt-4o` — o elo mais frágil está
> na frente da fila. E **6,1%** dos pedidos a `gpt-local`, feito justamente por ser local e sem
> cota, foram servidos pela Groq: pedir "local" e receber "nuvem" é vazamento de intenção.
>
> ⚠️ Uma versão anterior deste parágrafo afirmava que uma chamada a `gpt-local` terminou num **429
> do Gemini**. **Os dados não sustentam** — em 7 dias, `gpt-local` nunca foi servido por Gemini.
> Aquilo era o Hermes ignorando a flag `-m` e usando o `model:` do próprio config: defeito do
> cliente, atribuído ao roteador. Ver "Próximos ajustes".

Os cinco grupos gratuitos são sondados pelo invariante `modelos_llm_respondem` — inclusive os dois
Gemini, porque o fallback mascara a queda do primário e sondar só o `gpt-4o` não diz se a rede
existe.

### Modelos LLM por módulo (V1)

| Módulo | Modelo (alias) | Temperature | Observações |
|---|---|---|---|
| Orchestrator — classify | gpt-4o-mini | 0 | extração JSON robusta — Claude não suporta `response_format` |
| Orchestrator — chat | gpt-4o | 0.7 | histórico completo de conversa incluído |
| ProjectState refresh | gpt-4o-premium | 0.2 | Claude Sonnet direto — análise crítica de qualidade |
| Synthesis / Checkpoint | gpt-4o | 0.3 | extração JSON com 3 estratégias de fallback |
| Documentation | gpt-4o | 0.3 | usa ProjectState como contexto primário |
| Blueprint (plan) | gpt-4o | 0.3 | gera plano Markdown estruturado |
| Graph — gap analysis | gpt-4o-mini | 0.2 | compara ProjectGoal vs ProjectState |
| Graph — KPI auto-track | gpt-4o-mini | 0.1 | evidência em eventos → valor atual do KPI |
| Memory — synthesis | gpt-4o-mini | 0.3 | resume resultados de busca |
| Document Processing | gpt-4o-mini | 0.2 | output estruturado e determinístico |
| Content Engine | gpt-4o | 0.8 | criatividade em primeiro lugar |
| Execution (Jarvis) | gpt-4o | 0.3 | respostas de tarefas práticas |
| Embeddings | jina-embeddings-v3 | — | 1024-dim, via Jina AI API (não passa pelo LiteLLM) |
| Voice TTS | Groq PlayAI Astra | — | markdown removido, chunks de 800 chars |
| Voice STT | Groq Whisper | — | arquivo de áudio → texto |

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
| Agent whitelist (45 ações) | `apps/agent/src/security/whitelist.ts` |
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

- **Roteamento de LLM por política, não por alias.** Hoje a cadeia de fallback é uma lista fixa
  por alias em `config.yaml`, e ela não sabe **por que** o modelo foi escolhido. Consequência
  medida em 06/09: uma chamada a `gpt-local` — escolhido justamente por ser local e sem cota —
  caiu na cadeia e terminou num 429 do Gemini. Um roteamento que respeitasse a *intenção*
  ("local", "barato", "capaz", "determinístico") em vez do nome do alias não faria isso.
  Perguntas abertas: onde a política mora (LiteLLM `router_settings` tem `routing_strategy`, hoje
  `least-busy`), se cada módulo declara sua intenção em vez do alias, e como medir se a escolha
  melhorou. **Baseline já medido em `docs/baseline-roteamento-llm.md`** (06/09, 7 dias): o
  `gpt-4o-gemini` erra **52,4%** sendo o 1º fallback do `gpt-4o`, o `gpt-local` erra **0%** em 411
  chamadas, e **442 dos ~615 erros são 429 de cota** — o gargalo é recurso escasso mal
  distribuído, não modelo ruim.
- Definir plano de convergência V1→V2 ou separação intencional de responsabilidades
- Testes de inferência de tipo de specialist automatizados (evitar regressão do `spec` em `specialist`)
- Documentar limites do `file_read` no context do researcher (500KB, paginação por `lines`)
