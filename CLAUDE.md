# Rayzen AI — Instruções para Claude Code

Leia este arquivo antes de qualquer tarefa. É o ponto de entrada; detalhes estão nos módulos.

---

## O que é este projeto

Plataforma pessoal de IA com automação, memória semântica, geração de documentos e execução
assistida entre notebook e máquina de trabalho. Monorepo TypeScript com pnpm workspaces.

**Dono:** Marcelo Rayzen — QA Automation Engineer / Full-stack Developer
**Repositório:** `github.com/marcelorayzen/rayzen-ai`
**Branch de trabalho:** `local/marcelo` (adaptação notebook — não misturar com `main` VPS)
**Notion:** https://www.notion.so/334c784498d6818e83a2f0439f5da8cd

---

## Setup atual (local/marcelo)

| Componente | Onde roda | Como sobe |
|---|---|---|
| PostgreSQL + Redis + LiteLLM | Notebook (Docker) | `start-rayzen-notebook.bat` |
| API NestJS | Notebook (`:3101`) | `start-rayzen-notebook.bat` |
| Agente PC | Notebook (watchdog) | `start-rayzen-notebook.bat` |
| Túnel ngrok | Notebook | `start-rayzen-notebook.bat` |
| Web Next.js | Esta máquina (`:3100`) | `pnpm dev:web` |
| Hook Claude Code | Esta máquina | `.claude/settings.json` (automático) |

**Ponto de entrada único no notebook:** `start-rayzen-notebook.bat`
— sobe tudo em background sem janelas visíveis. Log do agente em `apps/agent/agent.log`.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 App Router |
| Backend | NestJS 10 + Fastify adapter |
| LLM proxy | LiteLLM `:4100` (multi-provider) |
| Banco | PostgreSQL 16 + pgvector (`:55432`) |
| Cache / Fila | Redis 7 (`:56379`) + BullMQ 5 |
| ORM | Prisma 5 (13 models) |
| PDF | Puppeteer 22 |
| DOCX | docxtemplater 3 |
| Embeddings | Jina AI (vector 1024) |
| Agente local | Node.js 20 LTS + TypeScript |
| Infra | Docker Compose v2 |
| CI/CD | GitHub Actions → SSH deploy (branch `main` → VPS) |
| VPS | Oracle Ampere A1 — Ubuntu 24.04 (branch `main`) |

---

## Estrutura do monorepo

```
rayzen-ai/
├── apps/
│   ├── api/                    # NestJS + Fastify
│   │   ├── src/modules/        # 23 módulos (ver tabela abaixo)
│   │   └── prisma/schema.prisma
│   ├── web/                    # Next.js App Router
│   └── agent/
│       ├── src/
│       │   ├── index.ts        # entry point — poll loop
│       │   ├── poller.ts       # setInterval 3s → GET /tasks/pending
│       │   ├── executor.ts     # dispatcher de actions
│       │   ├── security/whitelist.ts   # CRÍTICO — nunca bypassar
│       │   └── actions/        # 26 actions implementadas
│       └── watchdog.ps1        # auto-restart do agente (usado pelo bat)
├── packages/types/src/index.ts # Task, Document, ChatMessage
├── scripts/
│   └── restart-api.ps1         # git pull → build → restart API
├── infra/nginx/ + litellm/config.yaml
├── start-rayzen-notebook.bat   # master bat do notebook (tudo em background)
├── notebook-api-tunnel.bat     # bat manual/debug (sem agente)
├── agent-start.bat             # agent no desktop (uso remoto)
└── CLAUDE.md
```

---

## Comandos essenciais

