# Rayzen AI — Instruções para Claude Code

Leia este arquivo antes de qualquer tarefa. É o ponto de entrada; detalhes estão nos módulos.

---

## O que é este projeto

Plataforma pessoal de IA com automação, memória semântica, geração de documentos, QA, qualidade de dados e execução assistida entre notebook e máquina de trabalho. Monorepo TypeScript com pnpm workspaces.

**Dono:** Marcelo Rayzen — QA Automation Engineer / Full-stack Developer
**Repositório:** `github.com/marcelorayzen/rayzen-ai`
**Branch de trabalho:** `local/marcelo` (notebook — não misturar com `main` VPS)
**Web produção:** https://rayzen-web.vercel.app (deploy via `cd apps/web && npx vercel deploy --prod`)
**Notion:** https://www.notion.so/334c784498d6818e83a2f0439f5da8cd

---

## Uso diário — passo a passo

### 1. Ligar o notebook primeiro
```
start-rayzen-notebook.bat
```
- Abre Docker Desktop automaticamente se não estiver rodando
- Aguarda PostgreSQL + Redis
- Roda migrations Prisma
- Sobe API (:3101) em janela visível
- Sobe ngrok em janela visível
- Sobe agente com auto-restart em background (log: `apps/agent/agent.log`)

Aguarde a janela da API mostrar `Application is running on: http://[::1]:3101` antes de usar.

### 2. Abrir a interface
Acesse **https://rayzen-web.vercel.app** — a web está no Vercel, não precisa subir nada.

### 3. Selecionar ou criar projeto
- O seletor de projetos fica no topo esquerdo da interface
- **Criar projeto:** clique no `+` ao lado do seletor → nome do projeto → confirma
  - Ao criar, uma página é criada automaticamente no Notion (se `notion.rootPageId` estiver configurado)
- **Selecionar projeto:** clica no nome no dropdown

### 4. Vincular VS Code ao projeto
O hook do Claude Code envia eventos para um `projectId` fixo configurado em:
```
apps/agent/src/hooks/hook.config.mjs   ← gitignored, não sobe para o repositório
```
```js
export default {
  apiUrl: 'https://<url-ngrok-atual>',
  apiToken: '<jwt-token>',
  projectId: '<id-do-projeto-ativo>',  // ← mude aqui ao trocar de projeto
}
```
**Importante:** abrir uma pasta no VS Code não vincula automaticamente ao projeto Rayzen.
Para mudar o projeto ativo no hook: copie o ID do projeto (visível na URL ou no painel) e atualize `projectId` no `hook.config.mjs`.

**Token atual expira: 4 de junho de 2026.** Para renovar:
```bash
# No notebook (API rodando):
curl -X POST http://localhost:3101/auth/login -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}' 
# Copie o token retornado e atualize hook.config.mjs e AGENT_TOKEN no .env
```

### 5. Fluxo de trabalho normal
1. Notebook ligado + bat rodando
2. Abrir VS Code → Claude Code → eventos capturados automaticamente pelo hook
3. Web aberta no projeto correto → painel de Atividade mostra ações em tempo real
4. Usar chat para acionar o agente: `jarvis:screenshot`, `jarvis:get_system_info`, etc.
5. Usar **checkpoint** periodicamente para sintetizar o que foi feito
6. Painel **Brain** para indexar fontes de conhecimento do projeto

### 6. Deploy da web após mudanças
```bash
# No terminal do VS Code (desktop):
git add .
git commit -m "descrição"
git push origin local/marcelo          # atualiza o repositório

cd apps/web
npx vercel deploy --prod               # publica no Vercel
```

### 7. Restart da API (sem reiniciar tudo)
No PowerShell do notebook:
```powershell
$env:API_PORT='3101'; $env:REDIS_URL='redis://localhost:56379'; pnpm --filter api start
```
Ou via chat: `jarvis:restart_api` (faz git pull + build + restart automático).

---

## Setup atual (local/marcelo)

