<div align="center">

<img src="apps/web/public/rayzen-icon.svg" width="120" height="120" alt="Rayzen AI" /><br /><br />

<img src="https://img.shields.io/badge/Rayzen_AI-v1.0.0-6366f1?style=for-the-badge&logoColor=white" />
<img src="https://img.shields.io/badge/TypeScript-100%25-3178c6?style=for-the-badge&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/NestJS-10-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" />
<img src="https://img.shields.io/badge/Next.js-16.2.2-000000?style=for-the-badge&logo=next.js&logoColor=white" />
<img src="https://img.shields.io/badge/pnpm-10.33.2-f69220?style=for-the-badge&logo=pnpm&logoColor=white" />
<img src="https://img.shields.io/github/actions/workflow/status/marcelorayzen/Rayzen-AI/ci.yml?branch=main&style=for-the-badge&label=CI" />

<br /><br />

<h1>Rayzen AI</h1>

<p><strong>Personal AI platform combining semantic memory, PC automation, document generation,<br />Notion sync, and voice — built as a production-grade NestJS monorepo.</strong></p>

<p>
  <a href="README.md">🇧🇷 Português</a> &nbsp;|&nbsp;
  <a href="#architecture">Architecture</a> ·
  <a href="#what-does-it-solve">What it solves</a> ·
  <a href="#technical-differentials">Differentials</a> ·
  <a href="#module-reference">Modules</a> ·
  <a href="#pc-agent-actions">PC Agent</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#documentation">Docs</a>
</p>

</div>

---

## What does it solve?

| Scenario | Module | How |
|---|---|---|
| "What did I read about Docker last week?" | Memory | pgvector similarity search over indexed documents + conversations |
| "Open VS Code and run git status" | Execution | BullMQ task dispatched to local PC Agent over Redis |
| "Generate a PDF contract for this client" | Document Processing | Two-step confirmation → Puppeteer renders HTML → PDF download link in chat |
| "Write a LinkedIn post about this article" | Content Engine | LLM (temp=0.8) with tone/format prompt, returns formatted text |
| "Generate an architecture diagram" | Content Engine | Mermaid diagram auto-typed (flowchart/sequence/erDiagram) + rendered in UI |
| "Read that message back to me" | Voice | Groq PlayAI TTS, markdown-stripped, streamed audio |
| "How healthy is this project?" | Health Score | 6-dimension weighted score (0–100) with 30-day history chart |
| "Where did I stop? What changed?" | Resume Brief | `POST /projects/:id/resume` — structured catch-up in seconds |
| "Save this to my Notion" | Notion | Creates/appends pages via Notion SDK, markdown → Notion blocks |
| "Show me the schema of the database" | Execution → Agent | `inspect_schema` parses `schema.prisma` locally, returns model catalogue |
| "Run the tests and show me coverage" | Execution → Agent | `run_tests` invokes Jest/Vitest/Playwright, returns structured results |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Browser  (Next.js 16.2.2 App Router)              │
│  ReactMarkdown + custom <a> renders PDF links + Mermaid blocks       │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTP / SSE stream
┌────────────────────────────▼─────────────────────────────────────────┐
│                      OrchestratorModule                               │
│  ① ValidationService.assertValidPrompt()  — prompt injection guard   │
│  ② classify() → { module, action, confidence }  gpt-4o-mini temp=0  │
│  ③ isPendingDocConfirmation() — two-step doc flow                    │
│  ④ handleMessage() → route to module → stream reply via SSE          │
└──┬──────────┬──────────┬────────────┬────────────┬───────────────────┘
   │          │          │            │            │
Memory    Execution  Document    Content       Voice
Module    Module     Processing  Engine        Module
pgvector  BullMQ     Puppeteer   LiteLLM       Groq TTS/STT
Jina      Redis      docxtempl.  Mermaid       Whisper
   │          │
   │    ┌─────┴──────────────────────────┐
   │    │     PC Agent  (local Node.js)  │
   │    │  poll every 3s via BullMQ      │
   │    │  33 whitelist-guarded actions  │
   │    └────────────────────────────────┘
   │
   └──── Notion ── Project ── Health ── Proactive ── Event ── Git
