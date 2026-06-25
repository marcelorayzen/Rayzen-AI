# QA Strategy — Rayzen AI

> **Deprecado** — Substituído por [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) que cobre V1 + V2. Mantido como referência histórica.

> Rayzen AI is a full-stack platform where the author holds end-to-end responsibility: architecture, implementation, and quality assurance. This document describes how quality is systematically built in — not added after.

---

## Test Pyramid

```
        ┌──────────────┐
        │   E2E (19)   │  Fastify inject — API contracts, auth, task flow
        ├──────────────┤
        │  Unit (179)  │  Service logic — validation, LLM parsing, security rules
        ├──────────────┤
        │ Agent Safety │  Whitelist enforcement, path traversal, dry-run protocol
        └──────────────┘
```

**198 total tests** running in CI (GitHub Actions) on every push to `main`:
- `pnpm typecheck` — TypeScript strict across all workspaces
- `pnpm lint` — ESLint + consistent-type-imports
- `pnpm test` — 179 unit tests across 11 modules
- `pnpm test:e2e` — 19 E2E specs with real Fastify server (no mocks for HTTP layer)

---

## Covered Areas

### Auth & Security
- `POST /auth/login` — correct password → 201 + JWT with `role:admin`; wrong password → 401; empty payload → 400
- JWT throttle (SEC-1): rate limiting on `/auth/login`
- `timingSafeEqual` with constant-length buffers (prevents timing attacks even on length mismatch)
- CORS origin whitelist via `CORS_ORIGINS` env var
- Security headers: `@fastify/helmet` registrado antes de qualquer rota (CSP, HSTS 1 ano, X-Frame-Options, noSniff)

### Agent Bridge & Tasks
- `GET /tasks/pending` — with/without auth, role filter
- `PATCH /tasks/:id` — audit fields propagation (`actor`, `module`, `action`, `risk`, `dryRun`, `durationMs`, `status`)
- `GET /tasks/audit` — filters by action, status, actor

### Projects
- `GET /projects` — list and filter by `repoSlug`
- `POST /projects` — creation with validation
- `GET /projects/:id` — lookup by ID

### Prompt Validation
- Injection patterns: `ignore previous instructions`, `system:`, `<script>`, `__import__`, `DROP TABLE`
- Schema leak detection: system prompt keywords in output
- Classifier guard: valid module names only
- Size limit enforcement

### Memory & Brain
- Jina embedding (1024-dim) round-trip
- `chunkText` boundary conditions
- `indexDocument` created vs updated paths
- Semantic search with/without `projectId` scoping
- SHA-256 deduplication on re-indexing
- GitHub indexing (404, 403, success)
- Notion indexing (401, success)
- File indexing (txt, md)
- `pgvector` query with score threshold

### Session & Conversation
- Token stats aggregation
- Session groupBy
- Title truncation at 50 chars
- Fallback title generation

### Voice
- Markdown stripping before TTS
- 800-char chunk limit
- Temp file cleanup in `finally` (no leak on error)
- Accepted extensions: mp4, wav

### Execution (Agent safety)
- Whitelist enforcement — any action not in `whitelist.ts` is silently rejected
- `dryRun: true` required before medium/high-risk operations
- Path traversal blocked via `path.relative()` — never `startsWith()`
- Sandbox directories: `/etc`, `/var`, `/root`, `/sys` refused

### QA Reports
- JUnit XML ingestion — pass/fail/skip counts, flakiness metrics
- Allure JSON ingestion — test history and trends

### Data Quality
- Rule CRUD (create, read, delete)
- Result recording
- Score computation
- Schema diff detection

### Blueprint
- Import preview (Markdown → structured plan)
- Full import with wiki, brain, state, events
- Warning on existing wiki page
- Brain failure fallback

### Wiki
- CRUD with merge/diff
- LLM compilation
- Versioning
- `human_edited` / `locked` protection

---

## Evidence & Observability

| Signal | Where |
|---|---|
| CI status badge | `ci.yml` — typecheck + lint + test + E2E |
| Code coverage | `pnpm test:cov` — thresholds: functions ≥ 65%, branches ≥ 45%, lines ≥ 67% |
| Agent execution log | `agent_audit_logs` table — actor, module, action, risk, dryRun, durationMs, status |
| Test runs | `TestRun` model — JUnit XML / Allure JSON ingested via `POST /qa/reports/ingest` |
| Screenshots as evidence | `Evidence` records linked to project by `repoSlug`; viewable in web UI |
| LLM observability | `GET /metrics` (Prometheus) — tokens per module/model, request duration, queue size |
| Prompt validation | `ValidationModule` logs severity-classified injection attempts |

---

## Risks

| Risk | Mitigation |
|---|---|
| Prompt injection | `ValidationService.assertValidPrompt()` on every orchestrator entry — 10+ patterns |
| Command execution | `run_command` limited to whitelisted commands only; no free `exec()` or `spawn()` |
| Path traversal | `path.relative()` check on every filesystem action; absolute paths outside sandbox rejected |
| File access | `list_dir` / `file_search` sandbox enforced; depth capped at 4 levels |
| LLM nondeterminism | JSON extraction with 3 fallback strategies (strip fences → regex `{...}` → throw); temperature=0 for classification |
| External API failure | Graceful degradation: Jina errors return empty results; LiteLLM fallback chain (Groq → Claude) |
| Stale memory context | `memory_class` hierarchy: inbox → working → consolidated → archive; archived events excluded from LLM context |
| Agent impersonation | JWT authentication on `GET /tasks/pending`; `role` field validated per task |
| Secret exposure | No secrets in committed files; `.env` gitignored; VPS IP replaced with `<VPS_IP>` in all docs and git history |

---

## Roadmap

### Short-term
- [ ] Playwright smoke tests — UI critical paths (login, project select, chat, screenshot flow)
- [ ] Agent command safety test suite — one spec per high-risk action (docker_stop, git_commit, run_command)
- [ ] Rate-limit tests — verify throttle on `POST /auth/login`
- [ ] CORS tests — verify origin whitelist rejects unlisted origins
- [ ] PDF generation tests — Puppeteer render round-trip

### Medium-term
- [ ] Contract tests (Pact or OpenAPI-based) — API consumer/provider contracts
- [ ] Mutation testing — PiTest/Stryker on validation and security modules
- [ ] Dedicated security test suite — path traversal, injection, whitelist bypass attempts
- [ ] TestRun ↔ Evidence linking — tie screenshots to specific test failures

### Long-term
- [ ] Chaos/resilience tests — LiteLLM provider failure, Redis down, Postgres reconnect
- [ ] Performance baseline — p95 latency targets per route, tracked in CI
- [ ] Swagger protection in production — block `/docs` behind JWT or env flag