```bash
# Setup
pnpm install
cp .env.example .env

# Notebook — subir tudo (bat, não pnpm)
start-rayzen-notebook.bat

# Desenvolvimento individual
pnpm dev:api                    # API → :3101
pnpm dev:web                    # Web → :3100
pnpm --filter agent dev         # Agent dev mode (ts-node-dev)

# Banco
pnpm db:migrate                 # aplicar migrations
pnpm --filter api db:generate   # gerar Prisma Client
pnpm db:studio                  # Prisma Studio → :5555

# Qualidade
pnpm typecheck                  # tsc em todo o monorepo
pnpm lint
pnpm test

# Build
pnpm build
pnpm --filter api build
pnpm --filter agent build

# Deploy (VPS — branch main)
git push origin main            # CI/CD automático
```

---

## Módulos da API — rotas completas

| Módulo | Rotas |
|---|---|
| **auth** | `POST /auth/login` |
| **orchestrator** | `POST /orchestrate`, `POST /orchestrate/stream` |
| **event** | `POST /events`, `POST /events/cli`, `PATCH /events/:id/class`, `GET /events/:id/why`, `GET /events` |
| **memory** | `POST /memory/index`, `POST /memory/search`, `GET /memory/documents`, `DELETE /memory/documents/:id`, `POST /memory/index/github`, `POST /memory/index/url`, `POST /memory/index/notion`, `POST /memory/index/file` |
| **brain** | `POST /brain/index`, `POST /brain/search` |
| **project** | `GET /projects`, `GET /projects/:id`, `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id` |
| **project-state** | `GET /projects/:id/state`, `POST /projects/:id/state/refresh`, `POST /projects/:id/resume`, `PATCH /projects/:id/state/planning` |
| **synthesis** | `POST /synthesis/session`, `POST /synthesis/checkpoint`, `GET /synthesis/artifacts` |
| **documentation** | `POST /documentation/generate/:projectId`, `POST /documentation/generate/:projectId/:type`, `GET /documentation/:projectId`, `GET /documentation/:projectId/:type/versions`, `PATCH /documentation/:projectId/:type/reviewed` |
| **wiki** | `POST /wiki/index`, `GET /wiki`, `GET /wiki/:slug`, `PUT /wiki/:slug`, `DELETE /wiki/:slug`, `GET /wiki/:slug/versions`, `GET /wiki/:slug/sources` |
| **agent-bridge** | `GET /tasks/pending`, `PATCH /tasks/:id` |
| **session** | `GET /sessions/tokens`, `GET /sessions`, `GET /sessions/:sessionId/messages`, `DELETE /sessions/:sessionId` |
| **execution** | `POST /execution/dispatch` |
| **git** | `POST /events/git` (webhook), `GET /projects/:id/git` |
| **health** | `GET /projects/:id/health`, `POST /projects/:id/health/compute` |
| **proactive** | `GET /projects/:id/recommendations`, `POST /projects/:id/recommendations/:recId/dismiss` |
| **content-engine** | `POST /content-engine/generate`, `POST /content-engine/calendar`, `POST /content-engine/diagram` |
| **document-processing** | `POST /documents/pdf`, `GET /documents/download/:fileName`, `POST /documents/docx` |
| **notion** | `GET /notion/search`, `GET /notion/pages/:id`, `POST /notion/pages`, `POST /notion/pages/:id/append`, `PATCH /notion/pages/:id/title` |
| **obsidian** | `POST /obsidian/sync/:projectId` |
| **voice** | `POST /voice/synthesize`, `POST /voice/transcribe` |
| **validation** | `POST /validation/prompt`, `POST /validation/output` |
| **configuration** | `GET /configuration`, `PATCH /configuration` |

---

## Banco de dados — modelos Prisma

