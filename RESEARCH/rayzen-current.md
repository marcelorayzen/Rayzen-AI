# Rayzen AI — estado real e observável

> **Método:** tudo abaixo foi medido em **2026-09-05** contra o repositório na revisão `ce93155` e
> contra o servidor H81 em produção (`servidor-local`). Nada foi inferido para preencher lacuna.
> Onde não houve medição, está escrito **"não medido"** — e isso é uma afirmação sobre este
> documento, não sobre o sistema.
>
> Cada fato traz origem: `arquivo:linha` para código, ou a consulta/comando que produziu o número.
> Números de banco e de disco envelhecem; a data acima é o que os torna verificáveis.

---

## 1. Modelo de memória

Duas camadas, em schemas diferentes do **mesmo** banco.

**Acervo (V1, schema `public`):**

| | |
|---|---|
| tabela | `public.documents` — `id, source_path, content, metadata, checksum, created_at, updated_at, project_id, embedding` |
| volume | **1.890 linhas, 46 MB** |
| embedding | vetor de **1024** dimensões (Jina), coluna `embedding`, extensão `pgvector` |
| escopo | por `project_id` |

**Ciclo de vida (V2, schema `v2`):**

| | |
|---|---|
| tabela | `v2.memory_meta` — `v1_document_id, project_id, memory_class, memory_type, confidence, valid_until, consolidated_into, access_count, last_access_at, notes, mission_id` |
| volume | **54 linhas** — cobre **2,9%** dos 1.890 documentos |
| classes | `inbox` → `working` → `consolidated` |
| tipos | `lesson`, `pattern`, `decision`, `constraint` (e `NULL`) |

Distribuição medida das 54: `consolidated/sem tipo` 12 · `working/sem tipo` 10 · `inbox/lesson` 10 ·
`consolidated/decision` 10 · `inbox/pattern` 6 · `working/lesson` 4 · `working/pattern` 2.

> **`documents` não tem coluna de origem, namespace ou proveniência.** Os únicos discriminadores
> disponíveis são `project_id`, `source_path` e o `metadata` (jsonb) — e a busca **não filtra por
> `metadata`**. Consequência direta: qualquer linha inserida com um `project_id` é elegível a ser
> servida como conhecimento daquele projeto.

---

## 2. Caminho de leitura e escrita da memória

**Leitura** — `apps/api-v2/src/context-engine/context-engine.service.ts`:

```
ContextEngineService.buildSurgical()
  → build()  → selecionarMemoria()
               → MemoryService.search()  (apps/api-v2/src/memory/memory.service.ts:189)
                 → V1ApiService.searchMemoryRaw()   [caminho vetorial, sem síntese LLM]
```

Parâmetros observados em código: piso de relevância **0.52** (decide se a *seção* aparece, não
quais itens), **4** trechos servidos, corte de **400 chars** por trecho, boost por modo de trabalho
com teto **+0.030**.

**Escrita** — 7 pontos de código chamam `indexDocument`/`indexFile`/`replaceBySourcePath`:

```
apps/api/src/modules/brain/brain.service.ts
apps/api/src/modules/event/event.controller.ts
apps/api/src/modules/memory/memory.controller.ts
apps/api/src/modules/memory/memory.service.ts
apps/api/src/modules/orchestrator/orchestrator.service.ts
apps/api/src/modules/qa/qa.service.ts
apps/api/src/modules/wiki/wiki.service.ts
```

(mais `apps/api/src/modules/memory/indexable-path.const.ts`, que é a lista de caminhos indexáveis,
e um spec de contrato)

Toda a escrita de memória vive na **V1**. A V2 lê pela ponte e **nunca escreve** no schema `public`
— `apps/api-v2/src/core/v1-bridge.service.ts`.

---

## 3. Quem ou o que pode escrever

| origem | mecanismo | autenticação |
|---|---|---|
| hook do Claude Code | `PostToolUse` (matcher `Edit\|Write\|Bash`) → `POST /events/cli` | Bearer, token em `hook.config.mjs` |
| servidor MCP | ferramentas de escrita (ver §12) | OAuth / Bearer do MCP |
| API HTTP | 135 rotas na V1, 164 na V2 | JWT (`jwt-auth.guard.ts`) |
| agent desktop/servidor | resultado de tarefa → API | `AGENT_TOKEN` |
| ciclos automáticos | 5 processos internos (ver §11) | dentro do processo |

