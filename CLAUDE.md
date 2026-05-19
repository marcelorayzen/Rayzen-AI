# Rayzen AI — Instruções para Claude Code

Leia este arquivo antes de qualquer tarefa. É o ponto de entrada; detalhes estão nos módulos.

---

## O que é este projeto

Plataforma pessoal de IA com automação, memória semântica, geração de documentos, QA, qualidade de dados e execução assistida entre a VPS central e o PC de trabalho. Monorepo TypeScript com pnpm workspaces.

**Dono:** Marcelo Rayzen — QA Automation Engineer / Full-stack Developer
**Repositório:** `github.com/marcelorayzen/rayzen-ai`
**Branch principal:** `main`
**Web atual:** `http://<VPS_IP>:3100`
**API atual:** `http://<VPS_IP>:3101`
**Notion:** https://www.notion.so/334c784498d6818e83a2f0439f5da8cd

---

## Uso diário — passo a passo

### 1. Confirmar que a VPS está ligada
- A stack central roda na VPS Azure:
  - PostgreSQL
  - Redis
  - LiteLLM
  - API
  - Web
  - Agent server
- A documentação operacional atual está em `docs/remote-agent-setup.md`.

### 2. Abrir a interface
Acesse **http://<VPS_IP>:3100**.

### 3. Selecionar ou criar projeto
- O seletor de projetos fica no topo esquerdo da interface
- **Criar projeto:** clique no `+` ao lado do seletor → nome do projeto → confirma
  - Ao criar, uma página é criada automaticamente no Notion (se `notion.rootPageId` estiver configurado)
- **Selecionar projeto:** clica no nome no dropdown

### 4. Vincular VS Code ao projeto
O hook do Claude Code detecta o projeto automaticamente pelo nome do repositório git:

```
apps/agent/src/hooks/hook.config.mjs   ← gitignored, não sobe para o repositório
```
```js
export default {
  apiUrl: 'http://<VPS_IP>:3101',
  apiToken: '<jwt-token>',
  projectId: '',  // ← vazio = detecção automática por repoSlug
}
```

**Como funciona:** ao abrir qualquer pasta no VS Code, o hook lê o nome do repositório via `git remote get-url origin`, consulta `GET /projects?repoSlug=<nome>` e vincula os eventos ao projeto correto automaticamente (cache de 5 min).

**Pré-requisito:** o `repoSlug` do projeto no Rayzen deve bater com o nome do repositório git. Projetos criados via `jarvis:create_project_folder template=rayzen` já têm isso configurado. Para projetos existentes, verifique em `PATCH /projects/:id` se necessário.

**Trocar de projeto:** basta abrir outra pasta no VS Code — sem tocar no `hook.config.mjs`.

**Token atual expira: 4 de junho de 2026.** Para renovar:
```bash
# Pela API da VPS:
curl -X POST http://<VPS_IP>:3101/auth/login -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}' 
# Copie o token retornado e atualize hook.config.mjs e AGENT_TOKEN no .env
```

### 5. Fluxo de trabalho normal
1. VPS ligada com a stack central disponível
2. No PC de trabalho, iniciar `agent-start.bat`
3. Abrir VS Code → Claude Code → eventos capturados automaticamente pelo hook
4. Web aberta no projeto correto → painel de Atividade mostra ações em tempo real
5. Usar chat para acionar o agente: `jarvis:screenshot`, `jarvis:get_system_info`, etc.
6. Usar **checkpoint** periodicamente para sintetizar o que foi feito
7. Painel **Brain** para indexar fontes de conhecimento do projeto

### 6. Deploy da web após mudanças
```bash
# No terminal do VS Code (desktop):
git add .
git commit -m "descrição"
git push origin local/marcelo          # enquanto a consolidação para main não termina
```

### 7. Restart da API
Na operação atual, a API roda na VPS. Use o Agent server ou o compose da VPS; no chat, `jarvis:restart_api` deve atingir o Agent `server`, não o desktop.

---

## Setup atual

