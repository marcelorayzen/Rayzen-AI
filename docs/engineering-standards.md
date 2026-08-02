# Engineering Standards — Rayzen AI

## Princípio
Mudanças estruturais relevantes devem ser deliberadas, rastreáveis e não devem quebrar contratos externos enquanto estão em andamento.

---

## Estrutura do repositório

```
apps/api/src/
  modules/          # módulos de domínio — um por responsabilidade
  prisma/           # PrismaService compartilhado (global)
apps/web/           # Next.js 16 App Router
apps/agent/         # PC Agent local
packages/types/     # contratos compartilhados API ↔ agent ↔ web
docs/               # arquitetura, operação, workflows
```

---

## Regras de arquitetura

### Banco de dados
- Usar `PrismaService` injetado via NestJS DI — nunca `new PrismaClient()` diretamente em services
- `PrismaModule` é global — não precisa ser importado em cada módulo

### Injeção de dependências
- Dependências declaradas no construtor com `private readonly`
- Services não instanciam dependências manualmente

### Acoplamento
- Evitar múltiplas responsabilidades num único service
- Lógica de domínio de execução (`buildJarvisPayload`) fica em `execution/`, não no `orchestrator/`
- Contratos compartilhados nascem ou refletem em `packages/types/src/index.ts`

### LLM
- Toda chamada ao LLM vai via proxy LiteLLM (`LITELLM_BASE_URL`)
- Nunca apontar diretamente para OpenAI/Groq/Anthropic no código dos services

---

## Regras de segurança

- Inputs validados antes de chamadas LLM críticas (`ValidationService.assertValidPrompt`)
- Toda execução local passa por `ALLOWED_ACTIONS` em `whitelist.ts`
- `jarvis:run_command` é ação de risco elevado — payloads devem ser revisados
- Path traversal sempre bloqueado nas actions do agent
- Actions destrutivas implementam `dryRun: true` antes da execução real

---

## Regras de qualidade

- `pnpm typecheck` deve passar zero erros antes de qualquer commit
- Coverage mínimo: functions ≥ 65%, branches ≥ 45%, lines ≥ 67% (thresholds em `apps/api/package.json → jest.coverageThreshold`)
- Testes E2E em `test/e2e/` usam Fastify inject — sem banco real, sem servidor HTTP; rodar com `pnpm --filter api test:e2e`
- Testes de segurança do PC Agent não são opcionais (whitelist, path traversal, sandbox)

---

## Regras de documentação

- `README.md` e `docs/` não podem divergir silenciosamente do código
- Mudanças de stack atualizam o README
- Mudanças comportamentais no orquestrador ou agent atualizam `docs/workflows.md`
- Mudanças de arquitetura atualizam `docs/architecture.md`

---

## Quando criar uma spec antes de implementar

Mudanças que exigem alinhamento antes da implementação:

- mudança de contrato entre API e agent
- novo módulo com mais de uma responsabilidade
- mudança de comportamento de memória ou validação
- nova action no PC Agent
- refactor que atravessa mais de 3 arquivos

Formato mínimo de spec:

```
docs/specs/<id>-<slug>.md

## Contexto
## Objetivo
## Arquivos afetados
## Invariantes (o que não pode quebrar)
## Tarefas
```

---

## Referência rápida

| Onde | O que fica |
|---|---|
| `packages/types/src/index.ts` | Tipos compartilhados: `Task`, `TaskModule`, `ChatMessage` |
| `apps/agent/src/security/whitelist.ts` | Lista de actions permitidas — não bypassar |
| `apps/agent/src/executor.ts` | Switch de dispatch das actions — não remover cases existentes |
| `apps/api/src/prisma/` | `PrismaService` global — único ponto de conexão com o banco |
| `apps/api/src/modules/execution/jarvis-payload-builder.ts` | Montagem de payloads do Jarvis |
| `apps/api/src/modules/orchestrator/work-modes.ts` | Configs dos 5 work modes |