**Não há aprovação humana em nenhum desses caminhos de escrita de memória.** O que é enviado é
gravado.

---

## 4. Pontos de aprovação humana

Existem, mas **não cobrem a memória**.

`v2.approval_gates` — 177 linhas: **149 `expired`, 18 `approved`, 10 `rejected`, 0 `pending`**.

`PolicyEngine` (`apps/api-v2/src/policy-engine/policy-engine.service.ts`) com **5 regras**, uma por
nome, após a desduplicação de 2026-09-05:

| regra | ação | habilitada |
|---|---|---|
| `deployment_requires_review` | `gate` | sim |
| `low_confidence_knowledge` | `block` (`minConfidence: 0.3`) | sim |
| `memory_requires_source` | `warn` (`minOriginWeight: 0.7`) | sim |
| `synthesizer_requires_sources` | `warn` | sim |
| `code_requires_adr` | `warn` | **não** |

Exercitado em produção nesta data: `trustScore 0.2` → `allowed:false`; `0.95` → `allowed:true`;
`operation: deployment` → `gateRequired: true`.

> **`POST /v2/policy/evaluate` com `operation: deployment` CRIA um gate `pending` real.** Não é
> consulta. Verificado ao gerar um por engano nesta sessão.

---

## 5. Acesso a eventos ao vivo

`apps/api-v2/src/gateway/events.gateway.ts` — WebSocket na porta **3104**, path `/ws`.

| propriedade | valor | origem |
|---|---|---|
| autenticação | token na mensagem `subscribe` **ou** `Authorization: Bearer` no handshake | linhas 27–31, 85–95 |
| prazo para autenticar | **10 s**, senão desconecta | `PRAZO_AUTENTICACAO_MS` |
| teto de conexões | **50** simultâneas | `MAX_CONEXOES` |
| rate limit | **20 mensagens / 10 s** por cliente | `JANELA_MS`, `MAX_MSGS_POR_JANELA` |
| heartbeat | ping a cada 30 s, `terminate()` se não responder | `afterInit` |
| filtro | por projeto, via `subscribe` | linhas 45–49 |

**Exposição:** publicada em `0.0.0.0:3104` (alcançável na LAN) **e** publicamente por
`wss://api.rayzen.com.br/ws` através do Caddy + túnel Cloudflare (`infra/caddy/Caddyfile`).

> O comentário do próprio arquivo (linhas 44–49) registra que **até 2026-08-18 não havia validação
> nenhuma** e qualquer cliente recebia eventos de todos os projetos. O blueprint
> `025-hud-mission-control.md:109`, que descreve o gateway como "sem autenticação", **está
> desatualizado** — foi escrito antes da correção.

---

## 6. Delegação de execução

**Não há fila de mensagens.** Busca por `BullMQ`, `new Queue` e `Worker(` em `apps/api/src` e
`apps/api-v2/src` retorna zero resultados fora de testes.

O mecanismo real é **polling HTTP com claim atômico** — `apps/agent/src/poller.ts`:

```
agent → GET /agent/tasks  (Bearer AGENT_TOKEN)
      → claim atômico: garante que dois agents não executam a mesma tarefa
      → executeTask()  →  apps/agent/src/executor.ts
```

**Whitelist:** `apps/agent/src/security/whitelist.ts` — **44 ações** `jarvis:*`. Ação fora dela é
rejeitada.

**Role policy:** `apps/agent/src/role-policy.ts` separa ações de `desktop` e de `server`.

**`jarvis:supervised_session`** existe e está implementado — `apps/agent/src/actions/supervised-session.ts`,
**269 linhas**. Características observadas:

- protocolo de marcadores determinístico injetado no prompt: `[[RAYZEN:STEP_DONE]]`,
  `[[RAYZEN:QUESTION]]`, `[[RAYZEN:DONE]]`, `[[RAYZEN:ERROR]]`
- fallback heurístico quando o marcador não vem
- `MAX_ITERATIONS = 20`
- envio de log ao vivo agrupado a cada `LOG_FLUSH_MS = 800`
- **linha 131:** `spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'])`