| Model | Descrição |
|---|---|
| `Project` | Entidade raiz — projetos do usuário |
| `ProjectDocument` | Docs gerados: `project_state`, `decisions_log`, `next_actions`, `work_journal` |
| `ProjectDocumentVersion` | Histórico com diff e `sourceIds` para rastreabilidade |
| `SessionArtifact` | Sínteses e checkpoints com `workMode` |
| `Event` | Atividades capturadas — source: chat/memory/cli/voice/execution/manual; memoryClass: inbox/working/consolidated/archive |
| `ProjectRecommendation` | Sugestões proativas: inatividade, doc_stale, blocker_stuck |
| `ProjectState` | Estado estruturado: objective, stage, blockers, decisions, risks, milestones, backlog |
| `ProjectHealthScore` | Score 0–100: activity, documentation, consistency |
| `Document` | Conteúdo indexado com embedding pgvector(1024) e checksum |
| `WikiPage` | Base de conhecimento — edit_status: generated/human_reviewed/human_edited/locked |
| `WikiPageVersion` | Histórico do wiki com author_type: llm/human |
| `WikiSourceReference` | Rastreabilidade wiki ↔ documentos |
| `TaskLog` | Fila do agente: module, action, status, result, error |
| `ConversationMessage` | Transcrição com tokens_used, projectId, workMode |

---

## Agente PC — ações disponíveis (whitelist)

Toda nova ação **deve** ser adicionada a `apps/agent/src/security/whitelist.ts`.

| Action key | Arquivo | Observação |
|---|---|---|
| `jarvis:open_app` | `open-app.ts` | apps permitidos |
| `jarvis:open_url` | `open-url.ts` | domínios na whitelist |
| `jarvis:open_vscode` | `open-vscode.ts` | path validado |
| `jarvis:list_dir` | `list-dir.ts` | sandbox obrigatório |
| `jarvis:file_search` | `file-search.ts` | max depth 4 |
| `jarvis:organize_downloads` | `organize-downloads.ts` | dryRun disponível |
| `jarvis:create_project_folder` | `create-project-folder.ts` | templates: blank/node/nextjs/python |
| `jarvis:get_system_info` | `get-system-info.ts` | CPU, RAM, disco, uptime |
| `jarvis:screenshot` | `screenshot.ts` | salva em Pictures |
| `jarvis:notify` | `notify.ts` | toast Windows |
| `jarvis:clipboard_read` | `clipboard.ts` | |
| `jarvis:clipboard_write` | `clipboard.ts` | |
| `jarvis:git_status` | `git.ts` | |
| `jarvis:git_log` | `git.ts` | |
| `jarvis:git_branch` | `git.ts` | dryRun disponível |
| `jarvis:git_commit` | `git.ts` | dryRun disponível |
| `jarvis:run_command` | `terminal.ts` | comandos whitelistados |
| `jarvis:run_tests` | `run-tests.ts` | jest/vitest/playwright |
| `jarvis:inspect_schema` | `inspect-schema.ts` | parse Prisma |
| `jarvis:docker_ps` | `docker.ts` | |
| `jarvis:docker_start` | `docker.ts` | dryRun disponível |
| `jarvis:docker_stop` | `docker.ts` | dryRun disponível |
| `jarvis:read_emails` | `outlook.ts` | COM Windows |
| `jarvis:send_email` | `outlook.ts` | dryRun disponível |
| `jarvis:get_calendar` | `outlook-calendar.ts` | |
| `jarvis:restart_api` | `restart-api.ts` | git pull + build + restart; aciona `scripts/restart-api.ps1` |

### Adicionar nova ação

```typescript
// 1. apps/agent/src/security/whitelist.ts — adicionar 'jarvis:nova_acao'
// 2. apps/agent/src/actions/nova-acao.ts — implementar função exportada
// 3. apps/agent/src/executor.ts — import + case no switch
// 4. __tests__/nova-acao.spec.ts — testes de segurança (path, sandbox, dryRun)
```

---

## Hook Claude Code → Rayzen AI

Cada ação do Claude (Edit, Write, Bash, Read) dispara `apps/agent/src/hooks/rayzen-hook.mjs`
que envia o evento para `POST /events/cli` com contexto git enriquecido e projectId.

