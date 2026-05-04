<div align="center">

<img src="https://img.shields.io/badge/Rayzen_AI-v0.1.0-6366f1?style=for-the-badge&logoColor=white" />
<img src="https://img.shields.io/badge/TypeScript-100%25-3178c6?style=for-the-badge&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/NestJS-10-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" />
<img src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white" />
<img src="https://img.shields.io/github/actions/workflow/status/marcelorayzen/rayzen-ai/ci.yml?branch=main&style=for-the-badge&label=CI" />

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
│                    Browser  (Next.js 15 App Router)                  │
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
   │    │  26 whitelist-guarded actions  │
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

## Technical differentials

- **LiteLLM proxy** — provider-agnostic LLM layer; swap OpenAI ↔ Groq ↔ Anthropic via config, zero code changes; per-`virtual_key` budget enforcement

- **Whitelist-enforced PC Agent** — 26 actions explicitly allow-listed in `whitelist.ts`; any unknown action silently rejected; path traversal blocked at `list_dir` and `file_search`; medium/high-risk actions run `dryRun: true` before the real operation

- **Validation layer** — `ValidationModule` sits at the entry point of every request: detects prompt injection patterns, enforces prompt length, checks output for system-prompt leakage, and validates that classified modules are in the known set

- **pgvector semantic memory** — Jina jina-embeddings-v3 (1024-dim) stored in PostgreSQL; full conversation history is also indexed for continuous learning across sessions

- **Streaming SSE** — chat responses stream token-by-token with typewriter effect; `tokens_used` and `duration_ms` logged on every LLM call and persisted to `ConversationMessage`

- **Two-step document confirmation** — doc requests show a preview with size/page estimate before generating; original prompt embedded as `[DOC_PENDING:base64]` in assistant message, confirmation triggers generation and returns a clickable download link

- **Global `PrismaService`** — single `@Global()` NestJS module, one database connection pool shared across all 20+ modules; eliminates the `new PrismaClient()` anti-pattern

- **Health score** — 6-dimension weighted score (0–100): activity, documentation freshness, internal consistency, next steps, blockers, focus; 30-day history persisted and charted in UI

- **Work modes** — 5 modes (implementation, debugging, architecture, study, review) inject mode-specific system prompt suffix and steer synthesis focus; mode tagged on every message and artifact

- **Hierarchical memory** — events auto-classified at write time (`inbox → working → consolidated → archive`); archived events excluded from LLM context in synthesis and documentation generation

- **Notion integration** — search, read, create, and append Notion pages from chat; markdown converted to Notion block objects (heading_1/2/3, paragraph, bullet, numbered, quote) via custom converter

- **Mermaid diagrams** — content engine auto-infers diagram type from prompt keywords (flowchart, sequenceDiagram, erDiagram, classDiagram, gantt) and returns fenced `mermaid` blocks rendered in the frontend

---

## Reliability

**48 tests across 6 modules**, enforced in CI:

| Module | What is tested |
|---|---|
| `ValidationService` | Prompt injection patterns, output schema leak, classification guard, severity levels |
| `SessionService` | Token aggregate stats, session groupBy, title truncation to 50 chars, fallback title |
| `VoiceService` | Markdown stripping before TTS, 800-char limit, temp file cleanup in finally |
| `MemoryService` | Checksum deduplication, Jina API call parameters, pgvector search score mapping, URL indexing error cases |
| `ExecutionService` | BullMQ `queue.add` parameters: jobId, attempts=3, backoff=5000 |
| `OrchestratorService` | Classification routing to correct module, `assertValidPrompt` called, response structure |

All specs use `{ provide: PrismaService, useValue: mockPrisma }` — no `new PrismaClient()` in tests, consistent with the DI model.

```bash
pnpm test:cov    # jest --coverage  (thresholds: functions ≥ 70%, branches ≥ 25%, lines ≥ 50%)
```

See [docs/validation.md](docs/validation.md) for the full validation philosophy and coverage targets.

---

## Module reference

```
apps/api/src/modules/
├── orchestrator/        # Intent classification (gpt-4o-mini, temp=0) + routing + SSE + work modes
├── memory/              # pgvector semantic search · Jina embeddings · URL + PDF indexing
├── execution/           # BullMQ task dispatch + jarvis payload builder
├── document-processing/ # Puppeteer PDF · docxtemplater DOCX · download endpoint
├── content-engine/      # Long-form content · editorial calendar · Mermaid diagrams
├── voice/               # Groq PlayAI TTS (POST /voice/synthesize) + Whisper STT (POST /voice/transcribe)
├── session/             # Conversation history · token stats · session groupBy
├── validation/          # Prompt injection detection · output validation · classification guard
├── configuration/       # System personality from rayzen.config.json · work mode config
├── notion/              # Notion API: search · read page · create page · append · update title
├── agent-bridge/        # PC Agent authentication (JWT) + BullMQ queue management
├── auth/                # JWT authentication + ADMIN_PASSWORD guard
├── project/             # Project CRUD + metadata
├── project-state/       # Structured state: milestones, backlog, activeFocus · resume brief
├── health/              # 6-dimension health score (0–100) + 30-day history
├── synthesis/           # Cross-project synthesis and summarization
├── documentation/       # Documentation generation and export
├── proactive/           # 6 proactive rules: inactivity, doc_stale, blocker, next_step, consistency, drift
├── event/               # Event log with memory_class hierarchy (inbox → working → consolidated → archive)
├── obsidian/            # Obsidian vault sync
└── git/                 # Git operations and repository insights
```

**LLM model assignments:**

