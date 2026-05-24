# Rayzen AI — Developer Guide

> Full personal workflow is in `CLAUDE.local.md` (gitignored, private repo only).

---

## What is this

Personal AI platform with semantic memory, automation, document generation, QA, data quality and assisted execution. TypeScript monorepo with pnpm workspaces.

**Repository:** `github.com/marcelorayzen/Rayzen-AI`
**Main branch:** `main`

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 App Router |
| Backend | NestJS 10 + Fastify adapter |
| LLM proxy | LiteLLM — `gpt-4o` and `gpt-4o-mini` aliases |
| Database | PostgreSQL 16 + pgvector |
| Cache / Queue | Redis 7 + BullMQ 5 |
| ORM | Prisma 5 (21 models) |
| Graph UI | @xyflow/react v12 |
| PDF | Puppeteer 22 |
| DOCX | docxtemplater 3 |
| Embeddings | Jina AI (vector 1024) |
| Local agent | Node.js 20/22 LTS + TypeScript |
| Infra | Docker Compose v2 · Azure VM |

**LiteLLM aliases:**
- `gpt-4o` → Groq llama-3.3-70b (primary) + Claude Sonnet (fallback)
- `gpt-4o-mini` → Groq llama-3.1-8b (primary) + Claude Haiku (fallback)
- `gpt-4o-premium` → Claude Sonnet direct
- `gpt-4o-mini-premium` → Claude Haiku direct

> Claude does not support `response_format: json_object` — use robust JSON extraction (strip code fences + regex).

---

## Monorepo structure

```
rayzen-ai/
├── apps/
│   ├── api/                    # NestJS + Fastify
│   │   ├── src/modules/        # 28 modules
│   │   └── prisma/schema.prisma
│   ├── web/                    # Next.js App Router
│   └── agent/
│       ├── src/
│       │   ├── index.ts        # entry point — poll loop
│       │   ├── poller.ts       # setInterval 3s → GET /tasks/pending
│       │   ├── executor.ts     # action dispatcher
│       │   ├── security/whitelist.ts   # CRITICAL — never bypass
│       │   ├── actions/        # 33 actions implemented
│       │   └── mcp/            # MCP servers (stdio + HTTP)
│       └── hooks/              # Claude Code hook (gitignored config)
├── packages/types/src/index.ts # Task, Document, ChatMessage
├── infra/
│   ├── nginx/
│   ├── caddy/Caddyfile         # HTTPS reverse proxy for MCP
│   └── litellm/config.yaml
└── CLAUDE.md
```

---

## Essential commands

```bash
# Setup
pnpm install
cp .env.example .env

# Development
pnpm dev:api                    # API → :3101
pnpm dev:web                    # Web → :3100
pnpm --filter agent dev

# Database
pnpm db:migrate
pnpm --filter api db:generate   # required after schema changes
pnpm db:studio

# Quality
pnpm typecheck
pnpm lint
pnpm test

# Build
pnpm --filter api build
pnpm --filter agent build
```

---

## API modules

| Module | Key routes |
|---|---|
| auth | `POST /auth/login` |
| orchestrator | `POST /orchestrate`, `POST /orchestrate/stream` |
| event | `POST /events`, `POST /events/cli`, `GET /events` |
| memory | `POST /memory/index`, `POST /memory/search`, `GET /memory/documents` |
| brain | `POST /brain/index`, `POST /brain/search` |
| project | `GET/POST /projects`, `PATCH /projects/:id` |
| project-state | `GET /projects/:id/state`, `POST /projects/:id/state/refresh` |
| synthesis | `POST /synthesis/session`, `POST /synthesis/checkpoint` |
| documentation | `POST /documentation/generate/:projectId`, `GET /documentation/:projectId` |
| wiki | `GET/PUT /wiki/:slug` |
| agent-bridge | `GET /tasks/pending`, `PATCH /tasks/:id` |
| graph | `GET /projects/:id/graph`, `POST /projects/:id/graph/goal` |
| qa | `POST /qa/reports/ingest` |
| data-quality | `POST /data-quality/rules`, `GET /data-quality/score` |
| data-catalog | `POST /data-catalog/assets`, `GET /data-catalog/lineage/:assetId` |
| content-engine | `POST /content-engine/generate` |
| notion | `GET /notion/search`, `POST /notion/pages` |
| health | `GET /projects/:id/health` |
| proactive | `GET /projects/:id/recommendations` |

---

## Agent actions (whitelist)

33 actions — every new action **must** be added to `apps/agent/src/security/whitelist.ts`.