Config em `apps/agent/src/hooks/hook.config.mjs` (gitignored):
```js
export default {
  apiUrl: 'https://<ngrok-url>',
  apiToken: '<jwt-token>',
  projectId: '7690370b-aa1e-4b13-8335-a8a14ad0d859',  // Rayzen AI no banco
}
```

**Token atual expira: 4 de junho de 2026.** Para renovar: `POST /auth/login` no notebook e atualizar `hook.config.mjs`.

---

## Variáveis de ambiente

```bash
# LLM
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
JINA_API_KEY=jina_...

# LiteLLM
LITELLM_MASTER_KEY=sk-rayzen-...
LITELLM_PORT=4100
LITELLM_BASE_URL=http://localhost:4100/v1
LITELLM_DATABASE_URL=postgresql://rayzen:senha@postgres:5432/rayzen_ai

# Banco
POSTGRES_PASSWORD=senha
DATABASE_URL=postgresql://rayzen:senha@localhost:55432/rayzen_app
REDIS_URL=redis://localhost:56379

# Auth
JWT_SECRET=<openssl rand -hex 32>
JWT_AGENT_EXPIRY=30d
ADMIN_PASSWORD=suasenha

# Agente
AGENT_POLL_INTERVAL_MS=3000
AGENT_API_URL=http://localhost:3101   # no notebook: localhost; no desktop: URL ngrok
AGENT_TOKEN=<token gerado via /auth/login>

# Apps
NODE_ENV=development
API_PORT=3101
WEB_PORT=3100
NEXT_PUBLIC_API_URL=http://localhost:3101
```

---

## ADR — Decisões aprovadas

| # | Decisão | Escolha |
|---|---|---|
| 001 | Backend | NestJS 10 + Fastify adapter |
| 002 | LLM | LiteLLM proxy multi-provider (OpenAI padrão) |
| 003 | Banco | PostgreSQL + pgvector (sem Qdrant) |
| 004 | VPS ↔ Agente | Polling 3s + BullMQ Redis |
| 005 | Documentos | Puppeteer (PDF) + docxtemplater (DOCX) |
| 006 | Estrutura | Monorepo pnpm workspaces |
| 007 | Branch local | `local/marcelo` separado do `main` VPS |
| 008 | Agente no notebook | watchdog.ps1 + start-rayzen-notebook.bat sem janelas |
| 009 | Reinício remoto | `jarvis:restart_api` → scripts/restart-api.ps1 |

---

## Modelos LLM por módulo

| Módulo | Modelo | Temperature | Observação |
|---|---|---|---|
| Orquestrador (classificar) | gpt-4o-mini | 0 | json_object obrigatório |
| Orquestrador (chat) | gpt-4o | 0.7 | com histórico de sessão |
| Jarvis | gpt-4o | 0.3 | tarefas práticas |
| Content Studio | gpt-4o | 0.8 | criatividade maior |
| Doc Engine | gpt-4o-mini | 0.2 | estruturado |
| Brain (síntese) | gpt-4o-mini | 0.3 | resumir resultados |
| Embeddings | Jina AI | — | vector(1024) |

---

## Regras de desenvolvimento

- TypeScript 100% — sem `any` explícito, sem `.js` puro
- Cada módulo NestJS tem system prompt próprio — nunca usar prompt genérico
- Logar `tokens_used` e `duration_ms` em toda chamada ao LiteLLM
- LiteLLM sempre via proxy — nunca apontar direto para OpenAI
- Agente: whitelist é inegociável — ações fora são rejeitadas silenciosamente
- Path traversal (`../`) sempre bloqueado em list-dir e similares
- Ações de risco médio/alto: `dryRun: true` antes de executar

---

## Links úteis

- Swagger local: http://localhost:3101/docs
- LiteLLM UI: http://localhost:4100/ui
- Prisma Studio: http://localhost:5555 (após `pnpm db:studio`)
- Rayzen Web: http://localhost:3100
- Notion: https://www.notion.so/334c784498d6818e83a2f0439f5da8cd