---

## 7. Integração atual com Claude / VS Code

**`.mcp.json`** (raiz do repo) — servidor MCP por stdio:

```json
{ "mcpServers": { "rayzen": { "command": "node", "args": ["...\\apps\\agent\\src\\mcp\\rayzen-mcp.mjs"] } } }
```

**`.claude/settings.json`** — 4 hooks registrados:

| evento | matcher | efeito |
|---|---|---|
| `UserPromptSubmit` | `""` | injeta contexto do Rayzen no prompt |
| `PostToolUse` | `Edit\|Write\|Bash` | envia evento para `POST /events/cli` |
| `Stop` | `""` | evento de fim de sessão |
| `PreToolUse` | `Bash` | inspeção do comando antes de executar |

Mais um bloco `permissions.allow`.

**Não medido:** se o Remote Control oficial do Claude Code está ativado neste ambiente, e qual a
versão instalada do CLI.

---

## 8. Autenticação

| superfície | mecanismo | onde |
|---|---|---|
| API V1 e V2 | JWT | `apps/api/src/modules/auth/jwt-auth.guard.ts` + `public.decorator.ts` |
| agent → API | `Authorization: Bearer ${AGENT_TOKEN}` | `apps/agent/src/poller.ts` |
| hook → API | Bearer, token em `hook.config.mjs` | arquivo **gitignored** (`.gitignore:48`) |
| MCP HTTP | OAuth (`OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET`) + Bearer; tokens persistidos em `/app/storage/mcp/tokens.json` | `apps/agent/src/mcp/rayzen-mcp-http.mjs` |
| WebSocket 3104 | JWT via `subscribe` ou header | `events.gateway.ts` |
| LiteLLM | `LITELLM_MASTER_KEY` | `infra/litellm/config.yaml` |

---

## 9. Autorização e escopo

| camada | granularidade |
|---|---|
| agent | whitelist de **44 ações** + role `desktop`/`server` |
| PolicyEngine | 5 regras, ações `warn` / `block` / `gate` |
| API | JWT valida **identidade**; não há papéis por rota medidos |

> **O servidor MCP não tem nenhuma noção de escopo.** Busca por `scope`, `readOnly`, `read_only` e
> `allowedTools` em `rayzen-mcp-http.mjs` retorna **zero**. As 21 ferramentas — leitura e escrita —
> estão na mesma superfície, sob o mesmo token.

---

## 10. Canais e interfaces existentes

| canal | endereço |
|---|---|
| Web (Next.js) | `127.0.0.1:3100` → público em `rayzen.com.br` |
| API V1 | `127.0.0.1:3101` → público em `api.rayzen.com.br` |
| API V2 | `127.0.0.1:3103` → público em `api.rayzen.com.br/v2/*` |
| WebSocket | `0.0.0.0:3104/ws` → público em `api.rayzen.com.br/ws` |
| MCP HTTP | `127.0.0.1:3102` → público em `rayzen.com.br/mcp*`, `/oauth/*`, `/.well-known/*`, `/webhook/*` |
| LiteLLM | `127.0.0.1:4100` — não exposto |
| Langfuse | `0.0.0.0:3200` — alcançável na LAN, não roteado pelo Caddy |
| Ollama | `127.0.0.1:11434` |
| Postgres | `127.0.0.1:55432` |
| Redis | `127.0.0.1:56379` |
| Caddy | `0.0.0.0:80` e `0.0.0.0:443` (TCP e UDP) |
| previews estáticos | `:80/preview/*` → `file_server` em `/srv/previews` |

Widget Electron consome o WebSocket (`apps/widget/src/main/index.ts:14`).

---

## 11. Scheduler e missões

**5 `setInterval` em `apps/api-v2/src`** (fora de testes):

| serviço | arquivo |
|---|---|
| Catalog | `catalog/catalog.service.ts` |
| EventsGateway (heartbeat 30 s) | `gateway/events.gateway.ts` |
| Invariants | `invariants/invariants.service.ts` |
| Memory (backfill) | `memory/memory.service.ts` |
| QA Scientist | `qa-scientist/qa-scientist.service.ts` |

`v2.missions`: **32 linhas**. **Não medido** nesta rodada: a distribuição por status.