| Action | File |
|---|---|
| `jarvis:open_app` | open-app.ts |
| `jarvis:open_url` | open-url.ts |
| `jarvis:open_vscode` | open-vscode.ts |
| `jarvis:list_dir` | list-dir.ts |
| `jarvis:file_search` | file-search.ts |
| `jarvis:organize_downloads` | organize-downloads.ts |
| `jarvis:create_project_folder` | create-project-folder.ts |
| `jarvis:get_system_info` | get-system-info.ts |
| `jarvis:screenshot` | screenshot.ts |
| `jarvis:notify` | notify.ts |
| `jarvis:clipboard_read` | clipboard.ts |
| `jarvis:clipboard_write` | clipboard.ts |
| `jarvis:git_status` | git.ts |
| `jarvis:git_log` | git.ts |
| `jarvis:git_branch` | git.ts |
| `jarvis:git_commit` | git.ts |
| `jarvis:run_command` | terminal.ts |
| `jarvis:run_tests` | run-tests.ts |
| `jarvis:inspect_schema` | inspect-schema.ts |
| `jarvis:docker_ps` | docker.ts |
| `jarvis:docker_start` | docker.ts |
| `jarvis:docker_stop` | docker.ts |
| `jarvis:docker_logs` | docker.ts |
| `jarvis:parse_test_report` | parse-test-report.ts |
| `jarvis:get_qa_summary` | get-qa-summary.ts |
| `jarvis:capture_test_failure` | capture-test-failure.ts |
| `jarvis:read_emails` | outlook.ts |
| `jarvis:send_email` | outlook.ts |
| `jarvis:get_calendar` | outlook-calendar.ts |
| `jarvis:restart_api` | restart-api.ts |
| `jarvis:get_data_quality` | get-data-quality.ts |
| `jarvis:run_graphify` | run-graphify.ts |
| `jarvis:graphify_sync` | graphify-sync.ts |

Adding a new action:
```typescript
// 1. apps/agent/src/security/whitelist.ts — add 'jarvis:new_action'
// 2. apps/agent/src/actions/new-action.ts — implement
// 3. apps/agent/src/executor.ts — import + switch case
// 4. __tests__/new-action.spec.ts — security tests
```

---

## MCP Server

Two MCP servers available:

| Server | File | Transport | Use |
|---|---|---|---|
| stdio | `apps/agent/src/mcp/rayzen-mcp.mjs` | stdio | Claude Code (local) |
| HTTP | `apps/agent/src/mcp/rayzen-mcp-http.mjs` | StreamableHTTP | Claude Desktop (remote) |

HTTP server runs as `mcp-http` Docker service, exposed via Caddy (HTTPS).

13 tools: `rayzen_get_state`, `rayzen_get_resume`, `rayzen_get_goal`, `rayzen_get_wiki`, `rayzen_add_event`, `rayzen_search_memory`, `rayzen_checkpoint`, `rayzen_update_planning`, `rayzen_get_events`, `rayzen_blueprint_preview`, `rayzen_blueprint_import`, `rayzen_blueprint_import_markdown`, `rayzen_blueprint_import_file`.

---

## Prisma models

`Project`, `ProjectDocument`, `ProjectDocumentVersion`, `SessionArtifact`, `Event`, `ProjectRecommendation`, `ProjectState`, `ProjectHealthScore`, `Document`, `WikiPage`, `WikiPageVersion`, `WikiSourceReference`, `TaskLog`, `ConversationMessage`, `TestRun`, `DataQualityRule`, `DataQualityResult`, `SchemaSnapshot`, `DataAsset`, `DataLineageEdge`, `ProjectGoal`, `AgentAuditLog`

---

## LLM models per module

| Module | Model | Temp |
|---|---|---|
| Orchestrator (classify) | gpt-4o-mini | 0 |
| Orchestrator (chat) | gpt-4o | 0.7 |
| Doc Engine | gpt-4o | 0.3 |
| ProjectState refresh | gpt-4o-premium | 0.2 |
| Synthesis / Checkpoint | gpt-4o | 0.3 |
| Gap Analysis | gpt-4o-mini | 0.2 |
| Brain synthesis | gpt-4o-mini | 0.3 |

---

## Development rules

- TypeScript 100% — no explicit `any`, no plain `.js`
- Each NestJS module has its own system prompt — never use a generic one
- Log `tokens_used` and `duration_ms` on every LiteLLM call
- Always proxy through LiteLLM — never call OpenAI/Anthropic directly
- Agent whitelist is non-negotiable — actions outside it are silently rejected
- Path traversal (`../`) always blocked in list-dir and similar actions
- Medium/high risk actions: `dryRun: true` before executing
- After any Prisma schema change: run `pnpm --filter api db:generate`

---

## graphify

Knowledge graph at `graphify-out/`. Run `graphify query "<question>"` for codebase questions. Run `graphify update .` after modifying code.
