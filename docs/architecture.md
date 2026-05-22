# Architecture — Rayzen AI

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                  │
│   Browser (Next.js 16.2.2 App Router)  ·  PC Agent (Node.js desktop)   │
└────────────────────┬────────────────────────────────┬───────────────────┘
                     │ HTTP / SSE                      │ BullMQ poll (3 s)
┌────────────────────▼────────────────────────────────▼───────────────────┐
│                        API LAYER  (NestJS 10 + Fastify)                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │               OrchestratorModule  (intent router)               │   │
│  │   classify() → JSON {module, action, confidence}                │   │
│  │   handleMessage() → validates → routes → streams reply via SSE  │   │
│  └────┬──────────┬──────────┬──────────┬─────────────┬────────────┘   │
│       │          │          │          │             │                  │
│  ┌────▼──┐ ┌────▼────┐ ┌───▼──────┐ ┌▼───────────┐ │                  │
│  │Memory │ │Execution│ │Document  │ │Content     │ │                  │
│  │Module │ │Module   │ │Processing│ │Engine      │ │                  │
│  └───┬───┘ └────┬────┘ └──────────┘ └────────────┘ │                  │
│      │         │                                    │                  │
│  ┌───▼──────────────────────────────────────────┐   │                  │
│  │  ValidationModule  (cross-cutting)           │   │                  │
│  │  prompt injection · output schema · routing  │   │                  │
│  └──────────────────────────────────────────────┘   │                  │
│                                                     │                  │
│  ┌──────────────────────────────────────────────────▼──┐               │
│  │  SessionModule  (GET /sessions, DELETE /sessions/:id)│               │
│  └─────────────────────────────────────────────────────┘               │
│                                                                         │
│  CacheModule (@Global) ─── Redis TTL cache para ProjectState/Wiki/Brain │
└──────────────┬──────────────────────────────────────────────────────────┘
               │
   ┌───────────▼────────────────────────────────────────┐
   │               INFRASTRUCTURE LAYER                  │
   │                                                     │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
   │  │ PostgreSQL 16│  │  Redis 7     │  │LiteLLM   │  │
   │  │ + pgvector   │  │  + BullMQ 5  │  │proxy     │  │
   │  │  vector(1024)│  │  agent-tasks │  │:4100     │  │
   │  │              │  │  + app cache │  │          │  │
   │  └──────────────┘  └──────────────┘  └──────────┘  │
   └─────────────────────────────────────────────────────┘