```

**Data stores:**

| Store | Role |
|---|---|
| PostgreSQL 16 + pgvector 0.7 | Documents, conversations, embeddings (1024-dim), health scores, events |
| Redis 7 + BullMQ 5 | Task queue between API and PC Agent |
| LiteLLM (Docker sidecar) | Multi-provider LLM proxy — OpenAI, Groq, Anthropic, all via one endpoint |

See [docs/architecture.md](docs/architecture.md) for the full module catalogue and data flows.

---

## Two generations + other apps in the monorepo

This README documents **V1** (`apps/api` + `apps/web` + `apps/agent`) — the stable generation, in daily use, covered in detail below. The monorepo also has:

| App | What it is | Status |
|---|---|---|
| `apps/api-v2` | V2 — Mission Oriented Engineering System, isolated Postgres schema `v2`, `/v2` prefix. Mission engine with steps, approval gates, Goal Graph, quality benchmarking. | Built, in adoption |
| `apps/api-v2/src/guardian/` | **Rayzen Guardian** — monitors code changes in real time, computes a deterministic risk score (missing specs, critical module, untested schema/migration) and injects context/blocks push before the problem reaches production. | Active — see [docs/GUARDIAN.md](docs/GUARDIAN.md) |
| `apps/catalog-guardian` | Standalone consulting product — natural-language governance/security/answer layer over an existing data catalog (OpenMetadata, Unity Catalog). Own Prisma/DB, runs standalone, no cross-app import. | Active |
| `apps/widget` | Desktop overlay (Electron/Tauri) — dedicated monitor, native voice, bidirectional push. | In progress |
| `apps/vscode-extension` | VS Code extension for the Guardian (inline panel). | In progress |
| `graphify` | Code graph (AST) — cheaper codebase queries than broad grep. | Active |

See `CLAUDE.md` (repo root) for the full map and the development rules shared across both generations.

---

## Technical differentials

- **LiteLLM proxy** — provider-agnostic LLM layer; swap OpenAI ↔ Groq ↔ Anthropic via config, zero code changes; per-`virtual_key` budget enforcement

- **Whitelist-enforced PC Agent** — 33 actions explicitly allow-listed in `whitelist.ts`; any unknown action silently rejected; path traversal blocked via `path.relative()` (never `startsWith()`); medium/high-risk actions run `dryRun: true` before the real operation

- **Validation layer** — `ValidationModule` sits at the entry point of every request: detects prompt injection patterns, enforces prompt length, checks output for system-prompt leakage, and validates that classified modules are in the known set

- **pgvector semantic memory** — Jina jina-embeddings-v3 (1024-dim) stored in PostgreSQL; full conversation history is also indexed for continuous learning across sessions

- **Streaming SSE** — chat responses stream token-by-token with typewriter effect; `tokens_used` and `duration_ms` logged on every LLM call and persisted to `ConversationMessage`

- **Two-step document confirmation** — doc requests show a preview with size/page estimate before generating; original prompt embedded as `[DOC_PENDING:base64]` in assistant message, confirmation triggers generation and returns a clickable download link

- **Global `PrismaService`** — single `@Global()` NestJS module, one database connection pool shared across all 28+ modules; eliminates the `new PrismaClient()` anti-pattern

- **Redis application cache** — global `CacheModule` with graceful degradation; TTL per data type (project state 10 min, wiki 15 min, brain search 5 min); automatic pattern invalidation on write

- **Security headers (Helmet)** — `@fastify/helmet` registered before any route: CSP, HSTS (31536000s), X-Frame-Options, XSS protection, noSniff; disabled in dev to not break Swagger; active in production without manual intervention

- **Agent Audit Log** — every Agent execution produces a traceable entry in `agent_audit_logs`: `actor`, `taskId`, `module`, `action`, `command`, `risk`, `dryRun`, `durationMs`, `status`, `hostname`, `workspace`, `targetRole`; `GET /tasks/audit` endpoint with action/status filters; the Agent sends all fields automatically in every completion PATCH

- **Security audit (SEC-1 to SEC-10)** — rate limiting on `POST /auth/login`, JWT 8h expiry, CORS origin whitelist via `CORS_ORIGINS` env var, `timingSafeEqual` with buffer padding (avoids throw on length mismatch), `path.relative()` path validation, internal ports bound to `127.0.0.1`, pnpm 10.33.2

- **Prometheus observability** — `GET /metrics` (JWT-protected) exports metrics in Prometheus format: HTTP duration by route, LLM tokens by module/model, Agent tasks by action/status/role, queue size by state, total projects/events/audit logs; `collectDefaultMetrics` for Node.js heap, GC, and event loop

- **LLM cost analysis** — `GET /costs/summary?period=&project_id=` aggregates `ConversationMessage` by module and project; `◈ costs` modal in UI shows tokens, messages, estimated USD and module breakdown; every LLM-calling module logs to `conversationMessages`

- **Health score** — 6-dimension weighted score (0–100): activity, documentation freshness, internal consistency, next steps, blockers, focus; 30-day history persisted and charted in UI

- **Work modes** — 5 modes (implementation, debugging, architecture, study, review) inject mode-specific system prompt suffix and steer synthesis focus; mode tagged on every message and artifact

- **Hierarchical memory** — events auto-classified at write time (`inbox → working → consolidated → archive`); archived events excluded from LLM context in synthesis and documentation generation

- **Notion integration** — search, read, create, and append Notion pages from chat; markdown converted to Notion block objects (heading_1/2/3, paragraph, bullet, numbered, quote) via custom converter

- **Mermaid diagrams** — content engine auto-infers diagram type from prompt keywords (flowchart, sequenceDiagram, erDiagram, classDiagram, gantt) and returns fenced `mermaid` blocks rendered in the frontend

- **Agent role separation** — `desktop` Agent runs on the work PC (screenshots, clipboard, local tests, open tools); `server` Agent runs on the local notebook that hosts the stack (logs, Docker, service restarts); both share the same polling model and whitelist enforcement; `jarvis:restart_api` always routes to `server`

- **Workspace Watcher** — polls configured Git repositories every 30 s via `git status --porcelain`; detects changed files, reads their content, and indexes them in Brain with the project's `projectId` — no tool-specific hooks required, works with any editor

- **Template system with brief** — `create_project_folder template=rayzen brief="..."` calls LiteLLM to pre-fill the full project structure from a natural-language description: `CLAUDE.md`, `docs/project.md` (spec, personas, roadmap, diary), first ADR, `.gitignore`, `.env.example`, `.claude/settings.json`, git init with initial commit; the `brief` field is automatically extracted from the chat prompt

- **Goal Graph** — visual canvas (`@xyflow/react`) for tracking project intention: milestones, blockers, next steps CRUD in-canvas; `ProjectGoal` with success criteria (progress bar), KPIs with inline editing and LLM auto-tracking from recent events; gap analysis (LLM) compares goal vs current state and surfaces `nextBestAction`

- **Project context isolation** — each chat session is scoped to the selected project; history, Brain search, and knowledge extraction (`extractAndIndex`) all filter by `projectId`; system prompt is enriched with real-time state (stage, blockers, active goal, recent events) — the assistant answers from facts, not from guesses

---

## Reliability

**239 tests across 25 suites** (220 unit + 19 E2E), enforced in CI:

**Unit tests (220 across 22 suites):**

| Module | What is tested |
|---|---|
| `ValidationService` | Prompt injection patterns, output schema leak, classification guard, severity levels |
| `SessionService` | Token aggregate stats, session groupBy, title truncation to 50 chars, fallback title |
| `VoiceService` | Markdown stripping before TTS, 800-char limit, mp4/wav ext, temp file cleanup in finally |
| `MemoryService` | Checksum deduplication, Jina API error, pgvector search (with/without projectId), indexGithub (404/403/success), indexNotion (401/success), indexFile (txt/md), listDocuments with filter, deleteDocument |
| `BrainService` | Jina 1024-dim embed, chunkText, indexDocument (created/updated), search with numeric score, cache invalidation |
| `WikiService` | Controller CRUD, LLM compilation, merge/diff, versioning, human_edited/locked protection |
| `ExecutionService` | BullMQ `queue.add` parameters: jobId, attempts=3, backoff=5000 |
| `OrchestratorService` | Classification routing to correct module, `assertValidPrompt` called, response structure |
| `BlueprintService` | import/preview with all options, wiki-exists warnings, Brain failure fallback |
| `DataQualityService` | Rules and results CRUD, score, history, schema-diff |
| `QAService` | JUnit XML ingestion, Allure JSON, flakiness metrics, auto-capture of flaky patterns as a learning |
| `GraphService` | Success-criteria sync with ProjectState, malformed gap-analysis normalization, mermaid resilient to incomplete successCriteria |
| `SynthesisService` | Checkpoint flags possibly-completed criteria (nextSteps + event, never auto-applies) |
| `CodeLineageService` | Real file lineage via graphify (sync + direct/transitive/aggregate impact across multiple files) |

**E2E tests with Fastify inject (19):**

| Suite | What is tested |
|---|---|
| `auth.e2e.spec.ts` | Login with correct password → 201 + JWT; valid token with `role:admin`; wrong password → 401; empty payload → 400 |
| `tasks.e2e.spec.ts` | `/tasks/pending` with/without auth; role filter; `PATCH /tasks/:id` with audit fields; `GET /tasks/audit` with filters |
| `projects.e2e.spec.ts` | `GET /projects` list and `repoSlug` filter; `POST /projects` create + validation; `GET /projects/:id` by ID |

All specs use `{ provide: PrismaService, useValue: mockPrisma }` — no `new PrismaClient()` in tests, consistent with the DI model.

```bash
pnpm test:cov    # jest --coverage  (thresholds: functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm test:e2e    # jest --config jest.e2e.json --runInBand  (19 E2E with Fastify inject)
```

See [docs/validation.md](docs/validation.md) for the full validation philosophy and coverage targets.

---

## Module reference

```
apps/api/src/modules/
├── orchestrator/        # Intent classification (gpt-4o-mini, temp=0) + routing + SSE + work modes
├── brain/               # Jina 1024-dim embeddings · indexDocument/indexUrl/indexText · pgvector search
├── wiki/                # WikiPage with merge/diff · editStatus · versioning · human_edited protection
├── memory/              # GitHub/Notion/URL/file (PDF/MD/TXT) indexing · searchAndSynthesize
├── execution/           # BullMQ task dispatch + jarvis payload builder
├── document-processing/ # Puppeteer PDF · docxtemplater DOCX · download endpoint
├── content-engine/      # Long-form content · editorial calendar · Mermaid diagrams
├── voice/               # Groq PlayAI TTS (POST /voice/synthesize) + Whisper STT (POST /voice/transcribe)
├── telegram/            # Telegram bot — orchestrates via HTTP, commands, alternate channel to web chat
├── session/             # Conversation history · token stats · session groupBy
├── agent-session/       # Supervised Claude Code session — question/answer/log/complete (`/agent/session`)
├── validation/          # Prompt injection detection · output validation · classification guard
├── configuration/       # System personality from rayzen.config.json · work mode config
├── notion/              # Notion API: search · read page · create page · append · update title
├── agent-bridge/        # PC Agent JWT auth · BullMQ queue management · `audit-log.service` records every execution in `agent_audit_logs`
├── auth/                # JWT authentication + ADMIN_PASSWORD guard
├── project/             # Project CRUD + metadata
├── project-state/       # Structured state: milestones, backlog, activeFocus · resume brief
├── health/              # 6-dimension health score (0–100) + 30-day history
├── synthesis/           # Cross-project synthesis and summarization
├── documentation/       # Documentation generation and export
├── proactive/           # 7 proactive rules: inactivity, doc_stale, blocker, next_step, consistency, drift, goal_stagnant
├── event/               # Event log with memory_class hierarchy (inbox → working → consolidated → archive)
├── evidence/            # QA evidence upload/lookup per project (`/evidence`)
├── data-quality/        # Data quality rules, results, score history, schema diff
├── data-catalog/        # Asset registry + lineage graph and impact analysis (V1 — not to be confused with apps/catalog-guardian)
├── qa/                  # Test run ingestion (JUnit XML / Allure JSON)
├── obsidian/            # Obsidian vault sync
├── git/                 # Git operations and repository insights
├── cache/               # Redis @Global cache — TTL per type, delPattern, graceful degradation
├── costs/               # GET /costs/summary — breakdown by module/project, USD estimate
├── blueprint/           # External plan import: wiki + brain + state + events in one command
├── graph/               # Goal Graph: milestones, blockers, gap analysis (LLM), KPI auto-track
└── metrics/             # GET /metrics (JWT) — Prometheus: HTTP, LLM tokens, Agent tasks, queue, heap/GC
```

**LLM model assignments:**

| Module | Model (alias) | Temperature | Notes |
|---|---|---|---|
| Orchestrator — classify | gpt-4o-mini | 0 | robust JSON extraction — Claude doesn't support `response_format` |
| Orchestrator — chat | gpt-4o | 0.7 | full conversation history included |
| ProjectState refresh | gpt-4o-premium | 0.2 | Claude Sonnet direct — critical quality analysis |
| Synthesis / Checkpoint | gpt-4o | 0.3 | JSON extraction with 3 fallback strategies |
| Documentation | gpt-4o | 0.3 | uses ProjectState as primary context |
| Blueprint (plan) | gpt-4o | 0.3 | generates structured Markdown plan |
| Graph — gap analysis | gpt-4o-mini | 0.2 | compares ProjectGoal vs ProjectState |
| Graph — KPI auto-track | gpt-4o-mini | 0.1 | event evidence → current KPI value |
| Memory — synthesis | gpt-4o-mini | 0.3 | summarizes search results |
| Document Processing | gpt-4o-mini | 0.2 | structured, deterministic output |
| Content Engine | gpt-4o | 0.8 | creativity-first |
| Execution (Jarvis) | gpt-4o | 0.3 | practical task responses |
| Embeddings | jina-embeddings-v3 | — | 1024-dim, via Jina AI API (bypasses LiteLLM) |
| Voice TTS | Groq PlayAI Astra | — | markdown-stripped, 800-char chunks |
| Voice STT | Groq Whisper | — | audio file → text |

**LiteLLM aliases:**
- `gpt-4o` → Groq llama-3.3-70b (primary) + Claude Sonnet (automatic fallback)
- `gpt-4o-mini` → Groq llama-3.1-8b (primary) + Claude Haiku (automatic fallback)
- `gpt-4o-premium` → Claude Sonnet direct (no Groq) — critical operations

---

## PC Agent actions

The PC Agent runs locally (Windows, `apps/agent/`) and polls Redis every 3 seconds for tasks. Every action is gated by `whitelist.ts` — unknown actions are silently dropped.

| Category | Actions |
|---|---|
| Apps & Navigation | `open_app`, `open_url`, `open_vscode` |
| Files & Directories | `list_dir`, `file_search`, `organize_downloads`, `create_project_folder` |
| System | `get_system_info`, `screenshot`, `notify`, `clipboard_read`, `clipboard_write` |
| Git | `git_status`, `git_log`, `git_branch`, `git_commit` |
| Terminal & Dev | `run_command`, `run_tests`, `inspect_schema`, `restart_api` |
| Docker | `docker_ps`, `docker_start`, `docker_stop`, `docker_logs` |
| Communication | `read_emails`, `send_email`, `get_calendar` |
| QA & Evidence | `parse_test_report`, `get_qa_summary`, `capture_test_failure` |
| Data & Graph | `get_data_quality`, `run_graphify`, `graphify_sync` |

**`run_tests`** — invokes Jest, Vitest, or Playwright in any project path; parses stdout for passed/failed/skipped/coverage and returns structured `{ passed, failed, skipped, coverage, failures[] }`. Handles non-zero exit codes (test failures) correctly.

**`inspect_schema`** — reads `schema.prisma` from the target project, parses all models with their fields, types, modifiers, and relations using regex; returns a human-readable summary and a structured `models[]` array.

Security rules (non-negotiable, never bypass):
- Path traversal (`../`) blocked at `list_dir` and `file_search`
- Directories outside sandbox (`/etc`, `/var`, `/root`, `/sys`) refused
- `organize_downloads`, `docker_stop`, `git_commit` run with `dryRun: true` by default
- No free `exec()` or `spawn()` — only typed action handlers

See [docs/RAYZEN_AGENT_PROTOCOL.md](docs/RAYZEN_AGENT_PROTOCOL.md) for the full security model and how to add new actions.

---

## Quick start

**Local development prerequisites:** Node.js 20+ for the Rayzen Agent, pnpm 10.x, Docker Desktop.

**Current operation:** central stack on a local Ubuntu notebook (Docker Compose), exposed via Cloudflare Tunnel — no port forwarding. Desktop Agent runs on the work PC. Public URLs and secrets stay out of the public README; see `docs/remote-agent-setup.md` for the operating model.

```bash
git clone https://github.com/marcelorayzen/Rayzen-AI.git
cd Rayzen-AI
pnpm install
cp .env.example .env
# Fill in API keys (see below)
```

**Required environment variables** (in `apps/api/.env`):

```bash
# LLM
OPENAI_API_KEY=sk-proj-...        # openai.com
GROQ_API_KEY=gsk_...              # groq.com — free tier available
JINA_API_KEY=jina_...             # jina.ai  — free tier available