Estado dos invariantes medido hoje: **1 de 13 quebrado** (`registro_sem_projeto`, com 3 eventos
órfãos em 7 dias e passivo histórico de 240 eventos + 4 documentos).

---

## 12. Ferramentas e MCP

O `mcp-http` expõe **21 ferramentas**:

**Leitura (9):** `rayzen_get_context` · `rayzen_search_memory` · `rayzen_get_state` ·
`rayzen_get_events` · `rayzen_get_wiki` · `rayzen_get_goal` · `rayzen_get_resume` ·
`rayzen_list_projects` · `rayzen_list_specialists`

**Escrita (11):** `rayzen_add_event` · `rayzen_checkpoint` · `rayzen_update_planning` ·
`rayzen_create_project` · `rayzen_create_goal` · `rayzen_capture_learning` ·
`rayzen_blueprint_import` · `rayzen_blueprint_import_markdown` · `rayzen_blueprint_preview` ·
`rayzen_blueprint_create_feature_plan` · `rayzen_agent_task`

**Outra (1):** `rayzen`

O servidor stdio (`rayzen-mcp.mjs`) é processo **persistente**, iniciado junto com a sessão do
Claude Code — edições no `.mjs` só valem depois de reabrir a sessão.

Variável `MCP_PROJECT_ID` existe no ambiente do container (`docker-compose.yml`), com default vazio.

---

## 13. Persistência e banco

PostgreSQL 16 com `pgvector` (imagem `pgvector/pgvector:pg16`).

| banco | tamanho |
|---|---|
| `langfuse` | **288 MB** |
| `rayzen_ai` | **129 MB** |
| `postgres` | 7,5 MB |

Dentro de `rayzen_ai`:

| schema | tabelas | tamanho |
|---|---|---|
| `public` (V1) | 31 | **101 MB** |
| `v2` (V2) | 26 | **18 MB** |

**10 maiores tabelas:** `public.documents` 46 MB · `public.events` 27 MB ·
`v2.invariant_reports` 14 MB · `public.project_document_versions` 12 MB ·
`public.conversation_messages` 7,1 MB · `public.session_artifacts` 4,3 MB ·
`v2.guardian_reports` 1,0 MB · `public.test_runs` 888 kB · `public.project_health_scores` 672 kB ·
`public.agent_audit_logs` 576 kB.

**Contagens:** `documents` 1.890 · `events` 20.084 · `conversation_messages` 5.538 ·
`projects` 10 · `v2.knowledge_nodes` 570 · `v2.approval_gates` 177 · `v2.memory_meta` 54 ·
`v2.missions` 32.

Redis é usado por `cache.service.ts`, `agent-bridge.service.ts` e `infra-health.controller.ts`.

**Migrações:** 25 diretórios na V1, 11 na V2 — **36 no total, todas aplicadas**. Na V2 o schema real
vem de `prisma db push`; `migrate deploy` não roda no deploy.

---

## 14. Processos e serviços

**12 containers**, todos no ar:

| container | uptime | imagem |
|---|---|---|
| `postgres` | 3 semanas (healthy) | `pgvector/pgvector:pg16` |
| `redis` | 3 semanas (healthy) | `redis:7-alpine` |
| `caddy` | 3 semanas | `caddy:2-alpine` |
| `cloudflared` | 3 semanas | `cloudflare/cloudflared:latest` |
| `langfuse` | 3 semanas | `langfuse/langfuse:2` |
| `ollama` | 3 semanas | `ollama/ollama:latest` |
| `agent-server` | 3 semanas | build local |
| `mcp-http` | 3 semanas | build local |
| `api` | 13 dias (healthy) | build local |
| `api-v2` | 13 dias (healthy) | build local |
| `web` | 13 dias (healthy) | build local |
| `litellm` | 13 dias | `ghcr.io/berriai/litellm:main-latest` |

Uptime do host: **23 dias**. Carga: `0,02 0,08 0,14`.

---

## 15. Dependências

Next.js 16 · NestJS 11 + Fastify · Prisma 5 (dois clientes, multi-schema) · PostgreSQL 16 +
pgvector · Redis 7 · LiteLLM (proxy) · Jina embeddings (1024) · Ollama `llama3.2:3b` ·
Puppeteer (PDF e smoke de UI) · docxtemplater · Caddy · Cloudflare Tunnel · Langfuse v2.

