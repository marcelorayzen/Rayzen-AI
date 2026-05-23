<div align="center">

<img src="https://img.shields.io/badge/Rayzen_AI-v1.0.0-6366f1?style=for-the-badge&logoColor=white" />
<img src="https://img.shields.io/badge/TypeScript-100%25-3178c6?style=for-the-badge&logo=typescript&logoColor=white" />
<img src="https://img.shields.io/badge/NestJS-10-e0234e?style=for-the-badge&logo=nestjs&logoColor=white" />
<img src="https://img.shields.io/badge/Next.js-16.2.2-000000?style=for-the-badge&logo=next.js&logoColor=white" />
<img src="https://img.shields.io/badge/pnpm-10.33.2-f69220?style=for-the-badge&logo=pnpm&logoColor=white" />
<img src="https://img.shields.io/github/actions/workflow/status/marcelorayzen/Rayzen-AI/ci.yml?branch=main&style=for-the-badge&label=CI" />

<br /><br />

<h1>Rayzen AI</h1>

<p><strong>Plataforma de orquestração de contexto, documentação viva e assistência operacional para projetos de tecnologia.</strong><br />Mais do que um assistente conversacional — uma camada contínua de suporte ao desenvolvimento que acompanha sessões de trabalho, registra eventos, estrutura conhecimento, mantém artefatos atualizados e apoia execução via Agent local autorizado.</p>

<p>
  <a href="README.en.md">🇺🇸 English</a> &nbsp;|&nbsp;
  <a href="#demo">Demo</a> ·
  <a href="#o-que-resolve">O que resolve</a> ·
  <a href="#arquitetura">Arquitetura</a> ·
  <a href="#diferenciais-técnicos">Diferenciais</a> ·
  <a href="#referência-de-módulos">Módulos</a> ·
  <a href="#ações-do-pc-agent">PC Agent</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#documentação">Docs</a>
</p>

</div>

---

## Demo

<div align="center">

