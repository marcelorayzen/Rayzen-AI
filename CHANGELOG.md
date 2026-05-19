# Changelog

All notable changes to Rayzen AI are documented here.

## [Unreleased]

### Added
- **Project context isolation** — chat history, Brain search and `extractAndIndex` are all scoped to the active project; system prompt enriched with real-time state (stage, blockers, active goal, recent events)
- **Goal Graph** — interactive canvas (`@xyflow/react`) for milestones, blockers and next steps; `ProjectGoal` with success criteria progress bar, KPIs with inline editing and LLM auto-track (`jarvis:kpi/auto-track`)
- **Gap analysis** — LLM compares `ProjectGoal` vs `ProjectState` and surfaces `nextBestAction` and gaps by severity
- **Template system with brief** — `create_project_folder template=rayzen brief="..."` calls LiteLLM to pre-fill full project structure from natural language: `CLAUDE.md`, `docs/project.md`, first ADR, `.gitignore`, `.env.example`, git init
- **Workspace Watcher** — polls configured Git repos every 30 s via `git status --porcelain`, indexes changed file content into Brain automatically
- **Agent role separation** — `desktop` Agent on work PC (screenshots, clipboard, local tests), `server` Agent on VPS (logs, Docker, service restarts)
- **Help panel** — `?` button in chat input reveals quick-command grid; clicking a command fills the input
- **Data quality module** — rules, results, score history, schema diff endpoint
- **Data catalog module** — asset catalogue with lineage graph and impact analysis
- **QA module** — test run ingestion (JUnit XML / Allure JSON)
- **Wiki module** — versioned knowledge base with source traceability
- **Proactive rule 7** — `goal_stagnant`: fires when `ProjectGoal.updatedAt` > 5 days and goal progress < 100%
- **Onboarding wizard** — 3-step modal guides first-time project setup (create → index → set goal)

### Fixed
- **Brain routing never firing** — removed `response_format: { type: 'json_object' }` from orchestrator `classify()`; Claude via LiteLLM silently failed on this field, causing every call to fall back to `{ module: 'system' }` (ADR 011)
- **Context leak between projects** — chat history query now filters by `projectId`; `extractAndIndex` passes `projectId` to `memory.index`
- **Deploy path in CI** — corrected from `/opt/rayzen-ai` to `/home/azureuser/projects/rayzen-ai`
- **pnpm version in CI** — upgraded from v9 to v10 to match `packageManager` field in `package.json`
- **Goal Graph SSR error** — `GraphCanvas` loaded via `next/dynamic + ssr: false` (Mermaid v11 is ESM-only)

### Changed
- `create_project_folder` default template changed from `blank` to `rayzen`
- `getProjectContext()` now returns state, active goal, blockers, recent decisions and recent events instead of just name + description
- Prisma generate added before build in `restart-api.ps1` and CI deploy step

## [0.1.0] — 2025-01-01

### Added
- Initial monorepo: NestJS API + Next.js web + Node.js Agent
- Semantic memory with pgvector (1024-dim Jina embeddings)
- LiteLLM proxy with Groq primary + Anthropic fallback
- PC Agent with 20+ whitelist-enforced actions
- Orchestrator: intent classification + SSE streaming
- Document generation: Puppeteer PDF + docxtemplater DOCX
- Voice: Groq PlayAI TTS + Whisper STT
- Notion integration: search, read, create, append
- Health score: 6-dimension weighted score with 30-day history
- Work modes: implementation, debugging, architecture, study, review
- Session synthesis and checkpoint
- Proactive recommendations (6 rules)
- Docker Compose stack with VPS deploy