# LiteLLM proxy (Docker sidecar)
LITELLM_BASE_URL=http://localhost:4100/v1
LITELLM_MASTER_KEY=sk-rayzen-anything

# Infrastructure
DATABASE_URL=postgresql://rayzen:password@localhost:55432/rayzen_ai
REDIS_URL=redis://localhost:56379

# Auth
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=yourpassword

# Optional integrations
NOTION_API_KEY=ntn_...            # Notion integration
NOTION_DATABASE_ID=               # Default database for new pages
```

**Manual local run:**

```bash
docker compose up -d postgres redis litellm

pnpm db:migrate        # apply schema (pgvector extension required)

pnpm dev:api           # API  → http://localhost:3101
pnpm dev:web           # Web  → http://localhost:3100
pnpm dev:agent         # PC Agent (required for Execution module)
```

To run only the desktop Agent connected to the notebook stack, configure `.env.agent.local` from `.env.agent.example` and run `agent-start.bat`.

Open **http://localhost:3100** and log in with `ADMIN_PASSWORD`.

> **Data persistence:** PostgreSQL and Redis use named Docker volumes (`pg_data`, `redis_data`). Restarting containers (even after system reboot) preserves all data. Data is only lost if you run `docker compose down -v`.

---

## Development commands

```bash
pnpm typecheck       # TypeScript zero-errors target (all workspaces)
pnpm lint            # ESLint across all apps
pnpm test            # Jest
pnpm test:cov        # Jest + coverage report (functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm test:e2e        # Jest E2E (Fastify inject, no real DB)
pnpm db:migrate      # Apply Prisma migrations
pnpm db:studio       # Prisma Studio at http://localhost:5555
pnpm build           # Build all apps
git push origin main # Main project branch
```

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | Next.js App Router | 16.2.2 |
| Backend | NestJS + Fastify | 10.x |
| LLM proxy | LiteLLM | latest |
| Embeddings | Jina AI (jina-embeddings-v3) | 1024-dim |
| Database | PostgreSQL + pgvector | 16 + 0.7 |
| Cache / Queue | Redis + BullMQ | 7.x + 5.x |
| ORM | Prisma | 5.x |
| PDF | Puppeteer | 22.x |
| DOCX | docxtemplater | 3.x |
| Voice | Groq (PlayAI Astra TTS + Whisper STT) | — |
| Notion | @notionhq/client | latest |
| Diagrams | Mermaid (fenced block, rendered in Next.js) | — |
| Agent | Node.js TypeScript | 20 LTS |
| Container | Docker Compose | v2 |
| CI/CD | GitHub Actions + SSH deploy | — |
| Infra | Local Ubuntu notebook + Cloudflare Tunnel | — |

---

## Documentation

| File | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full system diagram, module catalogue, data stores, LiteLLM model assignments |
| [docs/workflows.md](docs/workflows.md) | 5 end-to-end flows: memory indexing, routing, PC agent, voice, doc gen |
| [docs/validation.md](docs/validation.md) | Validation philosophy, what is detected, coverage targets |
| [docs/RAYZEN_AGENT_PROTOCOL.md](docs/RAYZEN_AGENT_PROTOCOL.md) | Security model, action catalogue, dry-run protocol, adding new actions |
| [docs/GUARDIAN.md](docs/GUARDIAN.md) | Rayzen Guardian — deterministic risk score, pre-push hook, MCP tools |
| [docs/engineering-standards.md](docs/engineering-standards.md) | DI rules, PrismaService, LLM proxy, security, when to write a spec |
| [docs/getting-started.md](docs/getting-started.md) | Detailed setup guide |
| [docs/personalization.md](docs/personalization.md) | System persona and behaviour configuration |
| [docs/roadmap.md](docs/roadmap.md) | Phase roadmap and current status |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Test pyramid, area coverage, risks, and QA strategy (V1+V2) |
| [docs/historia/00-indice.md](docs/historia/00-indice.md) | Project history since inception — decisions, incidents, pivots |
| [docs/presentations/](docs/presentations/) | Updated presentations and LinkedIn post drafts |

---

## Local dev URLs

| Service | URL |
|---|---|
| Web | http://localhost:3100 |
| API / Swagger | http://localhost:3101/docs |
| LiteLLM UI | http://localhost:4100/ui |
| Prisma Studio | http://localhost:5555 |

---

<div align="center">

<sub>Built by <a href="https://github.com/marcelorayzen">Marcelo Rayzen</a> · 100% TypeScript · NestJS + Next.js monorepo</sub>

</div>
