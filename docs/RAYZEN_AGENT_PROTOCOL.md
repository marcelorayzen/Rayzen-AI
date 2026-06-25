# RAYZEN AGENT PROTOCOL — Rayzen AI

> Protocolo de comunicação, segurança e execução do PC Agent (desktop) e Server Agent. Define contratos inegociáveis entre a API e os agentes locais.

---

## Objetivo

Garantir que toda ação executada localmente (no desktop ou no servidor) seja autenticada, auditada, dentro do escopo autorizado e reversível antes de destruir dados.

---

## Arquitetura

```
V1 API (:3101)
  → POST /execution/dispatch → Redis BullMQ (fila agent-tasks)
                                     ↑
                              Poll a cada 3s
                                     │
                              ┌──────▼──────────────────────────┐
                              │         PC Agent (desktop)       │
                              │  poller.ts → executor.ts         │
                              │  whitelist.ts → actions/*.ts     │
                              │  role-policy.ts                  │
                              └──────────────────────────────────┘
```

**Agent desktop:** roda no PC Windows do usuário, processa tarefas de filesystem, git, browser, notificações.
**Agent server:** roda no notebook Ubuntu (192.168.0.174), processa tarefas de docker, serviços, restart_api.

---

## Ciclo de vida de uma tarefa

```
1. API → Redis: BullMQ job { module, action, payload, projectId }
2. Agent poll (3s) → GET /tasks/pending?role=desktop
3. whitelist.ts: ALLOWED_ACTIONS.has(action) → rejeita silenciosamente se não
4. role-policy.ts: isActionAllowedForRole(role, action) → rejeita se não
5. executor.ts: dispatch → actions/X.ts(payload)
6. PATCH /tasks/:id { status:'done'|'failed', result, actor, module, action,
                       risk, dryRun, durationMs, hostname, workspace }
7. agent_audit_logs: toda execução persistida (inclui falhas)
```

---

## Whitelist (`apps/agent/src/security/whitelist.ts`)

44 ações permitidas. **Qualquer ação fora da lista é silenciosamente rejeitada.**

Categorias:
- **filesystem:** file_read, file_write, file_delete, file_search, list_dir
- **git:** git_status, git_log, git_branch, git_commit, git_diff, git_add, git_pull, git_push
- **system:** run_command, run_tests, get_system_info, screenshot, notify, clipboard_read/write
- **apps:** open_app, open_url, open_vscode
- **data:** inspect_schema, parse_test_report, get_qa_summary, get_data_quality
- **infra:** docker_ps, docker_start, docker_stop, docker_logs, restart_api
- **graphify:** run_graphify, graphify_sync
- **org:** read_emails, send_email, get_calendar, capture_test_failure
- **project:** create_project_folder, organize_downloads
- **prisma:** prisma_generate, prisma_migrate
- **agent:** supervised_session

---

## Role Policy (`apps/agent/src/role-policy.ts`)

| Role | Conjunto permitido |
|---|---|
| `desktop` | DESKTOP_ACTIONS (41 ações) — filesystem, git, system, apps, data, graphify, org, prisma |
| `server` | SERVER_ACTIONS (8 ações) — docker_ps/start/stop/logs, restart_api, run_command, get_qa_summary, get_data_quality |

Ações na whitelist mas fora do role são rejeitadas. Ex: `jarvis:docker_logs` não está no DESKTOP_ACTIONS.

**ADR-001:** `supervised_session` em DESKTOP_ACTIONS — não no SERVER.
**ADR-002:** `graphify_sync` adicionado ao DESKTOP_ACTIONS (estava na whitelist mas ausente do role).

---

## Protocolo dryRun

Ações de risco médio/alto implementam verificação prévia:

```ts
// Exemplo: file_write
if (payload.dryRun) {
  return { path, bytes: Buffer.byteLength(content), dryRun: true }
  // Não escreve — retorna metadados para inspeção
}
// Após aprovação, nova chamada com dryRun: false
```

Ações de risco alto requerem dryRun antes da execução real:
- `file_write`, `file_delete`, `git_commit`, `git_push`, `docker_stop`, `restart_api`, `prisma_migrate`

---

## Segurança de filesystem

```ts
// path-guard: bloqueia paths fora do safe root
const SAFE_ROOTS = ['~/Downloads', '~/Documents', '~/Desktop', '~/Projects', AGENT_PROJECT_ROOT]

// path.relative() — nunca startsWith()
const rel = path.relative(safeRoot, resolved)
if (rel.startsWith('..')) throw new Error('Path traversal não permitido')

// file_read: max 500KB, apenas text extensions
// file_write: max 200KB, bloqueia .env/.pem/.key
```

---

## Autenticação

- API Token no header `Authorization: Bearer <AGENT_TOKEN>` em todo request
- Token em `AGENT_TOKEN` no `.env` do agent
- `timingSafeEqual` no servidor — proteção contra timing attacks
- **Token JWT expira 4 de julho de 2026** — renovar via `POST /auth/login`

---

## Audit log

Toda execução de tarefa (sucesso ou falha) é persistida em `agent_audit_logs`:

```
taskId, actor, module, action, command (se run_command), risk,
dryRun, durationMs, status, hostname, workspace, targetRole, createdAt
```

Acesso: `GET /tasks/audit?action=&status=&actor=`

---

## MCP vs Agent — diferença de papel

| | MCP (Claude Code) | PC Agent (desktop) |
|---|---|---|
| **Ativa** | Claude Code (direto via MCP) | API → BullMQ → poll |
| **Latência** | Síncrono, resposta imediata | Assíncrono, até 3s delay |
| **Escopo** | Leitura de estado, criação de missões | Execução de ações locais |
| **Autenticação** | Token MCP / Bearer | AGENT_TOKEN |
| **Audit** | Não | Sim (`agent_audit_logs`) |

---

## Skills V2 → Agent

O V2 SkillEngineModule também despacha ações para o agent via BullMQ (mesma fila), mas com `source: 'v2-specialist'`:

```
StepExecutorService → SpecialistModule → SkillEngineService.dispatch()
  → POST /execution/dispatch (V1) com { action: 'jarvis:file_read', payload }
  → BullMQ → PC Agent → PATCH /tasks/:id com result
  → SkillEngineService recebe resultado e injeta no specialist loop
```

Timeout: 30s por tool call. Após 3 falhas consecutivas da mesma skill → `abortReason: skill_repeated_failure:<action>`.

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Agent desktop offline | Tasks ficam no BullMQ; specialist recebe timeout após 30s |
| run_command sem restrição | Está no DESKTOP_ACTIONS por necessidade; payload validado por whitelist |
| Token expirado silenciosamente | GET /infra/health retorna validade do JWT |
| graphify_sync fora do DESKTOP_ACTIONS | Corrigido em ADR-002 — estava na whitelist mas rejeitado por role |

---

## Critérios de pronto

- Toda nova ação → adicionada à whitelist.ts E ao role correto em role-policy.ts E documentada em agent-actions.md via `pnpm gen:catalog`
- Ações de risco médio/alto → dryRun testado antes de merge
- `pnpm gen:catalog` rodado após qualquer mudança em whitelist/role-policy
- Audit log verificado para toda ação executada em produção

---

## Próximos ajustes

- `jarvis:file_read` com paginação (`lines.start/end`) — researcher usa mas sem instrução explícita de paginação no specialist prompt
- Testes de segurança automatizados por ação de alto risco (`executor-safety.spec.ts`)
- Limite de rate no poll do agent (hoje sem limite — pode saturar Redis em debug)