**Grupos do LiteLLM** (`infra/litellm/config.yaml`): `gpt-4o` → Groq `gpt-oss-120b` ·
`gpt-4o-mini` → Groq `gpt-oss-20b` · `gpt-4o-gemini` → `gemini-3-flash-preview` ·
`gpt-4o-mini-gemini` → `gemini-3.1-flash-lite` · `gpt-4o-premium` → Claude Sonnet ·
`gpt-local` → Ollama. Cadeia de fallback:
`gpt-4o → gpt-4o-gemini → gpt-4o-mini-gemini → gpt-4o-premium`.

**Estado medido hoje:** os grupos `*-premium` apontam para a Anthropic e devolvem
`credit balance is too low`. Os 5 grupos sondados pelo invariante respondem.

---

## 16. Uso de rede e portas

Tudo em `127.0.0.1`, **exceto três**: `caddy` (80/443), `api-v2` (**3104**) e `langfuse` (3200).

Não há port forwarding no roteador — o acesso externo passa pelo **Cloudflare Tunnel**.

---

## 17. Footprint operacional

| recurso | medido |
|---|---|
| CPU | Intel Core **i5-4590** @ 3.30 GHz, **4 núcleos** |
| RAM | **11 GiB** totais — 2,5 GiB usados, **8,6 GiB disponíveis** |
| disco (raiz) | **85 GB de 110 GB — 82%**, **20 GB livres** |
| carga | 0,02 / 0,08 / 0,14 (ocioso) |

**Consumo por container** (`docker stats --no-stream`): `litellm` **836,7 MiB** · `langfuse`
211,3 MiB · `postgres` 206,4 MiB · `api` 114,1 MiB · `web` 112,7 MiB · `api-v2` 103,1 MiB.

> CPU e RAM têm folga confortável. **Disco não.**

---

## 18. Logs, caches, builds e crescimento de armazenamento

`docker system df`:

| tipo | total | recuperável |
|---|---|---|
| Imagens | 17 (12 ativas) — **69,57 GB** | 2,632 GB (3%) |
| Containers | 12 — 19,48 MB | 0 B |
| Volumes locais | 5 — 2,617 GB | 0 B |
| **Build Cache** | 481 entradas — **54,44 GB** | **54,37 GB (quase tudo)** |

> **O maior consumidor de disco do servidor é o build cache do Docker, e ele é 99,9%
> recuperável.** São 54,37 GB recuperáveis num disco com 20 GB livres. Nenhum dado do Rayzen
> ocupa espaço comparável: os dois bancos somados dão **417 MB**.
>
> A causa é estrutural: todo push em `main` dispara `docker compose up -d --build web api api-v2`
> no servidor, e cada build acrescenta camadas ao cache.

**Crescimento observado:** `v2.invariant_reports` tem **6.159 linhas de 2026-08-13 a 2026-09-05** —
23 dias, ≈ **268 linhas/dia**, 14 MB acumulados. É a tabela de crescimento mais rápido medida.

**Não medido:** tamanho dos logs de container (o `du` retornou 0 por falta de permissão) e se há
política de rotação configurada.

---

## 19. Pontos de acoplamento

**V1 ↔ V2.** `V1BridgeService` (`apps/api-v2/src/core/v1-bridge.service.ts`) instancia um
`PrismaClient` próprio para o schema `public` e **só lê**. A V2 depende da V1 para ProjectState,
projetos, eventos e busca de memória.

**`packages/types` não é compilado.** O `package.json` aponta `main: ./src/index.ts` e o único
script é `typecheck`. Importar **valor** de lá quebra em runtime; só tipos são seguros.

**Constantes duplicadas de propósito, com teste anti-drift:**
`memory-ranking.const.ts` (V2) ↔ `work-modes.ts` (V1) e `event-derived-text.const.ts` nas duas apps.
Os testes leem o arquivo da outra app como texto e falham se divergirem.

**`infra/litellm/config.yaml` é bind mount de arquivo único** e o serviço `litellm` **não entra no
webhook de build** — exige `docker compose up -d --force-recreate litellm` após `git pull`.

