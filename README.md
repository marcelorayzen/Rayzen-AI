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

<p><strong>E se o seu assistente de IA lembrasse de tudo — e pudesse agir?</strong><br />Rayzen AI é uma plataforma pessoal que combina memória semântica (pgvector), execução assistida via PC Agent com whitelist de segurança, e documentação que se atualiza sozinha à medida que o projeto evolui. Construída como monorepo NestJS + Next.js de produção, não como protótipo.</p>

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

```mermaid
flowchart TD
    Browser["Browser<br/>Next.js 16 App Router"] -->|"HTTP / SSE"| Orch

    subgraph Orch["OrchestratorModule"]
        direction LR
        V["① ValidationService<br/>assertValidPrompt()"] --> C["② classify()<br/>gpt-4o-mini · temp=0"] --> D["③ doc confirmation<br/>fluxo 2 etapas"] --> H["④ handleMessage()<br/>roteia + stream SSE"]
    end

    Orch --> Memory["Memory<br/>pgvector + Jina"]
    Orch --> Execution["Execution<br/>BullMQ + Redis"]
    Orch --> DocProc["Document Processing<br/>Puppeteer + docxtemplater"]
    Orch --> Content["Content Engine<br/>LiteLLM + Mermaid"]
    Orch --> Voice["Voice<br/>Groq TTS/STT + Whisper"]
    Orch -.-> Rest["Notion · Project · Health<br/>Proactive · Event · Git"]

    Execution --> Agent["PC Agent (Node.js local)<br/>poll 3s · 33 ações · whitelist"]
```

**Data stores:**

| Store | Papel |
|---|---|
| PostgreSQL 16 + pgvector 0.7 | Documentos, conversas, embeddings (1024-dim), health scores, eventos |
| Redis 7 + BullMQ 5 | Fila de tasks entre API e PC Agent |
| LiteLLM (Docker sidecar) | Proxy LLM multi-provider — OpenAI, Groq, Anthropic, tudo via um endpoint |

Veja [docs/architecture.md](docs/architecture.md) para o catálogo completo de módulos e fluxos de dados.

---

## Duas gerações

Este README documenta principalmente a **V1** (`apps/api` + `apps/web` + `apps/agent`) — a geração estável, em uso diário, coberta em detalhe abaixo. O repositório também traz a **V2** (`apps/api-v2`) — Mission Oriented Engineering System, schema Postgres `v2` isolado, prefixo de rotas `/v2`, motor de missões com steps/gates de aprovação/Goal Graph/benchmark de qualidade — ainda em adoção, ver `blueprints/` pro design completo.

Este é um release público curado: alguns módulos experimentais/comerciais do monorepo privado (incluindo um sistema de monitoramento de risco de código e um produto de consultoria sobre catálogo de dados) não fazem parte deste corte.

Veja `CLAUDE.md` (raiz do repo) para o mapa completo e as regras de desenvolvimento que cruzam as duas gerações.

---

## Diferenciais técnicos

- **Proxy LiteLLM** — camada LLM agnóstica de provider; troque OpenAI ↔ Groq ↔ Anthropic via config, zero alterações de código; controle de budget por `virtual_key`

- **PC Agent com whitelist** — 33 ações explicitamente permitidas em `whitelist.ts`; qualquer ação desconhecida é rejeitada silenciosamente; path traversal bloqueado via `path.relative()`; ações de risco médio/alto executam `dryRun: true` antes da operação real

- **Camada de validação** — `ValidationModule` na entrada de cada requisição: detecta padrões de prompt injection, aplica limite de tamanho, verifica vazamento de system prompt na saída

- **Memória semântica e hierárquica** — Jina jina-embeddings-v3 (1024-dim) no PostgreSQL/pgvector; eventos classificados automaticamente (`inbox → working → consolidated → archive`), arquivados saem do contexto LLM

- **Health score** — score ponderado em 6 dimensões (0–100): atividade, atualidade da documentação, consistência interna, próximos passos, bloqueadores, foco; histórico de 30 dias

- **Work modes** — 5 modos (implementation, debugging, architecture, study, review) injetam sufixo de system prompt específico e direcionam o foco da síntese