---

## Funcionalidades implementadas (detalhe)

Mecanismos que sustentam os diferenciais técnicos citados no README — aqui documentados em detalhe para não inflar o README com prosa.

- **Streaming SSE** — respostas transmitidas token a token com efeito typewriter; `tokens_used` e `duration_ms` logados em cada chamada LLM e persistidos em `ConversationMessage`
- **Confirmação de documento em 2 etapas** — pedidos de doc mostram preview com estimativa antes de gerar; prompt original embutido como `[DOC_PENDING:base64]`, confirmação dispara geração e retorna link de download clicável
- **`PrismaService` global** — único módulo `@Global()` NestJS, um pool de conexão compartilhado entre todos os módulos; elimina o anti-pattern `new PrismaClient()`
- **CacheModule Redis** — cache de aplicação `@Global()` com graceful degradation (TTL configurável por tipo): estado do projeto 10 min, wiki 15 min, brain search 5 min; invalidação automática por `delPattern` em escrita
- **Security headers (Helmet)** — `@fastify/helmet` registrado antes de qualquer rota: CSP, HSTS (31536000s), X-Frame-Options, XSS protection, noSniff; desabilitado em dev para não interferir com Swagger
- **Agent Audit Log** — cada execução do Agent gera entrada rastreável em `agent_audit_logs`: `actor`, `taskId`, `module`, `action`, `command`, `risk`, `dryRun`, `durationMs`, `status`, `hostname`, `workspace`, `targetRole`; `GET /tasks/audit` com filtros
- **Audit de segurança (SEC-1 a SEC-10)** — throttle em `POST /auth/login`, JWT 8h, CORS whitelist via `CORS_ORIGINS`, `timingSafeEqual` com padding de buffers, path validation via `path.relative()`, portas internas em `127.0.0.1`
- **Observabilidade Prometheus** — `GET /metrics` (JWT) exporta duração HTTP por rota, tokens LLM por módulo/modelo, tasks do Agent por action/status/role, queue size, heap/GC/event loop (`collectDefaultMetrics`)
- **Análise de custos LLM** — `GET /costs/summary?period=&project_id=` agrega `ConversationMessage` por módulo e projeto; modal `◈ costs` na UI mostra tokens, mensagens e custo estimado USD
- **Integração Notion** — busca, leitura, criação e acréscimo de páginas Notion pelo chat; markdown convertido para blocos Notion (heading_1/2/3, parágrafo, bullet, numerado, citação)
- **Diagramas Mermaid** — content engine infere tipo de diagrama pelo prompt (flowchart, sequenceDiagram, erDiagram, classDiagram, gantt) e retorna blocos `mermaid` renderizados no frontend
- **Separação de papéis do Agent** — Agent `desktop` roda no PC de trabalho (screenshot, clipboard, testes locais); Agent `server` roda no notebook que hospeda a stack (logs, Docker, restarts); ambos compartilham polling e whitelist; `jarvis:restart_api` sempre roteia para `server`
- **Workspace Watcher** — faz polling em repositórios Git configurados a cada 30s via `git status --porcelain`; detecta arquivos alterados, lê o conteúdo e indexa no Brain com o `projectId` do projeto — sem hooks específicos de editor
- **Template com brief** — `create_project_folder template=rayzen brief="..."` chama o LiteLLM para pré-preencher a estrutura completa do projeto a partir de uma descrição em linguagem natural: `CLAUDE.md`, `docs/project.md`, primeiro ADR, `.gitignore`, `.env.example`, `.claude/settings.json`, git init com commit inicial
- **Isolamento de contexto por projeto** — cada sessão de chat é escopada ao projeto selecionado; histórico, busca no Brain e extração de conhecimento filtram por `projectId`; system prompt é enriquecido com estado em tempo real (estágio, bloqueadores, meta ativa, eventos recentes)