**O serviço `litellm` declara variáveis de ambiente uma a uma** e não usa `env_file`: chave nova no
`.env` não chega ao container sem editar o `docker-compose.yml`.

**Servidor MCP stdio é persistente** — carrega o `.mjs` na subida da sessão do Claude Code.

**Resolução de projeto pelo `cwd`.** `apps/agent/src/repo-slug.mjs` é a fonte única dos três `.mjs`
(hook, context-hook, MCP) e devolve duas grafias em ordem: crua antes de kebab.

---

## 20. Riscos de conflito com um futuro gateway / harness / sentinel

Apenas o que é observável hoje, sem julgar desenho futuro:

1. **MCP sem escopo.** As 21 ferramentas dividem token e superfície. Um consumidor novo que só
   deva ler receberia, pelo mecanismo atual, também as 11 de escrita.
2. **`documents` sem namespace.** Não há como marcar uma linha como "não é conhecimento do
   projeto" de forma que a busca respeite — ela filtra por `project_id`, não por `metadata`.
3. **`MCP_PROJECT_ID` com default.** A variável existe no container. Consumidor que não informe
   projeto depende do que estiver configurado ali.
4. **A 3104 já está publicamente exposta** (`0.0.0.0` na LAN e `wss://api.rayzen.com.br/ws`), com
   teto de **50 conexões** e rate limit de **20 msg/10 s** por cliente. Um consumidor adicional
   compete nesse teto.
5. **Disco a 82%** com 20 GB livres. Qualquer serviço novo no mesmo host disputa esse espaço, e o
   build cache já ocupa 54 GB.
6. **`supervised_session` roda com `--dangerously-skip-permissions`.** Qualquer camada que passe a
   acionar execução herda esse comportamento como está.
7. **Escrita de memória sem aprovação.** Os 7 pontos de escrita gravam direto; não existe estágio
   de candidato nem revisão humana no caminho.
8. **Nenhum invariante mede o que um consumidor externo faria.** Os 13 medem estado interno e três
   dependências (LLM, `/sessions`, memória servida).

---

## What Rayzen Is Not

Afirmações negativas, todas verificadas nesta data:

- **Não executa código próprio.** Quem executa é o Claude Code (desenvolvimento) ou o agent, pela
  whitelist de 44 ações. O motor de missões da V2 existe e está congelado por decisão de produto.
- **Não tem fila de mensagens.** Sem BullMQ, sem Redis Streams para tarefas. É polling HTTP com
  claim atômico.
- **Não tem aprovação humana no caminho da memória.** Os gates cobrem operações de política
  (deploy, conhecimento com trust baixo), não a gravação de documentos.
- **Não tem escopo de leitura no MCP.** Não existe token read-only.
- **Não tem namespace de memória.** Só `project_id`.
- **Não é multiusuário.** Um `ADMIN_PASSWORD`, um JWT de admin, um dono.
- **Não roda LLM pesado local.** Ollama serve `llama3.2:3b`; o resto vai por API via LiteLLM.
- **Não tem `env_file` no serviço LiteLLM** — variáveis são declaradas uma a uma.
- **Não tem runner de teste em `apps/web`.** Os 949 testes unitários cobrem `api`, `api-v2` e
  `agent`, e **todos mockam o Prisma**. A cobertura de interface vem de `pnpm smoke:web`
  (13 asserções com Puppeteer contra o ambiente no ar).
- **Não tem serviços no CI.** Não há Postgres/Redis no GitHub Actions — decorrência do item acima.
- **Não valida migração no deploy da V2.** O schema vem de `db push`; o diretório de migrações é
  conferido pelo invariante `migracoes_aplicadas`, não pelo pipeline.

---

## Lacunas conhecidas deste documento

Medições que **não** foram feitas e que seriam necessárias antes de um plano:

1. Distribuição de `v2.missions` por status.
2. Tamanho e política de rotação dos logs de container.
3. Versão instalada do Claude Code CLI e se o Remote Control oficial está ativo.
4. Como perguntas e checkpoints do `supervised_session` são persistidos ponta a ponta.
5. Se existe autorização por papel nas 299 rotas, além da validação de identidade do JWT.
6. Latência real do `buildSurgical` sob carga.
7. Comportamento do gateway com múltiplos consumidores próximos do teto de 50 conexões.