<!-- 
  DEMO — como adicionar:
  1. Grave um vídeo de 30–60s mostrando o chat, uma tarefa do agent e geração de PDF.
  2. Arraste o arquivo MP4 para um comentário de qualquer issue do GitHub.
  3. GitHub vai fazer upload e gerar um link CDN (ex: https://github.com/user/repo/assets/...).
  4. Cole o link abaixo substituindo o placeholder.
-->

> **Demo em breve** — gravação em andamento.

<!--
<video src="COLE_AQUI_O_LINK_CDN_DO_GITHUB" controls width="700">
  Seu navegador não suporta o elemento de vídeo.
</video>
-->

</div>

---

## Screenshots

<div align="center">

<table>
  <tr>
    <td><img src="docs/assets/interface-principal.png" alt="Interface principal" width="360" /></td>
    <td><img src="docs/assets/work-modes.png" alt="Work modes" width="360" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Interface centrada em projeto com seleção de contexto</sub></td>
    <td align="center"><sub>5 modos de trabalho: implementação, debugging, arquitetura, estudo, revisão</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/recomendacoes.png" alt="Recomendações proativas" width="360" /></td>
    <td><img src="docs/assets/captura-rapida.png" alt="Captura rápida" width="360" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Recomendações proativas — detecta inconsistências como documentação desatualizada em relação ao código</sub></td>
    <td align="center"><sub>Captura rápida de decisões, ideias, problemas e referências com baixo atrito</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/atividade.png" alt="Atividade e checkpoint" width="360" /></td>
    <td><img src="docs/assets/documentacao-viva.png" alt="Síntese de sessões" width="360" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Atividade com filtros de memória hierárquica — all, consolidated, working, inbox, archive</sub></td>
    <td align="center"><sub>Síntese de sessões — decisões, aprendizados e próximos passos extraídos automaticamente</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/brain-indexar.png" alt="Indexar no Brain" width="360" /></td>
    <td><img src="docs/assets/agent-acao.png" alt="PC Agent em ação" width="360" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Brain aceita GitHub, Notion, arquivo (PDF/MD/TXT e mais) e URL — múltiplos arquivos de uma vez</sub></td>
    <td align="center"><sub>PC Agent em ação — lista pastas, tira screenshot e navega no sistema de arquivos via chat</sub></td>
  </tr>
  <tr>
    <td><img src="docs/assets/configuracoes-llm.png" alt="Configurações LLM" width="360" /></td>
    <td><img src="docs/assets/configuracoes-agent.png" alt="Configurações Agent" width="360" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Configuração de modelos por função — classify, chat, brain com temperature individual</sub></td>
    <td align="center"><sub>33 ações do Agent habilitáveis individualmente — apps, git, docker, email, run_tests, inspect_schema, QA</sub></td>
  </tr>
</table>

</div>

---

## O que resolve?

| Cenário | Módulo | Como |
|---|---|---|
| "O que li sobre Docker semana passada?" | Memory | Busca por similaridade pgvector sobre documentos + conversas indexadas |
| "Abre o VS Code e roda o git status" | Execution | Task BullMQ despachada para o PC Agent local via Redis |
| "Gera um PDF de contrato para este cliente" | Document Processing | Confirmação em 2 etapas → Puppeteer renderiza HTML → link de download no chat |
| "Escreve um post no LinkedIn sobre este artigo" | Content Engine | LLM (temp=0.8) com prompt de tom/formato, retorna texto formatado |
| "Gera um diagrama da arquitetura" | Content Engine | Diagrama Mermaid com tipo inferido automaticamente + renderizado no frontend |
| "Lê essa mensagem em voz alta" | Voice | Groq PlayAI TTS, markdown removido, áudio transmitido |
| "Qual a saúde deste projeto?" | Health Score | Score ponderado em 6 dimensões (0–100) com histórico de 30 dias |
| "Onde parei? O que mudou?" | Resume Brief | `POST /projects/:id/resume` — resumo estruturado em segundos |
| "Salva isso no meu Notion" | Notion | Cria/acrescenta páginas via SDK Notion, markdown → blocos Notion |
| "Mostra o schema do banco de dados" | Execution → Agent | `inspect_schema` parseia `schema.prisma` localmente, retorna catálogo de modelos |
| "Roda os testes e mostra coverage" | Execution → Agent | `run_tests` invoca Jest/Vitest/Playwright, retorna resultado estruturado |
| "Tire um print da tela: teste de API 52" | Evidence | Desktop Agent salva por `repoSlug`, envia para a API e alimenta a documentação de teste |

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Browser  (Next.js 16.2.2 App Router)              │
│  ReactMarkdown + <a> customizado renderiza links PDF + blocos Mermaid│
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTP / SSE stream
┌────────────────────────────▼─────────────────────────────────────────┐
│                      OrchestratorModule                               │
│  ① ValidationService.assertValidPrompt()  — proteção contra injeção  │
│  ② classify() → { module, action, confidence }  gpt-4o-mini temp=0  │
│  ③ isPendingDocConfirmation() — fluxo de doc em 2 etapas            │
│  ④ handleMessage() → roteia para módulo → transmite resposta via SSE │
└──┬──────────┬──────────┬────────────┬────────────┬───────────────────┘
   │          │          │            │            │
Memory    Execution  Document    Content       Voice
Module    Module     Processing  Engine        Module
pgvector  BullMQ     Puppeteer   LiteLLM       Groq TTS/STT
Jina      Redis      docxtempl.  Mermaid       Whisper
   │          │
   │    ┌─────┴──────────────────────────┐
   │    │     PC Agent  (Node.js local)  │
   │    │  poll a cada 3s via BullMQ     │
   │    │  33 ações protegidas whitelist │
   │    └────────────────────────────────┘
   │
   └──── Notion ── Project ── Health ── Proactive ── Event ── Git
```

**Data stores:**

| Store | Papel |
|---|---|
| PostgreSQL 16 + pgvector 0.7 | Documentos, conversas, embeddings (1024-dim), health scores, eventos |
| Redis 7 + BullMQ 5 | Fila de tasks entre API e PC Agent |
| LiteLLM (Docker sidecar) | Proxy LLM multi-provider — OpenAI, Groq, Anthropic, tudo via um endpoint |

Veja [docs/architecture.md](docs/architecture.md) para o catálogo completo de módulos e fluxos de dados.

---

## Diferenciais técnicos

- **Proxy LiteLLM** — camada LLM agnóstica de provider; troque OpenAI ↔ Groq ↔ Anthropic via config, zero alterações de código; controle de budget por `virtual_key`

- **PC Agent com whitelist** — 33 ações explicitamente permitidas em `whitelist.ts`; qualquer ação desconhecida é rejeitada silenciosamente; path traversal bloqueado via `path.relative()` (nunca `startsWith()`); ações de risco médio/alto executam `dryRun: true` antes da operação real

- **Camada de validação** — `ValidationModule` na entrada de cada requisição: detecta padrões de prompt injection, aplica limite de tamanho, verifica vazamento de system prompt na saída, valida que módulos classificados existem

- **Memória semântica pgvector** — Jina jina-embeddings-v3 (1024-dim) armazenado no PostgreSQL; todo o histórico de conversa é indexado para aprendizado contínuo entre sessões

- **Streaming SSE** — respostas transmitidas token a token com efeito typewriter; `tokens_used` e `duration_ms` logados em cada chamada LLM e persistidos em `ConversationMessage`

- **Confirmação de documento em 2 etapas** — pedidos de doc mostram preview com estimativa antes de gerar; prompt original embutido como `[DOC_PENDING:base64]`, confirmação dispara geração e retorna link de download clicável

- **`PrismaService` global** — único módulo `@Global()` NestJS, um pool de conexão compartilhado entre todos os 28+ módulos; elimina o anti-pattern `new PrismaClient()`

- **CacheModule Redis** — cache de aplicação `@Global()` com graceful degradation (TTL configurável por tipo): estado do projeto 10 min, wiki 15 min, brain search 5 min; invalidação automática por `delPattern` em escrita

- **Security headers (Helmet)** — `@fastify/helmet` registrado antes de qualquer rota: CSP, HSTS (31536000s), X-Frame-Options, XSS protection, noSniff; desabilitado em dev para não interferir com Swagger; ativo em produção sem intervenção manual

- **Agent Audit Log** — cada execução do Agent gera uma entrada rastreável em `agent_audit_logs`: `actor`, `taskId`, `module`, `action`, `command`, `risk`, `dryRun`, `durationMs`, `status`, `hostname`, `workspace`, `targetRole`; endpoint `GET /tasks/audit` com filtros por action/status; o Agent envia os campos automaticamente em todo PATCH de conclusão

- **Audit de segurança (SEC-1 a SEC-10)** — throttle em `POST /auth/login`, JWT com expiry 8h, CORS whitelist por origin via `CORS_ORIGINS` env var, `timingSafeEqual` com padding de buffers (evita throw em comprimentos diferentes), path validation via `path.relative()`, portas internas ligadas a `127.0.0.1`, pnpm 10.33.2

- **Observabilidade Prometheus** — `GET /metrics` (protegido por JWT) exporta métricas no formato Prometheus: duração HTTP por rota, tokens LLM por módulo/modelo, tasks do Agent por action/status/role, queue size por estado, total de projetos/eventos/audit logs; `collectDefaultMetrics` para heap, GC e event loop do Node.js

- **Análise de custos LLM** — `GET /costs/summary?period=&project_id=` agrega `ConversationMessage` por módulo e projeto; modal `◈ costs` na UI mostra tokens, mensagens, custo estimado USD e breakdown por módulo; todos os módulos que chamam LLM registram em `conversationMessages`

- **Health score** — score ponderado em 6 dimensões (0–100): atividade, atualidade da documentação, consistência interna, próximos passos, bloqueadores, foco; histórico de 30 dias persistido e exibido em gráfico

- **Work modes** — 5 modos (implementation, debugging, architecture, study, review) injetam sufixo de system prompt específico e direcionam o foco da síntese; modo registrado em cada mensagem e artefato

- **Memória hierárquica** — eventos classificados automaticamente na escrita (`inbox → working → consolidated → archive`); eventos arquivados excluídos do contexto LLM na síntese e geração de documentação

- **Integração Notion** — busca, leitura, criação e acréscimo de páginas Notion pelo chat; markdown convertido para blocos Notion (heading_1/2/3, parágrafo, bullet, numerado, citação)

- **Diagramas Mermaid** — content engine infere tipo de diagrama pelo prompt (flowchart, sequenceDiagram, erDiagram, classDiagram, gantt) e retorna blocos `mermaid` renderizados no frontend

---

## Confiabilidade

**198 testes em 18 suites** (179 unit + 19 E2E), aplicados no CI:

**Testes unitários (154):**

| Módulo | O que é testado |
|---|---|
| `ValidationService` | Padrões de prompt injection, vazamento de schema, guard de classificação, níveis de severidade |
| `SessionService` | Stats agregadas de tokens, groupBy de sessão, truncamento de título em 50 chars, título fallback |
| `VoiceService` | Remoção de markdown antes do TTS, limite de 800 chars, ext mp4/wav, limpeza de arquivo temp no finally |
| `MemoryService` | Deduplicação por checksum, erro Jina API, search pgvector (com/sem projectId), indexGithub (404/403/sucesso), indexNotion (401/sucesso), indexFile (txt/md), listDocuments com filtro, deleteDocument |
| `BrainService` | Embed Jina 1024-dim, chunkText, indexDocument (created/updated), search com score numérico, invalidação de cache |
| `WikiService` | Controller CRUD, compilação LLM, merge/diff, versionamento, proteção human_edited/locked |
| `ExecutionService` | Parâmetros do `queue.add`: jobId, attempts=3, backoff=5000 |
| `OrchestratorService` | Roteamento de classificação para módulo correto, `assertValidPrompt` chamado, estrutura de resposta |
| `BlueprintService` | import/preview com todas as opções, warnings de wiki existente, fallback de Brain falho |
| `DataQualityService` | CRUD de regras e resultados, score, histórico, schema-diff |
| `QAService` | Ingestão JUnit XML, Allure JSON, métricas de flakiness |

**Testes E2E com Fastify inject (19):**

| Suite | O que é testado |
|---|---|
| `auth.e2e.spec.ts` | Login com senha correta → 201 + JWT; token válido com `role:admin`; senha errada → 401; payload vazio → 400 |
| `tasks.e2e.spec.ts` | `/tasks/pending` com/sem auth; filtro por role; `PATCH /tasks/:id` com campos de audit; `GET /tasks/audit` com filtros |
| `projects.e2e.spec.ts` | `GET /projects` lista e filtra por `repoSlug`; `POST /projects` cria e valida; `GET /projects/:id` retorna por ID |

Todos os specs usam `{ provide: PrismaService, useValue: mockPrisma }` — sem `new PrismaClient()` nos testes.

```bash
pnpm test:cov    # jest --coverage  (thresholds: functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm test:e2e    # jest --config jest.e2e.json --runInBand  (19 E2E specs com Fastify inject)
```

Veja [docs/validation.md](docs/validation.md) para a filosofia de validação e metas de cobertura.

---

## Referência de módulos

```
apps/api/src/modules/
├── orchestrator/        # Classificação de intent (gpt-4o-mini, temp=0) + roteamento + SSE + work modes
├── brain/               # Embeddings Jina 1024-dim · indexDocument/indexUrl/indexText · busca pgvector
├── wiki/                # WikiPage com merge/diff · editStatus · versionamento · proteção human_edited
├── memory/              # Indexação de GitHub, Notion, URL, arquivo (PDF/MD/TXT) · searchAndSynthesize
├── execution/           # Despacho de tasks BullMQ + jarvis payload builder
├── document-processing/ # PDF Puppeteer · DOCX docxtemplater · endpoint de download
├── content-engine/      # Conteúdo longo · calendário editorial · diagramas Mermaid
├── voice/               # Groq PlayAI TTS (POST /voice/synthesize) + Whisper STT (POST /voice/transcribe)
├── session/             # Histórico de conversa · stats de tokens · session groupBy
├── validation/          # Detecção de prompt injection · validação de output · guard de classificação
├── configuration/       # Personalidade do sistema via rayzen.config.json · config de work mode
├── notion/              # Notion API: busca · leitura · criação · acréscimo · atualização de título
├── agent-bridge/        # Autenticação JWT do PC Agent · fila BullMQ · `audit-log.service` rastreia cada execução em `agent_audit_logs`
├── auth/                # Autenticação JWT + guard ADMIN_PASSWORD
├── project/             # CRUD de projetos + metadados
├── project-state/       # Estado estruturado: milestones, backlog, activeFocus · resume brief
├── health/              # Health score 6 dimensões (0–100) + histórico 30 dias
├── synthesis/           # Síntese e sumarização cross-projeto
├── documentation/       # Geração e exportação de documentação
├── proactive/           # 7 regras proativas: inatividade, doc_stale, bloqueador, next_step, consistência, drift, goal_stagnant
├── event/               # Log de eventos com hierarquia memory_class (inbox → working → consolidated → archive)
├── obsidian/            # Sync com vault Obsidian
├── git/                 # Operações git e insights de repositório
├── cache/               # CacheModule Redis @Global — TTL por tipo, delPattern, graceful degradation
├── costs/               # GET /costs/summary — breakdown por módulo/projeto, estimativa USD
├── blueprint/           # Importação de planos externos: wiki + brain + state + events em um comando
├── graph/               # Goal Graph: milestones, blockers, gap analysis (LLM), KPI auto-track
└── metrics/             # GET /metrics (JWT) — Prometheus: HTTP, LLM tokens, Agent tasks, queue, heap/GC
```

**Modelos LLM por módulo:**

| Módulo | Modelo (alias) | Temperature | Observações |
|---|---|---|---|
| Orchestrator — classify | gpt-4o-mini | 0 | extração JSON robusta — Claude não suporta `response_format` |
| Orchestrator — chat | gpt-4o | 0.7 | histórico completo de conversa incluído |
| ProjectState refresh | gpt-4o-premium | 0.2 | Claude Sonnet direto — análise crítica de qualidade |
| Synthesis / Checkpoint | gpt-4o | 0.3 | extração JSON com 3 estratégias de fallback |
| Documentation | gpt-4o | 0.3 | usa ProjectState como contexto primário |
| Blueprint (plan) | gpt-4o | 0.3 | gera plano Markdown estruturado |
| Graph — gap analysis | gpt-4o-mini | 0.2 | compara ProjectGoal vs ProjectState |
| Graph — KPI auto-track | gpt-4o-mini | 0.1 | evidência em eventos → valor atual do KPI |
| Memory — synthesis | gpt-4o-mini | 0.3 | resume resultados de busca |
| Document Processing | gpt-4o-mini | 0.2 | output estruturado e determinístico |
| Content Engine | gpt-4o | 0.8 | criatividade em primeiro lugar |
| Execution (Jarvis) | gpt-4o | 0.3 | respostas de tarefas práticas |
| Embeddings | jina-embeddings-v3 | — | 1024-dim, via Jina AI API (não passa pelo LiteLLM) |
| Voice TTS | Groq PlayAI Astra | — | markdown removido, chunks de 800 chars |
| Voice STT | Groq Whisper | — | arquivo de áudio → texto |

**Aliases LiteLLM:**
- `gpt-4o` → Groq llama-3.3-70b (primário) + Claude Sonnet (fallback automático)
- `gpt-4o-mini` → Groq llama-3.1-8b (primário) + Claude Haiku (fallback automático)
- `gpt-4o-premium` → Claude Sonnet direto (sem Groq) — operações críticas

---

## Ações do PC Agent

O PC Agent roda localmente (Windows, `apps/agent/`) e faz polling no Redis a cada 3 segundos. Toda ação é controlada pela `whitelist.ts` — ações desconhecidas são descartadas silenciosamente.

| Categoria | Ações |
|---|---|
| Apps e Navegação | `open_app`, `open_url`, `open_vscode` |
| Arquivos e Diretórios | `list_dir`, `file_search`, `organize_downloads`, `create_project_folder` |
| Sistema | `get_system_info`, `screenshot`, `notify`, `clipboard_read`, `clipboard_write` |
| Git | `git_status`, `git_log`, `git_branch`, `git_commit` |
| Terminal e Dev | `run_command`, `run_tests`, `inspect_schema`, `restart_api` |
| Docker | `docker_ps`, `docker_start`, `docker_stop`, `docker_logs` |
| Comunicação | `read_emails`, `send_email`, `get_calendar` |
| QA e Evidências | `parse_test_report`, `get_qa_summary`, `capture_test_failure` |
| Dados e Grafo | `get_data_quality`, `run_graphify`, `graphify_sync` |

**`run_tests`** — invoca Jest, Vitest ou Playwright em qualquer caminho de projeto; parseia stdout para passed/failed/skipped/coverage e retorna `{ passed, failed, skipped, coverage, failures[] }`. Trata corretamente exit code != 0 (falhas de teste).

**`inspect_schema`** — lê `schema.prisma` do projeto alvo, parseia todos os modelos com campos, tipos, modificadores e relações via regex; retorna resumo legível e array estruturado `models[]`.

**Regras de segurança (inegociáveis, nunca bypassar):**
- Path traversal (`../`) bloqueado em `list_dir` e `file_search`
- Diretórios fora do sandbox (`/etc`, `/var`, `/root`, `/sys`) recusados
- `organize_downloads`, `docker_stop`, `git_commit` executam com `dryRun: true` por padrão
- Sem `exec()` ou `spawn()` livre — apenas handlers de ação tipados

Veja [docs/agent-runtime.md](docs/agent-runtime.md) para o modelo de segurança completo e como adicionar novas ações.

---

## Quick start

**Pré-requisitos para desenvolvimento local:** Node.js 20+ no Agent Rayzen, pnpm 10.33.2 e Docker Desktop.

**Operação atual:** stack central em uma VPS Ubuntu na Azure, Agent desktop no PC de trabalho e Agent server na VPS. URLs públicas e segredos ficam fora do README público; veja `docs/remote-agent-setup.md` para o modelo de operação.

```bash
git clone https://github.com/marcelorayzen/Rayzen-AI.git
cd Rayzen-AI
pnpm install
cp .env.example .env
# Preencha as API keys (veja abaixo)
```

**Variáveis de ambiente obrigatórias** (em `apps/api/.env`):

```bash
# LLM
OPENAI_API_KEY=sk-proj-...        # openai.com
GROQ_API_KEY=gsk_...              # groq.com — plano gratuito disponível
JINA_API_KEY=jina_...             # jina.ai  — plano gratuito disponível

# Proxy LiteLLM (sidecar Docker)
LITELLM_BASE_URL=http://localhost:4100/v1
LITELLM_MASTER_KEY=sk-rayzen-qualquer-coisa

# Infraestrutura
DATABASE_URL=postgresql://rayzen:senha@localhost:55432/rayzen_ai
REDIS_URL=redis://localhost:56379

# Auth
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASSWORD=sua_senha

# Integrações opcionais
NOTION_API_KEY=ntn_...            # Integração com Notion
NOTION_DATABASE_ID=               # Database padrão para novas páginas
```

**Execução local manual:**

```bash
docker compose up -d postgres redis litellm

pnpm db:migrate        # aplica o schema (extensão pgvector necessária)

pnpm dev:api           # API  → http://localhost:3101
pnpm dev:web           # Web  → http://localhost:3100
pnpm dev:agent         # PC Agent (necessário para o módulo Execution)
```

Para usar apenas o Agent desktop conectado à VPS, configure `.env.agent.local` a partir de `.env.agent.example` e execute `agent-start.bat`.

Abra **http://localhost:3100** e faça login com a senha que você definiu em `ADMIN_PASSWORD` no arquivo `.env`.

> **Persistência de dados:** PostgreSQL e Redis usam volumes Docker nomeados (`pg_data`, `redis_data`). Reiniciar containers (inclusive após reboot) preserva todos os dados. Os dados só são perdidos com `docker compose down -v`.

---

## Comandos de desenvolvimento

```bash
pnpm typecheck       # TypeScript zero erros (todos os workspaces)
pnpm lint            # ESLint em todos os apps
pnpm test            # Jest
pnpm test:cov        # Jest + relatório de coverage (functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm db:migrate      # Aplicar migrations Prisma
pnpm db:studio       # Prisma Studio em http://localhost:5555
pnpm build           # Build de todos os apps
git push origin main # Branch principal do projeto
```

---

## Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | Next.js App Router | 16.2.2 |
| Backend | NestJS + Fastify | 10.x |
| Proxy LLM | LiteLLM | latest |
| Embeddings | Jina AI (jina-embeddings-v3) | 1024-dim |
| Banco de dados | PostgreSQL + pgvector | 16 + 0.7 |
| Cache / Fila | Redis + BullMQ | 7.x + 5.x |
| ORM | Prisma | 5.x |
| PDF | Puppeteer | 22.x |
| DOCX | docxtemplater | 3.x |
| Voz | Groq (PlayAI Astra TTS + Whisper STT) | — |
| Notion | @notionhq/client | latest |
| Diagramas | Mermaid (bloco fenced, renderizado no Next.js) | — |
| Agent | Node.js TypeScript | 20 LTS |
| Container | Docker Compose | v2 |
| CI/CD | GitHub Actions + deploy SSH | — |
| VPS | Azure Ubuntu VM | Ubuntu |

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Diagrama completo do sistema, catálogo de módulos, data stores, LiteLLM |
| [docs/workflows.md](docs/workflows.md) | 5 fluxos end-to-end: indexação de memória, roteamento, PC agent, voz, geração de doc |
| [docs/validation.md](docs/validation.md) | Filosofia de validação, o que é detectado, metas de cobertura |
| [docs/agent-runtime.md](docs/agent-runtime.md) | Modelo de segurança, catálogo de 33 ações, protocolo dry-run, como adicionar ações |
| [docs/engineering-standards.md](docs/engineering-standards.md) | Regras de DI, PrismaService, proxy LLM, segurança, quando escrever spec |
| [docs/getting-started.md](docs/getting-started.md) | Guia de setup detalhado |
| [docs/personalization.md](docs/personalization.md) | Configuração de persona e comportamento do sistema |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap de fases e status atual |
| [docs/qa-strategy.md](docs/qa-strategy.md) | Pirâmide de testes, cobertura por área, riscos e roadmap de QA |
| [docs/presentations/](docs/presentations/) | Apresentações atualizadas e posts para LinkedIn |

---

## URLs locais

| Serviço | URL |
|---|---|
| Web | http://localhost:3100 |
| API / Swagger | http://localhost:3101/docs |
| LiteLLM UI | http://localhost:4100/ui |
| Prisma Studio | http://localhost:5555 |

---

<div align="center">

<sub>Desenvolvido por <a href="https://github.com/marcelorayzen">Marcelo Rayzen</a> · 100% TypeScript · monorepo NestJS + Next.js · VPS Ubuntu</sub>

</div>
