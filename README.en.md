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

<p><strong>What if your AI assistant actually remembered everything — and could act on it?</strong><br />Rayzen AI is a personal platform combining semantic memory (pgvector), assisted execution via a whitelist-guarded PC Agent, and documentation that keeps itself up to date as the project evolves. Built as a production-grade NestJS + Next.js monorepo, not a prototype.</p>

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

```mermaid
flowchart TD
    Browser["Browser<br/>Next.js 16 App Router"] -->|"HTTP / SSE"| Orch

    subgraph Orch["OrchestratorModule"]
        direction LR
        V["① ValidationService<br/>assertValidPrompt()"] --> C["② classify()<br/>gpt-4o-mini · temp=0"] --> D["③ doc confirmation<br/>two-step flow"] --> H["④ handleMessage()<br/>route + stream SSE"]
    end

    Orch --> Memory["Memory<br/>pgvector + Jina"]
    Orch --> Execution["Execution<br/>BullMQ + Redis"]
    Orch --> DocProc["Document Processing<br/>Puppeteer + docxtemplater"]
    Orch --> Content["Content Engine<br/>LiteLLM + Mermaid"]
    Orch --> Voice["Voice<br/>Groq TTS/STT + Whisper"]
    Orch -.-> Rest["Notion · Project · Health<br/>Proactive · Event · Git"]

    Execution --> Agent["PC Agent (local Node.js)<br/>poll 3s · 33 actions · whitelist"]
```

**Data stores:**

| Store | Role |
|---|---|
| PostgreSQL 16 + pgvector 0.7 | Documents, conversations, embeddings (1024-dim), health scores, events |
| Redis 7 + BullMQ 5 | Task queue between API and PC Agent |
| LiteLLM (Docker sidecar) | Multi-provider LLM proxy — OpenAI, Groq, Anthropic, all via one endpoint |

See [docs/architecture.md](docs/architecture.md) for the full module catalogue and data flows.

---

## Two generations

This README mostly documents **V1** (`apps/api` + `apps/web` + `apps/agent`) — the stable generation, in daily use, covered in detail below. The repo also ships **V2** (`apps/api-v2`) — Mission Oriented Engineering System, isolated Postgres schema `v2`, `/v2` route prefix, mission engine with steps/approval gates/Goal Graph/quality benchmarking — still in adoption, see `blueprints/` for the full design.

This is a curated public release: a few experimental/commercial modules from the private monorepo (including a code-risk monitoring system and a data-catalog consulting product) are not part of this cut.

See `CLAUDE.md` (repo root) for the full map and the development rules shared across both generations.

---

## Technical differentials

- **LiteLLM proxy** — provider-agnostic LLM layer; swap OpenAI ↔ Groq ↔ Anthropic via config, zero code changes; per-`virtual_key` budget enforcement

- **Whitelist-enforced PC Agent** — 33 actions explicitly allow-listed in `whitelist.ts`; any unknown action silently rejected; path traversal blocked via `path.relative()`; medium/high-risk actions run `dryRun: true` before the real operation

- **Validation layer** — `ValidationModule` sits at the entry point of every request: detects prompt injection patterns, enforces prompt length, checks output for system-prompt leakage

- **Semantic + hierarchical memory** — Jina jina-embeddings-v3 (1024-dim) stored in PostgreSQL/pgvector; events auto-classified (`inbox → working → consolidated → archive`), archived items excluded from LLM context

- **Health score** — 6-dimension weighted score (0–100): activity, documentation freshness, internal consistency, next steps, blockers, focus; 30-day history

- **Work modes** — 5 modes (implementation, debugging, architecture, study, review) inject mode-specific system prompt suffix and steer synthesis focus

- **Goal Graph** — visual canvas (`@xyflow/react`) for milestones, blockers and KPIs with LLM auto-tracking from recent events; gap analysis compares goal vs current state

15 more mechanisms (SSE streaming, SEC-1 to SEC-10 security audit, Prometheus observability, LLM cost analysis, Notion integration, Workspace Watcher and others) are detailed in [docs/engineering-standards.md](docs/engineering-standards.md).

---

## Reliability

**239 tests across 25 suites** (220 unit + 19 E2E), enforced in CI on every push to `main`. Coverage spans agent security (whitelist, path traversal, dryRun), API contracts (auth, tasks, projects), domain logic (memory, brain, wiki, blueprint, graph), and LLM response parsing.

```bash
pnpm test:cov    # jest --coverage  (thresholds: functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm test:e2e    # jest --config jest.e2e.json --runInBand  (19 E2E with Fastify inject)
```

All specs use `{ provide: PrismaService, useValue: mockPrisma }` — no `new PrismaClient()` in tests. See [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) for the per-service/suite breakdown and [docs/validation.md](docs/validation.md) for the validation philosophy.

---

## Module reference

`apps/api/src/modules/` holds 34 domain-scoped NestJS modules: from the core ones (`orchestrator`, `memory`, `brain`, `execution`, `wiki`) to support modules (`session`, `notion`, `data-quality`, `blueprint`, `graph`, `metrics`, `costs`). Each module has a single responsibility and its own system prompt when it calls an LLM.

Full catalogue (34 modules with descriptions, per-module LLM model, LiteLLM aliases) in [docs/architecture.md](docs/architecture.md).

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
| [docs/engineering-standards.md](docs/engineering-standards.md) | DI rules, PrismaService, LLM proxy, security, when to write a spec, detail on the remaining technical differentials |
| [docs/getting-started.md](docs/getting-started.md) | Detailed setup guide |
| [docs/personalization.md](docs/personalization.md) | System persona and behaviour configuration |
| [docs/roadmap.md](docs/roadmap.md) | Phase roadmap and current status |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Test pyramid, area coverage, risks, and QA strategy (V1+V2) |
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