| Componente | Onde roda | Como sobe |
|---|---|---|
| PostgreSQL + Redis + LiteLLM | VPS (Docker) | `docker compose up -d` |
| API NestJS | VPS (`:3101`) | `docker compose up -d api` |
| Web Next.js | VPS (`:3100`) | `docker compose up -d web` |
| Agent server | VPS | `docker compose up -d agent-server` |
| Agent desktop | PC de trabalho | `agent-start.bat` |
| Hook Claude Code | Esta máquina | `.claude/settings.json` (automático) |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 App Router |
| Backend | NestJS 10 + Fastify adapter |
| LLM proxy | LiteLLM `:4100` — `gpt-4o` e `gpt-4o-mini` mapeados para Claude Sonnet |
| Banco | PostgreSQL 16 + pgvector (`:55432`) |
| Cache / Fila | Redis 7 (`:56379`) + BullMQ 5 |
| ORM | Prisma 5 (21 models) |
| Grafo interativo | @xyflow/react v12 (React Flow) |
| PDF | Puppeteer 22 |
| DOCX | docxtemplater 3 |
| Embeddings | Jina AI (vector 1024) |
| Agente local | Node.js 20/22 LTS + TypeScript |
| Infra | Docker Compose v2 |
| Infra | Azure VPS Ubuntu + Docker Compose |

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
│   ├── web/                    # Next.js App Router (servi?o web na VPS)
│   └── agent/
│       ├── src/
│       │   ├── index.ts        # entry point — poll loop
│       │   ├── poller.ts       # setInterval 3s → GET /tasks/pending
│       │   ├── executor.ts     # dispatcher de actions
│       │   ├── security/whitelist.ts   # CRÍTICO — nunca bypassar
│       │   └── actions/        # 27 actions implementadas
│       └── watchdog.ps1        # legado do modo local
├── packages/types/src/index.ts # Task, Document, ChatMessage
├── scripts/
│   └── restart-api.ps1         # git pull → build → restart API
├── infra/nginx/ + litellm/config.yaml
├── rayzen.config.json          # config runtime: obsidian.vaultPath, notion.rootPageId
├── agent-start.bat             # inicia o Agent desktop
├── agent-server-start.sh        # alternativa fora do compose para o Agent server
├── start-rayzen-notebook.bat    # legado da fase notebook
├── notebook-api-tunnel.bat      # legado/debug da fase notebook
└── CLAUDE.md
```

---

## Comandos essenciais

```bash
# Setup
pnpm install
cp .env.example .env

# PC de trabalho — subir Agent desktop
agent-start.bat

# Desenvolvimento individual
pnpm dev:api                    # API → :3101
pnpm dev:web                    # Web → :3100 (local)
pnpm --filter agent dev         # Agent dev mode

# Banco
pnpm db:migrate                 # aplicar migrations em ambiente de desenvolvimento
pnpm --filter api db:generate   # gerar Prisma Client (obrigatório após schema changes)
pnpm db:studio                  # Prisma Studio → :5555

# Qualidade
pnpm typecheck
pnpm lint
pnpm test

# Build
pnpm --filter api build
pnpm --filter agent build

# Deploy atual da VPS
# aplicar build/restart via Docker Compose na VPS
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
| **graph** | `GET /projects/:id/graph`, `GET /projects/:id/graph/goal`, `GET /projects/:id/graph/goals`, `POST /projects/:id/graph/goal`, `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId`, `PATCH /projects/:id/graph/goal/:goalId/kpi`, `POST /projects/:id/graph/goal/:goalId/kpi/auto-track`, `PATCH /projects/:id/graph/goal/:goalId/status` |

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
| `jarvis:screenshot` | `screenshot.ts` | salva por `repoSlug`, envia evid?ncia para a API e alimenta documenta??o de teste |
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
  apiUrl: 'http://<VPS_IP>:3101',
  apiToken: '<jwt-token>',           // expira 4 de junho de 2026
  projectId: '',                     // vazio = auto-detecção por repoSlug
}
```

**Detecção automática:** o hook identifica o projeto pelo `repoSlug` do repositório git aberto no VS Code. Deixe `projectId` vazio no `hook.config.mjs` para ativar. Para fixar um projeto independente da pasta aberta, preencha `projectId` manualmente.

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
   Grafo interativo React Flow (visual + CRUD)
```

### Fluxo de uso

1. Painel web → botão **grafo** no header (aparece só com projeto ativo)
2. Aba **Estado atual**: grafo interativo com milestones, blockers e próximos passos
   - Se vazio: **⟳ gerar estado** → LLM analisa eventos e gera estado automaticamente
   - CRUD direto no grafo: criar/editar/deletar nodes, ciclar status de milestones → **salvar**
3. Aba **Goal Graph**: define a meta do projeto (título, critérios de sucesso, KPIs, prazo)
   - LLM (gpt-4o-mini) compara meta vs estado atual → gaps por severidade + Next Best Action
   - Marcar critérios como done → barra de progresso atualiza
4. Botão **atualizar** no footer recarrega ambos os dados

### Estrutura técnica

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | Model `ProjectGoal` com `successCriteria`, `kpis`, hierarquia pai/filho |
| Service | `apps/api/src/modules/graph/graph.service.ts` | Gap analysis LLM, upsert goal, toggle criteria, state mermaid (legado) |
| Controller | `apps/api/src/modules/graph/graph.controller.ts` | 5 rotas sob `/projects/:id/graph` |
| Planning | `apps/api/src/modules/project-state/project-state.service.ts` | `updatePlanning` aceita `milestones`, `blockers`, `nextSteps`, `backlog` |
| Canvas | `apps/web/app/components/GraphCanvas.tsx` | `StateCanvas` (CRUD) + `GoalCanvas` (leitura) via `@xyflow/react` |
| UI | `apps/web/app/page.tsx` | Painel "grafo", `openGraph`, `saveGoal`, `toggleCriteria`, `refreshGraphState` |