| Componente | Onde roda | Como sobe |
|---|---|---|
| PostgreSQL + Redis + LiteLLM | Notebook (Docker) | `start-rayzen-notebook.bat` |
| API NestJS | Notebook (`:3101`) | `start-rayzen-notebook.bat` |
| Agente PC | Notebook (watchdog) | `start-rayzen-notebook.bat` |
| Túnel ngrok | Notebook | `start-rayzen-notebook.bat` |
| Web Next.js | Vercel | `cd apps/web && npx vercel deploy --prod` |
| Hook Claude Code | Esta máquina | `.claude/settings.json` (automático) |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 15 App Router |
| Backend | NestJS 10 + Fastify adapter |
| LLM proxy | LiteLLM `:4100` — `gpt-4o` e `gpt-4o-mini` mapeados para Claude Sonnet |
| Banco | PostgreSQL 16 + pgvector (`:55432`) |
| Cache / Fila | Redis 7 (`:56379`) + BullMQ 5 |
| ORM | Prisma 5 (19 models) |
| PDF | Puppeteer 22 |
| DOCX | docxtemplater 3 |
| Embeddings | Jina AI (vector 1024) |
| Agente local | Node.js 20/22 LTS + TypeScript |
| Infra | Docker Compose v2 |
| CI/CD | GitHub Actions → SSH deploy (branch `main` → VPS) |
| VPS | Oracle Ampere A1 — Ubuntu 24.04 (branch `main`) |

**Nota LiteLLM:** `gpt-4o` e `gpt-4o-mini` são aliases para `anthropic/claude-sonnet-4-20250514`.
Claude não suporta `response_format: json_object` — usar extração robusta de JSON (strip de code fences + regex).

---

## Estrutura do monorepo

```
rayzen-ai/
├── apps/
│   ├── api/                    # NestJS + Fastify
│   │   ├── src/modules/        # 28 módulos (ver tabela abaixo)
│   │   └── prisma/schema.prisma
│   ├── web/                    # Next.js App Router (Vercel)
│   └── agent/
│       ├── src/
│       │   ├── index.ts        # entry point — poll loop
│       │   ├── poller.ts       # setInterval 3s → GET /tasks/pending
│       │   ├── executor.ts     # dispatcher de actions
│       │   ├── security/whitelist.ts   # CRÍTICO — nunca bypassar
│       │   └── actions/        # 27 actions implementadas
│       └── watchdog.ps1        # auto-restart do agente
├── packages/types/src/index.ts # Task, Document, ChatMessage
├── scripts/
│   └── restart-api.ps1         # git pull → build → restart API
├── infra/nginx/ + litellm/config.yaml
├── rayzen.config.json          # config runtime: obsidian.vaultPath, notion.rootPageId
├── start-rayzen-notebook.bat   # master bat (Docker auto-start + tudo em background)
├── notebook-api-tunnel.bat     # bat manual/debug
└── CLAUDE.md
```

---

## Comandos essenciais

