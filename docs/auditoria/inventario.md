# Auditoria — Fase 0: inventário

> Mapa, sem julgamento. Medido em **2026-08-19**. Julgamento em `inventario-final.md`.

---

## 0.1 — Frontend

**11 rotas**, confirmadas por `find apps/web/app -name page.tsx`:

```
/  ·  /catalog  ·  /deck  ·  /discovery  ·  /guardian  ·  /insights
/login  ·  /mission  ·  /mission/[id]  ·  /settings  ·  /work-panel
```

45 componentes `.tsx` no total.

O grosso da navegação **não é rota** — é modal disparado do `Header.tsx` sobre `/`. Controles de
abertura encontrados em `app/page.tsx`:

| Modal / painel | Controle | Componente | Endpoint principal |
|---|---|---|---|
| Histórico de conversas | `openSidebar` | `SidebarOverlay.tsx` | `GET /sessions`, `GET /sessions/:id/messages` |
| Evidências | `openEvidence` | `EvidenceModal.tsx` | `GET /evidence/projects/:id`, `GET /evidence/file/…` |
| Goal Graph | `openGraph` | `GoalGraphPanel.tsx` | `GET /projects/:id/graph/goal` |
| QA | `openQA` | `QADashboardPanel.tsx` | `GET /qa/summary`, `/qa/trend`, `/qa/reports` |
| Missões | `openMissions` | `MissionsModal.tsx` | `GET /v2/missions`, `POST /v2/route` |
| Atividade | `openActivity` | `ActivityModal.tsx` | `GET /events` |
| Docs | `openDocs` | `DocumentationModal.tsx` | `GET /documentation/:id` |
| Síntese | `openSynthesis` | — | `POST /synthesis/checkpoint` |
| Memória | `openMemoryPanel` | — | `GET /memory/documents`, `POST /memory/search` |
| Recomendações | `openRecommendations` | — | `GET /projects/:id/recommendations` |
| Versões | `openVersions` | `VersionsModal.tsx` | `GET /documentation/:id/:t/versions` |
| Custos | `setCostsOpen` | — | `GET /costs/summary` |
| Git | `setGitOpen` | — | `GET /projects/:id/git` |
| Saúde | `setHealthOpen` | `HealthModal.tsx` | `GET /infra/health` |
| Import / Blueprint | `setImportOpen`, `setBlueprintOpen` | `ImportModal.tsx`, `BlueprintModal.tsx` | `POST /blueprint/import`, `/memory/index/*` |
| Novo projeto | `setNewProjectOpen` | — | `POST /projects` |
| Quick capture | `setQuickCaptureOpen` | — | `POST /events` |
| Meta (criar/editar) | `openCreateGoalForm`, `openEditGoalForm` | — | `POST/PATCH /projects/:id/graph/goal` |
| Ajuda | `setHelpOpen` | `HelpPanel.tsx` | estático (`app/help/registry.ts`) |

`voz on/off` é toggle local (`setAutoVoice`), não abre nada. `guardian` é `<a href="/guardian">` —
rota, não modal.

---

## 0.2 — Backend

Contado por `@Controller` e por decorador de método nos `*.controller.ts`:

| | controllers | rotas |
|---|---:|---:|
| V1 (`apps/api`, `:3101`, schema `public`) | 32 | **135** |
| V2 (`apps/api-v2`, `:3103`, prefixo `/v2`, schema `v2`) | 30 | **164** |
| **total** | 62 | **299** |

Bate com a referência do prompt (~135/31 e ~164/30).

**O que o frontend de fato chama** (extraído dos template literals `${API_URL}` e `${V2_URL}`):

- **~65 paths distintos na V1** — sessions, projects/*, graph/*, qa/*, memory/*, evidence/*,
  documentation/*, costs, events, synthesis/*, voice/*, blueprint/*, notion/obsidian sync,
  infra/health, orchestrate/stream, execution/dispatch, agent/session
- **28 paths distintos na V2** — missions, route, approvals, guardian, catalog, chat, context,
  costs, discovery, knowledge, system/status, workflows

Dois hosts distintos, definidos em `apps/web/lib/api-url.ts` (`NEXT_PUBLIC_API_URL` e
`NEXT_PUBLIC_API_V2_URL`).

> ⚠️ Não confundir com "230 rotas órfãs". A lição de método de 07/08 vale aqui: consumo **interno**
> (um módulo importando outro) não aparece nesta contagem. O número de órfãos reais **não foi
> apurado** nesta sessão.

---

## 0.3 — Agent

`apps/agent/src/security/whitelist.ts`: **44 ações** — bate com `docs/agent-actions.md`.

**Não cruzado com handlers** nesta sessão. Whitelist-sem-handler e handler-fora-da-whitelist
seguem não verificados (pendência 3 em `estado.md`).

Produtor de evidência identificado: `maybeUploadEvidence()` em `apps/agent/src/poller.ts:100`,
que dispara **apenas** quando `task.module === 'jarvis' && task.action === 'screenshot'`.

---

## 0.4 — Background: duas famílias

**Fila BullMQ:** uma, `agent-tasks`.

**Ciclos por `setInterval`** — não aparecem em dashboard de fila nenhum. Estado lido ao vivo em
`GET /v2/system/status`:

| Ciclo | Intervalo | Estado medido 19/08 |
|---|---|---|
| `invariants` | 30 min | `saudavel` |
| `memory-backfill` | 15 min | `saudavel` |
| `catalog-sync` | 6 h | `saudavel` |
| `qa-scientist` | 24 h | `saudavel` |
| `guardian` | 30 s (agent) | `saudavel` |

> Divergência com a doc: `CLAUDE.local.md` diz `guardian` = `nunca-subiu`. **Está desatualizado** —
> mediu-se `saudavel`. O `smart-checkpoint` citado no prompt não apareceu no `system/status`;
> não investigado.

Invariantes: **1 de 10 quebrado** — `registro_sem_projeto`, que é o comportamento desejado
(19 eventos + 4 documentos órfãos nos últimos 7 dias).

---

## 0.5 — Integrações externas

Medido por `GET /infra/health` e `GET /v2/route/health`, ambos `200`:

| Integração | Estado |
|---|---|
| Postgres (`public`, `v2`, `langfuse`) | ok — latência 2ms |
| Redis | ok |
| LiteLLM (`:4100`) | ok — latência 32ms |
| api-v2 | ok |
| Langfuse | não sondado nesta sessão |
| Cloudflare Tunnel | não sondado |
| Webhook de build do GitHub | não sondado |

**Cache do LiteLLM: `cache: true`, `ttl: 300`** (`infra/litellm/config.yaml:74-79`). É a única
camada de cache entre a UI e o LLM — relevante para o achado F-003.

Aliases não foram testados individualmente nesta sessão; o invariante `modelos_llm_respondem`
cobre isso e estava verde.

---

## Dado de produção usado como base

8 projetos. `conversation_messages`: **4.982 linhas**. `events` com `metadata.kind='evidence'`: **1**.
Testes: **843** (api 396 · api-v2 357 · agent 90), 74 suítes, todos verdes.