### GraphCanvas — CRUD de nodes (Estado atual)

| Ação | Como |
|---|---|
| Criar node | Botões `+ milestone` / `+ blocker` / `+ próximo` → input inline |
| Editar texto | Duplo clique no node |
| Ciclar status | Clique no node milestone (pending→active→done) |
| Deletar | Hover → × |
| Persistir | Botão **salvar** → `PATCH /projects/:id/state/planning` |

### GoalCanvas — interações

| Ação | Como |
|---|---|
| Toggle critério | Clique no node de critério → `PATCH /goal/:goalId/criteria/:criteriaId` |
| Editar KPI atual | Clique no valor do KPI no goal card → campo inline → Enter → `PATCH /goal/:goalId/kpi` |
| Ver histórico | Botão "histórico de metas" abaixo do diagrama (lazy load via `GET /graph/goals`) |

### KPIs — estrutura

```typescript
// Armazenados em ProjectGoal.kpis (JSON)
[{ metric: string; target: string; current?: string; unit?: string }]

// Barra de progresso: current/target como float; cores: verde ≥100%, azul ≥60%, âmbar <60%
// Edição inline no goal card; campos no formulário de nova meta
```

### Alerta de estagnação (Proactive Regra 7)

```typescript
// proactive.service.ts — compute()
// Se activeGoal.updatedAt > 5 dias e goalProgress < 100%
// → cria ProjectRecommendation type='goal_stagnant'
// priority: medium (5-13 dias) | high (14+ dias)
```

### Onboarding Wizard

```typescript
// page.tsx — newProjectOpen modal com onboardStep (1|2|3)
// Passo 1: criar projeto → setOnboardStep(2)
// Passo 2: indexar GitHub/Notion/pular → setOnboardStep(3)
// Passo 3: criar primeira meta → closeNewProject()
```

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
// GraphCanvas — novos tipos de node: adicionar em COLORS e NodeType
// Persistência de nodes customizados: usar PATCH /state/planning
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
| 007 | Branch de transição | `local/marcelo` concentra a linha atual até consolidação em `main` |
| 008 | Agentes por papel | `desktop` no PC e `server` na VPS |
| 009 | Reinício remoto | `jarvis:restart_api` roteado para o Agent `server` |
| 010 | Web atual | serviço `web` no Docker Compose da VPS |
| 011 | JSON do LLM | Sem `response_format`, extração robusta: strip code fences + regex `{...}` |
| 012 | Notion por projeto | Sub-páginas sob rootPageId, fire-and-forget na criação de projeto |
| 013 | Goal Graph visual | `@xyflow/react` v12 via `next/dynamic + ssr: false` — Mermaid descartado (v11 ESM puro, não funciona como UMD global) |
| 014 | Gap Analysis | LLM gpt-4o-mini (temp 0.2) compara `ProjectGoal` vs `ProjectState` → `GapAnalysis` JSON; sem tabela própria |
| 015 | repoSlug auto-detect | Hook detecta projeto pelo slug do git remote/pasta → `GET /projects?repoSlug=` com cache de 5 min em arquivo temp |
| 016 | Graph CRUD | Nodes criados/editados no canvas são persistidos via `PATCH /state/planning` (milestones, blockers, nextSteps) — sem tabela graph_nodes própria no MVP |
| 017 | KPI update | `PATCH /goal/:goalId/kpi` com `{metric, current}` atualiza o campo `current` no JSON `kpis` do `ProjectGoal` — sem tabela separada |
| 018 | Goal stagnation | Proactive Regra 7 usa `updatedAt` do `ProjectGoal` como proxy de progresso — sem armazenar histórico de `goalProgress` por data |
| 019 | Onboarding wizard | Wizard 3-passos embutido no modal de novo projeto usando `onboardStep` (1\|2\|3) — reusa estados existentes de importação (`githubUser`, `notionPageId`, etc.) |
| 020 | LiteLLM startup | Scripts `.bat` agora sobem LiteLLM junto com Postgres/Redis no `docker compose up`; aguardam porta 4100 antes de compilar a API |
| 021 | Goal achieved | `PATCH /goal/:goalId/status` com `{status:'achieved'}` arquiva a meta — sem deleção, status serve como filtro no histórico |
| 022 | KPI auto-track | `POST /goal/:goalId/kpi/auto-track` — LLM analisa últimos 30 eventos, retorna `{metric, current}[]` para KPIs com evidência e salva diretamente no JSON `kpis` do goal |

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

- **Web atual:** http://<VPS_IP>:3100
- **Swagger/API atual:** http://<VPS_IP>:3101/docs
- LiteLLM UI: http://localhost:4100/ui
- Prisma Studio: http://localhost:5555 (após `pnpm db:studio`)
- Web local (dev): http://localhost:3100
- Notion: https://www.notion.so/334c784498d6818e83a2f0439f5da8cd

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