```bash
# Setup
pnpm install
cp .env.example .env

# Notebook — subir tudo
start-rayzen-notebook.bat

# Desenvolvimento individual
pnpm dev:api                    # API → :3101
pnpm dev:web                    # Web → :3100 (local)
pnpm --filter agent dev         # Agent dev mode

# Banco
pnpm db:migrate                 # aplicar migrations (no notebook: cd apps/api && npx prisma migrate dev)
pnpm --filter api db:generate   # gerar Prisma Client (obrigatório após schema changes)
pnpm db:studio                  # Prisma Studio → :5555

# Qualidade
pnpm typecheck
pnpm lint
pnpm test

# Build
pnpm --filter api build
pnpm --filter agent build

# Deploy web (Vercel)
cd apps/web && npx vercel deploy --prod

# Deploy API/VPS
git push origin main            # CI/CD automático via GitHub Actions
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
| **qa** | `POST /qa/reports/ingest` |
| **data-quality** | `POST /data-quality/rules`, `GET /data-quality/rules`, `DELETE /data-quality/rules/:id`, `POST /data-quality/results`, `GET /data-quality/results`, `GET /data-quality/score`, `GET /data-quality/score/history`, `GET /data-quality/summary`, `POST /data-quality/schema-diff` |
| **data-catalog** | `POST /data-catalog/assets`, `GET /data-catalog/assets`, `GET /data-catalog/assets/:id`, `PATCH /data-catalog/assets/:id`, `DELETE /data-catalog/assets/:id`, `POST /data-catalog/lineage/:assetId`, `GET /data-catalog/lineage/:assetId`, `GET /data-catalog/lineage/impact/:assetId` |
| **graph** | `GET /projects/:id/graph`, `GET /projects/:id/graph/goal`, `GET /projects/:id/graph/goals`, `POST /projects/:id/graph/goal`, `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId` |

---

## Banco de dados — modelos Prisma

| Model | Descrição |
|---|---|
| `Project` | Entidade raiz — projetos; `notionPageId` para sincronização |
| `ProjectDocument` | Docs gerados: `project_state`, `decisions_log`, `next_actions`, `work_journal`, `data_map`, `ropa`, `quality_report` |
| `ProjectDocumentVersion` | Histórico com diff e `sourceIds` |
| `SessionArtifact` | Sínteses e checkpoints com `workMode` |
| `Event` | Atividades — source: chat/memory/cli/voice/execution/manual |
| `ProjectRecommendation` | Sugestões proativas: inatividade, doc_stale, blocker_stuck |
| `ProjectState` | Estado estruturado: objective, stage, blockers, decisions, risks |
| `ProjectHealthScore` | Score 0–100: activity, documentation, consistency |
| `Document` | Conteúdo indexado com embedding pgvector(1024) |
| `WikiPage` | Base de conhecimento |
| `WikiPageVersion` | Histórico do wiki |
| `WikiSourceReference` | Rastreabilidade wiki ↔ documentos |
| `TaskLog` | Fila do agente: module, action, status, result, error |
| `ConversationMessage` | Transcrição com tokens_used, projectId, workMode |
| `TestRun` | Resultados de QA: JUnit XML / Allure JSON |
| `DataQualityRule` | Regras de qualidade por dataset |
| `DataQualityResult` | Resultados de execução das regras |
| `SchemaSnapshot` | Snapshot do schema Prisma para diff |
| `DataAsset` | Catálogo de ativos de dados com embedding |
| `DataLineageEdge` | Grafo de linhagem: source → target |
| `ProjectGoal` | Meta do projeto: title, successCriteria (JSON), kpis (JSON), targetDate, status, hierarquia pai/filho |

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
| `jarvis:inspect_schema` | `inspect-schema.ts` | parse Prisma + schema-diff automático |
| `jarvis:docker_ps` | `docker.ts` | |
| `jarvis:docker_start` | `docker.ts` | dryRun disponível |
| `jarvis:docker_stop` | `docker.ts` | dryRun disponível |
| `jarvis:read_emails` | `outlook.ts` | COM Windows |
| `jarvis:send_email` | `outlook.ts` | dryRun disponível |
| `jarvis:get_calendar` | `outlook-calendar.ts` | |
| `jarvis:restart_api` | `restart-api.ts` | git pull + build + restart |
| `jarvis:get_data_quality` | `get-data-quality.ts` | summary/score/history/rules/results |

### Adicionar nova ação

```typescript
// 1. apps/agent/src/security/whitelist.ts — adicionar 'jarvis:nova_acao'
// 2. apps/agent/src/actions/nova-acao.ts — implementar função exportada
// 3. apps/agent/src/executor.ts — import + case no switch
// 4. __tests__/nova-acao.spec.ts — testes de segurança
```

---

## Hook Claude Code → Rayzen AI

Cada ação do Claude (Edit, Write, Bash, Read) dispara `apps/agent/src/hooks/rayzen-hook.mjs`
que envia o evento para `POST /events/cli` com contexto git enriquecido e projectId.

Config em `apps/agent/src/hooks/hook.config.mjs` (gitignored):
```js
export default {
  apiUrl: 'https://<ngrok-url>',    // atualizar quando ngrok reiniciar
  apiToken: '<jwt-token>',           // expira 4 de junho de 2026
  projectId: '<id-do-projeto>',      // mudar ao trocar de projeto ativo
}
```

**Limitação atual:** o `projectId` é fixo por máquina. Não há detecção automática de projeto por pasta do VS Code. Para trabalhar em outro projeto, atualize o `projectId` manualmente.

---

## Notion — configuração

```json
// rayzen.config.json
{
  "notion": {
    "rootPageId": "359c784498d680e68a15e71c90ff9f22"
  }
}
```

- Ao criar um projeto no Rayzen, uma sub-página é criada automaticamente sob a página raiz
- Para indexar no Brain: aba Notion → Integration Token (`secret_...`) + URL da página
- **Pré-requisito:** na página do Notion → `...` → Connections → adicionar integração "Rayzen AI"
- O token da integração fica em Notion Settings → Connections → Rayzen AI → Copy access token

---

## Memória — Brain

- Painel de memória é **filtrado por projeto** quando um projeto está selecionado
- Sem projeto selecionado: mostra todos os chunks (todos os projetos)
- Fontes suportadas: arquivos locais (via hook), GitHub, URL, Notion, upload de arquivo
- Chunks do hook têm `projectId` do `hook.config.mjs` — mude lá para vincular ao projeto certo
- Para deletar chunks: painel Memória → hover no item → ícone de lixeira

---

## Síntese

- Síntese de sessão: botão "Sintetizar sessão atual" no painel Síntese
- Checkpoint: botão "checkpoint" no topo da interface
- O LLM (Claude via LiteLLM) retorna JSON com `summary`, `decisions`, `next_steps`, `learnings`, `confidence`
- Artefatos antigos com "Síntese não disponível" são de antes do fix — podem ser ignorados ou deletados via banco

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
AGENT_API_URL=http://localhost:3101
AGENT_TOKEN=<token gerado via /auth/login>

# Apps
NODE_ENV=development
API_PORT=3101
WEB_PORT=3100
NEXT_PUBLIC_API_URL=http://localhost:3101
```