| Module | Model | Temperature | Notes |
|---|---|---|---|
| Orchestrator — classify | gpt-4o-mini | 0 | `response_format: json_object` enforced |
| Orchestrator — chat | gpt-4o | 0.7 | Full conversation history included |
| Memory — synthesis | gpt-4o-mini | 0.3 | Summarizes search results |
| Document Processing | gpt-4o-mini | 0.2 | Structured, deterministic output |
| Content Engine | gpt-4o | 0.8 | Creativity-first, no intro preamble |
| Execution (Jarvis) | gpt-4o | 0.3 | Practical task responses |
| Embeddings | jina-embeddings-v3 | — | 1024-dim, via Jina AI API |
| Voice TTS | Groq PlayAI Astra | — | Markdown-stripped, 800-char chunks |
| Voice STT | Groq Whisper | — | Audio file → text |

---

## PC Agent actions

The PC Agent runs locally (Windows, `apps/agent/`) and polls Redis every 3 seconds for tasks. Every action is gated by `whitelist.ts` — unknown actions are silently dropped.

| Category | Actions |
|---|---|
| Apps & Navigation | `open_app`, `open_url`, `open_vscode` |
| Files & Directories | `list_dir`, `file_search`, `organize_downloads`, `create_project_folder` |
| System | `get_system_info`, `screenshot`, `notify`, `clipboard_read`, `clipboard_write` |
| Git | `git_status`, `git_log`, `git_branch`, `git_commit` |
| Terminal & Dev | `run_command`, `run_tests`, `inspect_schema` |
| Docker | `docker_ps`, `docker_start`, `docker_stop` |
| Communication | `read_emails`, `send_email`, `get_calendar` |

**`run_tests`** — invokes Jest, Vitest, or Playwright in any project path; parses stdout for passed/failed/skipped/coverage and returns structured `{ passed, failed, skipped, coverage, failures[] }`. Handles non-zero exit codes (test failures) correctly.

**`inspect_schema`** — reads `schema.prisma` from the target project, parses all models with their fields, types, modifiers, and relations using regex; returns a human-readable summary and a structured `models[]` array.

Security rules (non-negotiable, never bypass):
- Path traversal (`../`) blocked at `list_dir` and `file_search`
- Directories outside sandbox (`/etc`, `/var`, `/root`, `/sys`) refused
- `organize_downloads`, `docker_stop`, `git_commit` run with `dryRun: true` by default
- No free `exec()` or `spawn()` — only typed action handlers

See [docs/agent-runtime.md](docs/agent-runtime.md) for the full security model and how to add new actions.

---

## Quick start

**Prerequisites:** Node.js 20 LTS, pnpm 9.x, Docker Desktop

```bash
git clone https://github.com/marcelorayzen/rayzen-ai.git
cd rayzen-ai
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
DATABASE_URL=postgresql://rayzen:password@localhost:55432/rayzen_app
REDIS_URL=redis://localhost:56379

# Auth
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=yourpassword

# Optional integrations
NOTION_API_KEY=ntn_...            # Notion integration
NOTION_DATABASE_ID=               # Default database for new pages
```

**Option A — Windows shortcut (recommended):**

```
Double-click dev-start.bat
```

Starts Docker infra, preserves all volume data, opens 3 terminal windows (API, Web, Agent).

**Option B — manual:**

```bash
docker compose up -d postgres redis litellm

pnpm db:migrate        # apply schema (pgvector extension required)

pnpm dev:api           # API  → http://localhost:3101
pnpm dev:web           # Web  → http://localhost:3100
pnpm dev:agent         # PC Agent (required for Execution module)
```

Open **http://localhost:3100** and log in with `ADMIN_PASSWORD`.

> **Data persistence:** PostgreSQL and Redis use named Docker volumes (`pg_data`, `redis_data`). Restarting containers (even after system reboot) preserves all data. Data is only lost if you run `docker compose down -v`.

---

## Development commands

```bash
pnpm typecheck       # TypeScript zero-errors target (all workspaces)
pnpm lint            # ESLint across all apps
pnpm test            # Jest
pnpm test:cov        # Jest + coverage report (functions ≥ 80%)
pnpm db:migrate      # Apply Prisma migrations
pnpm db:studio       # Prisma Studio at http://localhost:5555
pnpm build           # Build all apps
git push origin main # Triggers CI → automatic SSH deploy to Oracle VPS
```

---

## Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | Next.js App Router | 15.x |
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
| VPS | Oracle Ampere A1 free tier | Ubuntu 24.04 |

---

## Documentation

| File | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full system diagram, module catalogue, data stores, LiteLLM model assignments |
| [docs/workflows.md](docs/workflows.md) | 5 end-to-end flows: memory indexing, routing, PC agent, voice, doc gen |
| [docs/validation.md](docs/validation.md) | Validation philosophy, what is detected, coverage targets |
| [docs/agent-runtime.md](docs/agent-runtime.md) | Security model, 26-action catalogue, dry-run protocol, adding new actions |
| [docs/engineering-standards.md](docs/engineering-standards.md) | DI rules, PrismaService, LLM proxy, security, when to write a spec |
| [docs/getting-started.md](docs/getting-started.md) | Detailed setup guide |
| [docs/personalization.md](docs/personalization.md) | System persona and behaviour configuration |
| [docs/roadmap.md](docs/roadmap.md) | Phase roadmap and current status |

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

<sub>Built by <a href="https://github.com/marcelorayzen">Marcelo Rayzen</a> · 100% TypeScript · NestJS + Next.js monorepo · Oracle VPS free tier</sub>

</div>