```

## Module Catalogue

| Module | Controller prefix | Responsibility |
|---|---|---|
| `OrchestratorModule` | `/orchestrate` | LLM intent classification + routing + SSE streaming + work modes |
| `MemoryModule` | `/memory` | Semantic document indexing + pgvector similarity search |
| `BrainModule` | `/brain` | Embeddings Jina 1024-dim · indexDocument/indexUrl/indexText · busca pgvector |
| `ExecutionModule` | `/execution` | Dispatch tasks to PC Agent via BullMQ |
| `DocumentProcessingModule` | `/documents` | PDF generation (Puppeteer) + DOCX (docxtemplater) + download |
| `ContentEngineModule` | `/content-engine` | Long-form content + editorial calendar + Mermaid diagrams |
| `SessionModule` | `/sessions` | Conversation history, token stats, session management |
| `VoiceModule` | `/voice` | TTS synthesis (Groq PlayAI) + STT transcription (Whisper) |
| `ValidationModule` | `/validation` | Prompt injection detection, output schema validation |
| `ConfigurationModule` | `/configuration` | System personality / behaviour via `rayzen.config.json` |
| `AgentBridgeModule` | `/tasks` | PC Agent authentication + BullMQ task queue |
| `AuthModule` | `/auth` | JWT authentication (8h expiry, throttle 10 req/min) |
| `ProjectModule` | `/projects` | Project CRUD + Notion page auto-creation |
| `ProjectStateModule` | `/projects/:id/state` | Structured state: milestones, backlog, activeFocus, resume brief |
| `HealthModule` | `/projects/:id/health` | 6-dimension score (0–100) + 30-day history |
| `SynthesisModule` | `/synthesis` | Session synthesis + checkpoint pipeline (state + docs + Universe) |
| `DocumentationModule` | `/documentation` | 5 doc types: project_state, decisions_log, next_actions, work_journal, data_map |
| `ProactiveModule` | `/projects/:id/recommendations` | 7 rules: inactivity, doc_stale, blocker, next_step, consistency, drift, goal_stagnant |
| `EventModule` | `/events` | Event log with memory_class hierarchy (inbox → working → consolidated → archive) |
| `WikiModule` | `/wiki` | Versioned knowledge base with source traceability |
| `ObsidianModule` | `/obsidian` | Vault sync with conflict detection |
| `GitModule` | `/events/git` | Git webhook + repository context |
| `NotionModule` | `/notion` | Notion API: search, read, create, append, update title |
| `DataQualityModule` | `/data-quality` | Rules, results, score history, schema diff |
| `DataCatalogModule` | `/data-catalog` | Asset catalogue with lineage graph and impact analysis |
| `QAModule` | `/qa` | Test run ingestion (JUnit XML / Allure JSON) |
| `CacheModule` | — | @Global Redis cache: TTL per type, delPattern, graceful degradation |
| `CostsModule` | `/costs` | LLM cost summary by module/project with USD estimates |
| `BlueprintModule` | `/blueprint` | External plan import: wiki + brain + state + events in one command |
| `GraphModule` | `/projects/:id/graph` | Goal Graph: milestones, blockers, gap analysis (LLM), KPI auto-track |

## Data Stores

### PostgreSQL 16 + pgvector 0.7

| Table | Purpose |
|---|---|
| `documents` | Indexed knowledge chunks with `embedding vector(1024)` |
| `conversation_messages` | Full message history with `tokens_used`, `module`, `projectId` per call |
| `events` | Activity log: source, type, intent, memory_class |
| `project_states` | Structured project state: milestones, blockers, nextSteps, backlog, activeFocus |
| `project_health_scores` | Score 0–100 with 6-dimension breakdown, 30-day history |
| `project_documents` | Generated docs (project_state, decisions_log, next_actions, work_journal, data_map) |
| `project_document_versions` | Version history with diff and sourceIds |
| `session_artifacts` | Synthesis and checkpoint artifacts |
| `project_recommendations` | Proactive recommendations (7 rule types) |
| `project_goals` | Goal Graph: successCriteria (JSON), kpis (JSON), status, hierarchy |
| `wiki_pages` | Knowledge base with editStatus and lock protection |
| `wiki_page_versions` | Version history |
| `task_logs` | PC Agent task queue: module, action, status, result |
| `configurations` | System persona + behaviour settings |
| `data_quality_rules` | Data quality rule definitions |
| `data_quality_results` | Rule execution results |
| `data_assets` | Data catalogue entries with embedding |
| `test_runs` | QA test results (JUnit / Allure) |

### Redis 7

| Usage | Purpose |
|---|---|
| BullMQ `agent-tasks` | PC Agent task lifecycle (pending → active → done/failed) |
| Application cache | ProjectState (10 min), Wiki (15 min), Brain search (5 min) — via CacheModule |
| LiteLLM cache | Exact-match response cache (5 min TTL) |

## LiteLLM Proxy (port 4100)

All LLM calls route through LiteLLM for:
- **Provider abstraction** — swap OpenAI ↔ Anthropic ↔ Groq via config, zero code changes
- **Automatic fallback** — `gpt-4o` tries Groq llama-3.3-70b first, falls back to Claude Sonnet on failure
- **Exact-match response cache** — Redis backend, 5 min TTL

### Aliases

| Alias | Primary | Fallback |
|---|---|---|
| `gpt-4o` | Groq llama-3.3-70b-versatile | Claude Sonnet 4 |
| `gpt-4o-mini` | Groq llama-3.1-8b-instant | Claude Haiku 4.5 |
| `gpt-4o-premium` | Claude Sonnet 4 (direct) | — |
| `gpt-4o-mini-premium` | Claude Haiku 4.5 (direct) | — |

### Model assignments per module

| Module | Model (alias) | Temperature |
|---|---|---|
| Orchestrator (classify) | gpt-4o-mini | 0 |
| Orchestrator (chat) | gpt-4o | 0.7 |
| ProjectState refresh | gpt-4o-premium | 0.2 |
| Synthesis / Checkpoint | gpt-4o | 0.3 |
| Documentation | gpt-4o | 0.3 |
| Blueprint (plan) | gpt-4o | 0.3 |
| Graph — gap analysis | gpt-4o-mini | 0.2 |
| Graph — KPI auto-track | gpt-4o-mini | 0.1 |
| Memory — synthesis | gpt-4o-mini | 0.3 |
| Content Engine | gpt-4o | 0.8 |
| Document Processing | gpt-4o-mini | 0.2 |
| Embeddings | Jina AI direct (1024-dim) | — |

## PC Agent Security Model

The PC Agent runs on the user's Windows machine and polls the BullMQ queue every 3 seconds.

```
API → Redis queue → Agent polls → whitelist.ts check → executor.ts → action
                                        ↓ reject silently if not in whitelist
```

Key invariants:
- `whitelist.ts` is the single source of truth — 29 allowed actions, never bypassed
- Path traversal blocked via `path.relative()` — `../` and absolute paths outside sandbox rejected
- Sandbox roots: `~/Downloads`, `~/Documents`, `~/Desktop`, `~/Projects`
- Medium/high-risk actions implement `dryRun: true` before real execution
- No free `exec()` or `spawn()` — only typed action functions
- `restart_api` always routed to `server` Agent on the VPS (never desktop)

## Security Controls (SEC-1 to SEC-10)

| Control | Implementation |
|---|---|
| SEC-1 | `@Throttle` on `POST /auth/login` — 10 req/60s |
| SEC-2 | argon2 password hashing with `timingSafeEqual` fallback |
| SEC-3 | JWT expiry reduced from 30d to 8h |
| SEC-4 | CORS whitelist callback (origin allowlist, not `origin: true`) |
| SEC-5 | `timingSafeEqual` for agent token comparison (constant-time) |
| SEC-6 | `path.relative()` for all path validation in agent actions |
| SEC-7 | pnpm 10.33.2 across all Dockerfiles |
| SEC-8–10 | README security section, shared path-guard utility, `onlyBuiltDependencies` |

## Checkpoint Pipeline

```
rayzen_checkpoint() or Stop hook (≥3 code edits)
  └─→ SynthesisService.checkpoint()
        ├─→ runSynthesis() — gpt-4o, temp 0.3
        ├─→ ProjectStateService.refresh() — gpt-4o-premium, temp 0.2
        └─→ DocumentationService.generateAll() (parallel, 5 doc types)
              └─→ each doc auto-refreshes state if called individually
```