---

## Goal Graph — camada de intenção do projeto

### O que é

A camada de **intenção** que faltava no Rayzen. O sistema já capturava *o que foi feito* (eventos, sínteses) e *onde está* (ProjectState). O Goal Graph conecta isso a *onde quer chegar* (ProjectGoal) e *o que está atrasado* (Gap Analysis).

```
ProjectGoal (meta)  ←→  ProjectState (estado atual)
        ↓                        ↓
   Gap Analysis (LLM)  →  Next Best Action
        ↓
   Diagrama Mermaid (visual)
```

### Fluxo de uso

1. Painel web → botão **grafo** no header (aparece só com projeto ativo)
2. Sub-modo **Goal Graph**: define a meta do projeto (título, critérios de sucesso, KPIs, prazo)
3. O LLM (gpt-4o-mini) compara a meta com o `ProjectState` atual e eventos recentes → lista de gaps por severidade
4. **Next Best Action**: uma frase de ação concreta derivada do gap mais crítico
5. Marcar critérios como done → barra de progresso atualiza
6. Sub-modo **Estado atual**: diagrama Mermaid do estado (milestones, blockers, próximos passos)

### Estrutura técnica

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | Model `ProjectGoal` com `successCriteria`, `kpis`, hierarquia pai/filho |
| Service | `apps/api/src/modules/graph/graph.service.ts` | Mermaid generation, gap analysis LLM, upsert goal, toggle criteria |
| Controller | `apps/api/src/modules/graph/graph.controller.ts` | 5 rotas sob `/projects/:id/graph` |
| UI | `apps/web/app/page.tsx` | Painel "grafo", formulário de meta, cards de gap, Mermaid render |
| CDN | `apps/web/app/layout.tsx` | `<Script>` Mermaid.js afterInteractive, `theme: dark`, `startOnLoad: false` |

### GapAnalysis — estrutura JSON

```typescript
{
  gaps: Array<{
    area: 'blocker' | 'milestone' | 'kpi' | 'risk' | 'focus'
    description: string
    severity: 'high' | 'medium' | 'low'
    relatedCriteria?: string
  }>
  nextBestAction: string   // frase curta e acionável
  goalProgress: number     // 0–100: (critérios done + milestones done) / total
  confidence: 'low' | 'medium' | 'high'
}
```