- **Goal Graph** — canvas visual (`@xyflow/react`) de milestones, bloqueadores e KPIs com auto-tracking via LLM a partir de eventos recentes; gap analysis compara meta vs. estado atual

Mais 15 mecanismos (streaming SSE, audit de segurança SEC-1 a SEC-10, observabilidade Prometheus, custos LLM, integração Notion, Workspace Watcher e outros) estão detalhados em [docs/engineering-standards.md](docs/engineering-standards.md).

---

## Confiabilidade

**239 testes em 25 suites** (220 unit + 19 E2E), aplicados no CI a cada push para `main`. Cobertura cruza segurança do agent (whitelist, path traversal, dryRun), contratos de API (auth, tasks, projects), lógica de domínio (memory, brain, wiki, blueprint, graph) e parsing de resposta LLM.

```bash
pnpm test:cov    # jest --coverage  (thresholds: functions ≥ 65%, branches ≥ 45%, lines ≥ 67%)
pnpm test:e2e    # jest --config jest.e2e.json --runInBand  (19 E2E specs com Fastify inject)
```

Todos os specs usam `{ provide: PrismaService, useValue: mockPrisma }` — sem `new PrismaClient()` nos testes. Veja [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) para o detalhe por serviço/suite e [docs/validation.md](docs/validation.md) para a filosofia de validação.

---

## Referência de módulos

`apps/api/src/modules/` reúne 34 módulos NestJS de domínio: desde os núcleos (`orchestrator`, `memory`, `brain`, `execution`, `wiki`) até os de suporte (`session`, `notion`, `data-quality`, `blueprint`, `graph`, `metrics`, `costs`). Cada módulo tem responsabilidade única e system prompt próprio quando chama LLM.

Catálogo completo (34 módulos com descrição, modelo LLM por módulo e aliases LiteLLM) em [docs/architecture.md](docs/architecture.md).

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

Veja [docs/RAYZEN_AGENT_PROTOCOL.md](docs/RAYZEN_AGENT_PROTOCOL.md) para o modelo de segurança completo e como adicionar novas ações.

---

## Quick start

**Pré-requisitos para desenvolvimento local:** Node.js 20+ no Agent Rayzen, pnpm 10.33.2 e Docker Desktop.

**Operação atual:** stack central num notebook Ubuntu local (Docker Compose), exposta via Cloudflare Tunnel — sem port forwarding. Agent desktop roda no PC de trabalho. URLs públicas e segredos ficam fora do README público; veja `docs/remote-agent-setup.md` para o modelo de operação.

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

Para usar apenas o Agent desktop conectado ao notebook, configure `.env.agent.local` a partir de `.env.agent.example` e execute `agent-start.bat`.

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
| Infra | Notebook Ubuntu local + Cloudflare Tunnel | — |

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Diagrama completo do sistema, catálogo de módulos, data stores, LiteLLM |
| [docs/workflows.md](docs/workflows.md) | 5 fluxos end-to-end: indexação de memória, roteamento, PC agent, voz, geração de doc |
| [docs/validation.md](docs/validation.md) | Filosofia de validação, o que é detectado, metas de cobertura |
| [docs/RAYZEN_AGENT_PROTOCOL.md](docs/RAYZEN_AGENT_PROTOCOL.md) | Modelo de segurança, catálogo de ações, protocolo dry-run, como adicionar ações |
| [docs/engineering-standards.md](docs/engineering-standards.md) | Regras de DI, PrismaService, proxy LLM, segurança, quando escrever spec, detalhe dos demais diferenciais técnicos |
| [docs/getting-started.md](docs/getting-started.md) | Guia de setup detalhado |
| [docs/personalization.md](docs/personalization.md) | Configuração de persona e comportamento do sistema |
| [docs/roadmap.md](docs/roadmap.md) | Roadmap de fases e status atual |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Pirâmide de testes, cobertura por área, riscos e estratégia de QA (V1+V2) |
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

<sub>Desenvolvido por <a href="https://github.com/marcelorayzen">Marcelo Rayzen</a> · 100% TypeScript · monorepo NestJS + Next.js</sub>

</div>
