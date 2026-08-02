# TESTING_STRATEGY — Rayzen AI

> Estratégia de qualidade para V1 + V2.

---

## Objetivo

Garantir qualidade contínua e regressões detectadas antes de produção — cobrindo segurança do agent, contratos de API, lógica de domínio e qualidade de resposta LLM.

---

## Pirâmide de testes

```
          ┌────────────────────┐
          │  LLM Quality (QA   │  BenchmarkModule + QAScientist
          │  Scientist / bench)│  ciclo 24h automático
          ├────────────────────┤
          │   E2E (19 testes)  │  Fastify inject — contratos de API, auth, tasks
          ├────────────────────┤
          │  Unit (225 testes) │  Services — validação, LLM parsing, segurança
          ├────────────────────┤
          │  Agent Safety      │  Whitelist, path traversal, dryRun protocol
          └────────────────────┘
```

**Total CI:** 244 testes (225 unit + 19 E2E) rodando em GitHub Actions a cada push para `main`.

---

## Cobertura de testes (V1)

### Auth & Segurança

- Login: senha correta → 201 + JWT; senha errada → 401; payload vazio → 400
- Throttle: rate limiting `POST /auth/login` (10 req/min)
- `timingSafeEqual` com buffers de comprimento constante
- CORS whitelist via `CORS_ORIGINS`
- Security headers: `@fastify/helmet` — CSP, HSTS 1 ano, X-Frame-Options, noSniff

### Agent Bridge & Audit

- `GET /tasks/pending` — com/sem auth, filtro por role
- `PATCH /tasks/:id` — propagação de campos de audit (actor, module, action, risk, dryRun, durationMs)
- `GET /tasks/audit` — filtros por action, status, actor

### Projetos

- `GET /projects` — list + filtro por repoSlug
- `POST /projects` — criação com validação
- `GET /projects/:id` — lookup por ID

### Validação de prompts

- 10+ padrões de injection: `ignore previous instructions`, `<script>`, `DROP TABLE`, `__import__`
- Schema leak detection
- Guard de nomes de módulo
- Limite de tamanho

### Memory & Brain

- Embedding Jina 1024-dim (round-trip)
- `chunkText` (limites, overlap)
- `indexDocument` — created vs updated path
- Busca semântica com/sem `projectId` scoping
- SHA-256 deduplicação no re-index
- GitHub indexing (404, 403, sucesso)
- Notion indexing
- pgvector query com score threshold

### Execution (Agent safety)

- Whitelist: action fora da lista → rejeitada silenciosamente
- `dryRun: true` obrigatório antes de médio/alto risco
- Path traversal: `../` e paths absolutos fora do sandbox → rejeitados
- Sandbox: `/etc`, `/var`, `/root`, `/sys` recusados

### Outros módulos cobertos

- Session: token stats, groupBy, title truncation (50 chars)
- Voice: markdown stripping, chunk 800 chars, cleanup temp file
- QA Reports: JUnit XML + Allure JSON ingestion
- Data Quality: rule CRUD, score computation, schema diff
- Blueprint: import preview, full import, warning em wiki existente
- Wiki: CRUD com merge/diff, versionamento, lock/human_edited

---

## V2 — Status de cobertura atual

| Módulo V2 | Coberto | Gaps |
|---|---|---|
| MissionModule | Parcial (integração manual) | Testes de unit para updateStep/transition |
| StepExecutorModule | Não | Inferência de tipo, prevOutputs injection, dependsOn |
| SpecialistRegistry | Não | infer() para cada padrão de texto |
| ApprovalGatesModule | Não | Gate-resume flow, retries reset |
| BenchmarkModule | Parcial (via API manual) | Unit para runForStrategy, createCase |
| QAScientistModule | Não | collectFailures filtro infra, ciclo automático |
| ContextEngineModule | Não | sections por modo, cache hit/miss |

**Déficit principal:** todo o motor de missões V2 opera sem testes automatizados — validado apenas por missões de verificação manuais.

---

## CI (GitHub Actions)

```yaml
# .github/workflows/ci.yml
jobs:
  typecheck:  pnpm typecheck
  lint:       pnpm lint
  test:       pnpm --filter api test:cov   # unit, cobertura
  e2e:        pnpm --filter api test:e2e   # Fastify inject
# Deploy: manual via SSH (GitHub Actions IPs bloqueados pelo router)
```

Thresholds de cobertura (`apps/api/package.json`):
- functions ≥ 65%
- branches ≥ 45%
- lines ≥ 67%

