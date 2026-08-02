# ADR — Rayzen AI
**Última atualização:** 2026-04-02
**Autor:** Marcelo Rayzen

Registro de todas as decisões de arquitetura do projeto. Não altere uma decisão sem adicionar uma nova entrada justificando a mudança.

---

> **Nota (2026-08-01):** este arquivo registra a primeira geração do projeto (V1). Desde então, uma segunda geração foi construída em paralelo, sem entradas ADR formais aqui:
> - **V2** — `apps/api-v2` (Mission Oriented Engineering System), schema Postgres `v2`, rotas com prefixo `/v2`
>
> Este é um release público curado — módulos experimentais/comerciais adicionais do monorepo privado não fazem parte deste repositório.
>
> `docs/adr/ADR-00X-*.md` é uma pasta **separada e mais recente**, com ADRs pontuais sobre role-policy do agent (`supervised_session`, `graphify_sync`) — não confundir com a numeração ADR-001..009 deste arquivo. Design completo da V2 em `blueprints/`.

---

## Decisões aprovadas

### ADR-001 — Backend: NestJS + Fastify
**Status:** aprovado

NestJS 10 com adapter Fastify como backend principal.

**Justificativa:**
- Stack 100% TypeScript, coerente com o monorepo e PC Agent
- Sistema de módulos nativo por domínio (JarvisModule, BrainModule, etc.)
- `@nestjs/bull` para filas BullMQ sem boilerplate
- Fastify adapter: performance sem mudar a API pública

**Alternativa rejeitada:** FastAPI — vantagem real só com langchain/sklearn local. Custo de manter Python + TypeScript no mesmo monorepo é alto.

---

### ADR-002 — LLM: multi-provider via LiteLLM proxy
**Status:** aprovado

LiteLLM como sidecar Docker, container escuta na porta 4000; o host expõe **4100** (`127.0.0.1:4100:4000` no `docker-compose.yml`). Serviços na rede interna do Docker chamam `http://litellm:4000/v1` com interface OpenAI-compatível.

**Provider atual:** Groq (gratuito), com fallback para Anthropic/Claude.
**Mapeamento real hoje (`infra/litellm/config.yaml`):**
- `gpt-4o` → `groq/llama-3.3-70b-versatile` (fallback Claude Sonnet)
- `gpt-4o-mini` → `groq/llama-3.1-8b-instant`
- `gpt-4o-premium` → Claude Sonnet direto

> Mapeamento evoluiu desde a decisão original (Llama 4 Scout) — ver `CLAUDE.md` da raiz para o estado atual, que é a fonte viva desta informação.

**Modelos por módulo** (configurável em `rayzen.config.json`):

| Módulo | Modelo | Temperature |
|---|---|---|
| Classificador | gpt-4o-mini | 0 |
| Chat | gpt-4o | 0.7 |
| Brain | gpt-4o-mini | 0.3 |
| Doc Engine | gpt-4o-mini | 0.2 |
| Content Studio | gpt-4o | 0.8 |
| Jarvis | gpt-4o | 0.3 |

**Exceção:** TTS chama o Groq diretamente (bypass do LiteLLM) — endpoint de áudio binário não é suportado corretamente pelo proxy.

**Histórico:**
- 2026-04-01: migrado de OpenAI para Groq (quota esgotada). Zero impacto no código.

---

### ADR-003 — Banco de dados: PostgreSQL + pgvector
**Status:** aprovado

PostgreSQL único para dados relacionais e vetoriais. Extensão `pgvector` para embeddings do Brain.

**Dimensão atual:** `vector(1024)` — Jina AI (`jina-embeddings-v3`)

**Histórico:**
- Schema original criado com `vector(1536)` (OpenAI text-embedding-3-small)
- 2026-04-01: migrado para `vector(1024)` ao trocar para Jina AI. Requereu `ALTER TABLE` manual.

**Alternativa rejeitada:** Qdrant — melhor performance em escala, infra extra desnecessária para uso pessoal.

---

### ADR-004 — Comunicação VPS ↔ PC Agent: polling com fila persistente
**Status:** aprovado

PC Agent faz polling na API a cada 3 segundos (configurável em `AGENT_POLL_INTERVAL_MS`). Tarefas ficam em fila Redis (BullMQ).

**Fluxo:**
```
Usuário → API → BullMQ queue (status: pending)
PC Agent → GET /tasks/pending (poll 3s)
PC Agent → executa localmente
PC Agent → PATCH /tasks/:id { status: done, result }
API → retorna resultado ao usuário
```

**Segurança:** PC Agent autentica com JWT. Ações validadas por whitelist antes de qualquer execução.

**Alternativa rejeitada:** WebSocket permanente — mais complexo, sem vantagem real para tarefas com latência de segundos.

---

### ADR-005 — Geração de documentos: Puppeteer + docxtemplater
**Status:** aprovado

- **PDF:** Puppeteer (HTML → PDF)
- **DOCX:** docxtemplater com templates `.docx`

---

### ADR-006 — Estrutura: monorepo pnpm workspaces
**Status:** aprovado

Três apps: `apps/web`, `apps/api`, `apps/agent`. Tipos compartilhados em `packages/types`.

---

### ADR-007 — Autenticação: JWT custom com senha única
**Status:** aprovado (2026-04-02)

Senha única em `ADMIN_PASSWORD` no `.env`. JWT com expiração de 30 dias. Token armazenado em `localStorage` + cookie.

**Justificativa:** ferramenta pessoal de uso único. OAuth seria over-engineering.

**Revisão futura:** se o projeto for multi-usuário, migrar para Auth.js com Google OAuth.

**Alternativas rejeitadas:** Auth.js, Clerk — complexidade desnecessária para single-user.

---

### ADR-008 — Frontend state: React state nativo
**Status:** aprovado (2026-04-02)

Sem Zustand ou TanStack Query. Estado local com `useState`/`useCallback`/`useRef`.

**Justificativa:** a complexidade do estado atual não justifica uma lib externa. Revisitar se o painel crescer.

---

### ADR-009 — Configuração central: rayzen.config.json
**Status:** aprovado (2026-04-02)

Arquivo `rayzen.config.json` na raiz controla: identidade, módulos, LLM por módulo, ações do agent, sandbox, segurança e TTS. Editável via painel `/settings` ou diretamente.

**Justificativa:** permite reutilização por outros usuários sem tocar no código.

---

## Decisões em aberto

| # | Decisão | Opções |
|---|---|---|
| 010 | Scheduler | BullMQ repeat vs node-cron — decidir Fase 6 |
| 011 | Deploy trigger | push-to-main automático vs manual |
| 012 | PC Agent OS | Windows DPAPI vs cross-platform |

---

## Stack atual

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | Next.js App Router | 16.x |
| Backend | NestJS + Fastify | 10.x |
| LLM proxy | LiteLLM | latest |
| LLM provider | Groq (Llama 4) | — |
| Embeddings | Jina AI (jina-embeddings-v3) | 1024 dim |
| Banco | PostgreSQL + pgvector | 16 + 0.7 |
| Cache / Fila | Redis + BullMQ | 7.x + 5.x |
| ORM | Prisma | 5.x |
| PDF | Puppeteer | 22.x |
| DOCX | docxtemplater | 3.x |
| Agent | Node.js (TypeScript) | 20 LTS |
| Container | Docker Compose | v2 |
| VPS | Oracle Ampere A1 (free tier) | Ubuntu 24.04 |