### Adicionando novas features ao módulo

```typescript
// graph.service.ts — adicionar método, exportar no controller
// Padrão: lê ProjectState via stateService.get(), compara com ProjectGoal via LLM
// JSON parsing: usar extractJson() interno (cópia de synthesis.service.ts)
// Novos endpoints: registrar em graph.controller.ts com @ApiOperation
```

---

## ADR — Decisões aprovadas

| # | Decisão | Escolha |
|---|---|---|
| 001 | Backend | NestJS 10 + Fastify adapter |
| 002 | LLM | LiteLLM proxy — aliases `gpt-4o`/`gpt-4o-mini` → Claude Sonnet |
| 003 | Banco | PostgreSQL + pgvector (sem Qdrant) |
| 004 | VPS ↔ Agente | Polling 3s + BullMQ Redis |
| 005 | Documentos | Puppeteer (PDF) + docxtemplater (DOCX) |
| 006 | Estrutura | Monorepo pnpm workspaces |
| 007 | Branch local | `local/marcelo` separado do `main` VPS |
| 008 | Agente no notebook | watchdog.ps1 + start-rayzen-notebook.bat sem janelas |
| 009 | Reinício remoto | `jarvis:restart_api` → scripts/restart-api.ps1 |
| 010 | Web deploy | Vercel (Hobby) — branch não configurável, deploy via CLI `vercel deploy --prod` |
| 011 | JSON do LLM | Sem `response_format`, extração robusta: strip code fences + regex `{...}` |
| 012 | Notion por projeto | Sub-páginas sob rootPageId, fire-and-forget na criação de projeto |
| 013 | Goal Graph MVP | Mermaid.js via CDN (sem npm) — `startOnLoad: false`, `theme: dark`; React Flow fica para Fase 2 |
| 014 | Gap Analysis | LLM gpt-4o-mini (temp 0.2) compara `ProjectGoal` vs `ProjectState` → `GapAnalysis` JSON; sem tabela própria |
| 015 | repoSlug auto-detect | Hook detecta projeto pelo slug do git remote/pasta → `GET /projects?repoSlug=` com cache de 5 min em arquivo temp |

---

## Modelos LLM por módulo

| Módulo | Modelo (alias) | Temperature | Observação |
|---|---|---|---|
| Orquestrador (classificar) | gpt-4o-mini | 0 | sem response_format — Claude não suporta |
| Orquestrador (chat) | gpt-4o | 0.7 | com histórico de sessão |
| Jarvis | gpt-4o | 0.3 | tarefas práticas |
| Content Studio | gpt-4o | 0.8 | criatividade maior |
| Doc Engine | gpt-4o-mini | 0.2 | estruturado |
| Síntese | gpt-4o | 0.3 | extração JSON robusta (3 estratégias) |
| Brain (síntese) | gpt-4o-mini | 0.3 | resumir resultados |
| Embeddings | Jina AI | — | vector(1024) |

---

## Regras de desenvolvimento

- TypeScript 100% — sem `any` explícito, sem `.js` puro
- Cada módulo NestJS tem system prompt próprio — nunca usar prompt genérico
- Logar `tokens_used` e `duration_ms` em toda chamada ao LiteLLM
- LiteLLM sempre via proxy — nunca apontar direto para OpenAI/Anthropic
- **Claude não suporta `response_format: json_object`** — usar prompt + extração robusta
- Agente: whitelist é inegociável — ações fora são rejeitadas silenciosamente
- Path traversal (`../`) sempre bloqueado em list-dir e similares
- Ações de risco médio/alto: `dryRun: true` antes de executar
- Após qualquer mudança no schema Prisma: rodar `pnpm --filter api db:generate`

---

## Links úteis

- **Web (produção):** https://rayzen-web.vercel.app
- Swagger local: http://localhost:3101/docs
- LiteLLM UI: http://localhost:4100/ui
- Prisma Studio: http://localhost:5555 (após `pnpm db:studio`)
- Web local (dev): http://localhost:3100
- Notion: https://www.notion.so/334c784498d6818e83a2f0439f5da8cd