---

## QA Scientist (V2) — testes de qualidade LLM

Ciclo automático a cada 24h (warmup 10 min após boot):

```
QAScientistService.runCycle()
  → collectFailures() — coleta SpecialistInstances com status 'failed'
       └─ filtra abortReason iniciando em 'skill_repeated_failure:jarvis:' (infra, não hipótese)
  → generateHypotheses() — LLM propõe causas para as falhas
  → runExperiments() — testa hipóteses via BenchmarkModule
  → persistResults() — salva BenchmarkResult
```

### Benchmark Cases (22 casos em 2026-06-25)

| taskType | Casos | Baseline fitness |
|---|---|---|
| classify | 10 | 0.328 (prompt genérico) → 0.546 (prompt domain-specific) |
| summarize | 6 | 0.611 |
| context_synthesis | 6 | 0.586 |

Alimentar via `POST /v2/benchmark/cases` ou `POST /v2/benchmark/extract` (extração automática de TraceSpans).

---

## Observabilidade de qualidade

| Sinal | Onde |
|---|---|
| CI status | GitHub Actions — typecheck + lint + test + E2E |
| Code coverage | `pnpm test:cov` — thresholds em `jest.coverageThreshold` |
| Agent audit log | `agent_audit_logs` — toda execução persistida |
| Test runs ingested | `TestRun` model — JUnit / Allure via `POST /qa/reports/ingest` |
| Screenshots de evidência | `Evidence` records vinculados ao projeto por repoSlug |
| LLM quality | BenchmarkResult — avgFitness, avgAccuracy por estratégia |
| Traces LLM | Langfuse :3200 — todas as chamadas via LiteLLM |

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| V2 motor de missões sem cobertura automatizada | Missões de verificação manuais após cada mudança |
| Prompt injection | `ValidationService.assertValidPrompt()` — 10+ padrões |
| LLM nondeterminism | 3 estratégias de extração JSON (strip fences → regex → throw); temp=0 para classificação |
| Benchmark cases insuficientes | 22 casos — fitness não completamente representativo; alimentar via extract |

---

## Critérios de pronto

- `pnpm typecheck` + `pnpm lint` passam antes de todo commit
- `pnpm test` com coverage acima dos thresholds
- Novo módulo V1 → ao menos 1 spec de segurança + 1 spec de contrato
- Mudança no `infer()` do SpecialistRegistry → missão de verificação executada manualmente
- Bug corrigido → spec de regressão adicionado antes do merge

---

## Detalhe por suite (unit + E2E)

**Unit tests (220 em 22 suites):**

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
| `QAService` | Ingestão JUnit XML, Allure JSON, métricas de flakiness, auto-captura de padrões flaky como learning |
| `GraphService` | Sincronização de critérios de sucesso com ProjectState, normalização de gap-analysis malformado, mermaid resiliente a successCriteria incompleto |
| `SynthesisService` | Checkpoint avisa sobre critérios possivelmente concluídos (nextSteps + evento, nunca auto-aplica) |
| `CodeLineageService` | Lineage real de arquivo via graphify (sync + impacto direto/transitivo/agregado de múltiplos arquivos) |

**E2E tests com Fastify inject (19):**

| Suite | O que é testado |
|---|---|
| `auth.e2e.spec.ts` | Login com senha correta → 201 + JWT; token válido com `role:admin`; senha errada → 401; payload vazio → 400 |
| `tasks.e2e.spec.ts` | `/tasks/pending` com/sem auth; filtro por role; `PATCH /tasks/:id` com campos de audit; `GET /tasks/audit` com filtros |
| `projects.e2e.spec.ts` | `GET /projects` lista e filtra por `repoSlug`; `POST /projects` cria e valida; `GET /projects/:id` retorna por ID |

Todos os specs usam `{ provide: PrismaService, useValue: mockPrisma }` — sem `new PrismaClient()` nos testes.

---

## Próximos ajustes

- Testes unit para `StepExecutorService.runNext()` (dependsOn + prevOutputs)
- Testes unit para `SpecialistRegistry.infer()` cobrindo todos os 7 tipos
- Playwright smoke tests: login, seleção de projeto, chat, missão end-to-end
- Suite de segurança dedicada: path traversal, whitelist bypass, injection por role
- Testes de regressão para `skill_repeated_failure` (máx 3 falhas consecutivas)
- `pnpm test:e2e` para V2 (hoje sem E2E automatizado)
