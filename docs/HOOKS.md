# HOOKS — Rayzen AI

> Captura passiva de atividade de desenvolvimento. Dois hooks distintos com responsabilidades complementares.

---

## Objetivo

Registrar automaticamente o que acontece no workspace (edições, execuções, paradas) e injetar contexto cirúrgico antes de cada prompt ao Claude — sem ação manual do usuário.

---

## Arquivos

```
apps/agent/src/hooks/
  rayzen-hook.mjs          # PostToolUse + Stop → POST /events/cli
  rayzen-context-hook.mjs  # UserPromptSubmit → additionalContext (context-engine)
  hook.config.mjs          # GITIGNORED — apiUrl, apiToken, projectId (nunca fixar projectId)
```

---

## Hook 1 — PostToolUse + Stop (`rayzen-hook.mjs`)

### Fluxo

```
Claude Code executa tool
  → PostToolUse dispara rayzen-hook.mjs (via stdin JSON)
  → Filtra ferramentas sem sinal (Read, Glob, TodoWrite, WebFetch, mcp__rayzen__rayzen_get*)
  → resolveProjectId() → git remote → /projects?repoSlug= → cache 5 min
  → getGitContext() → branch, commitHash, changedFiles (top 10)
  → inferModulesFromPaths() → ex: "api:memory", "web:components"
  → Bash/PowerShell: substitui command (ruído) por description (sinal)
  → Edit/Write: lê até 8k chars do arquivo para indexação semântica
  → POST /events/cli (payload enriquecido)
  → POST /data-catalog/assets/auto-register (se Edit/Write com projectId)
  → Stop event: persiste último turn do assistente em POST /v2/chat/turns
```

### Ferramentas filtradas (sem sinal semântico)

```js
const IGNORED_TOOLS = new Set([
  'TodoWrite', 'TodoRead', 'ListMcpResourcesTool',
  'ToolSearch', 'Agent', 'ScheduleWakeup',
  'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion',
  'Read', 'Glob',        // exploração, não mudança
  'WebFetch', 'WebSearch',
])
// + tools mcp__rayzen__rayzen_get* e rayzen_search*
```

### Contrato de evento (`POST /events/cli`)

```json
{
  "tool_name": "Edit",
  "tool_input": { "file_path": "apps/api/src/...", "description": "..." },
  "projectId": "uuid",
  "git": { "branch": "main", "commitHash": "a1b2c3d", "changedFiles": ["..."] },
  "graphify": { "modules": ["api:memory"] },
  "fileContent": "...até 8k chars..."
}
```

### Resolução de projectId

Prioridade:
1. `cfg.projectId` (hook.config.mjs) — **nunca usar** (global a todos os projetos)
2. Cache `rayzen-slug-cache.json` (TTL 5 min, stale-while-error)
3. `GET /projects?repoSlug=<git-remote-name>`

Falha de resolução: `exit 2` + aviso no stderr (throttle 1h).

### Timing file

`consumeTimingFile()` lê `rayzen-ctx-timing.json` (escrito pelo hook UserPromptSubmit) e emite evento separado `kind: hook_timing` com `hookDurationMs`, `contextEngineDurationMs`, `cacheHit`.

---

## Hook 2 — UserPromptSubmit (`rayzen-context-hook.mjs`)

### Fluxo

```
Usuário envia prompt
  → UserPromptSubmit dispara rayzen-context-hook.mjs
  → extractPromptText() → lê stdin (timeout 800ms)
  → classifyIntent() → debugging | architecture | review | study | implementation
  → extractQuery() → primeiros 200 chars sem code fences
  → resolveProjectId() → mesma lógica (git remote + slug cache)
  → cacheKey = MD5(projectId:mode:query)
  → cache hit → retorna contexto salvo (TTL 3 min)
  → cache miss → POST /v2/context/build (timeout 2.2s)
  → fallback → GET /projects/:id/state (timeout 1.5s)
  → Paralelo: GET /v2/missions/next-pending (timeout 1s)
  → Formata contexto com seções por modo
  → console.log(JSON.stringify({ hookSpecificOutput: { additionalContext: ... } }))
  → writeTimingFile() para coleta de latência
```

### Classificação de intenção

| Intenção | Palavras-chave |
|---|---|
| `debugging` | erro, quebrou, não funciona, falhou, bug, exception, crash, 500, 401, 404 |
| `architecture` | arquitetura, design, estrutura, plano, reorganiz, decisão |
| `review` | review, revisar, checar, analis, auditar, verificar |
| `study` | como funciona, explica, o que é, entender, estudar, aprender |
| `implementation` | (default) |

### Budget de tempo

| Etapa | Timeout |
|---|---|
| stdin read | 800ms |
| resolveProjectId | 1.5s |
| POST /v2/context/build | 2.2s |
| GET /projects/:id/state (fallback) | 1.5s |
| GET /v2/missions/next-pending | 1.0s |
| **Total máximo** | ~2.5s |

### Seções do contexto por modo (`ContextEngineService`)

| Modo | Seções incluídas |
|---|---|
| `implementation` | project_state, planning, policy_constraints, memory_relevant, recent_events, approval_gates |
| `debugging` | project_state, blockers, memory_relevant, recent_events, knowledge_graph, approval_gates |
| `review` | project_state, active_goal, memory_relevant, planning, knowledge_graph |
| `architecture` | project_state, active_goal, planning, blockers, policy_constraints, knowledge_graph |
| `study` | project_state, memory_relevant, recent_events, knowledge_graph |

---

## Configuração (`hook.config.mjs`)

```js
// apps/agent/src/hooks/hook.config.mjs — GITIGNORED
export default {
  apiUrl:   'http://192.168.0.174:3101',
  apiV2Url: 'http://192.168.0.174:3103',
  apiToken: '<JWT>',
  // NÃO adicionar projectId aqui — arquivo é global a todos os projetos
}
```

**Token JWT expira 4 de julho de 2026.** Renovar via `POST /auth/login`.

---

## Configuração no Claude Code (`settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node apps/agent/src/hooks/rayzen-hook.mjs" }] }],
    "Stop":        [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node apps/agent/src/hooks/rayzen-hook.mjs" }] }],
    "UserPromptSubmit": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node apps/agent/src/hooks/rayzen-context-hook.mjs" }] }]
  }
}
```

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `projectId` fixado no hook.config.mjs | **Bloqueado** — arquivo global; usar PATCH /projects/:id { repoSlug } |
| repoSlug não resolvido | exit 2 + aviso throttle 1h; diagnosticar com GET /events/hook/health |
| Context hook > 2.5s | Fallback para /projects/:id/state; Claude segue sem contexto cirúrgico |
| Token expirado | Hook falha silenciosamente (exit 0); renovar com POST /auth/login |
| Hook indexa arquivo .sql de manutenção | Filtrar por extensão em INDEXABLE_EXTENSIONS ou `.rayzenignore` |

---

## Critérios de pronto

- Cada Edit em código fonte → evento registrado com `tool_name`, `git.branch`, `git.commitHash`
- Context injetado em < 2.5s (p99)
- Modo classificado corretamente (validado via Langfuse timing events)
- repoSlug resolvido sem intervenção manual para qualquer projeto com remote configurado

---

## Próximos ajustes

- Workspace watcher agnostico para capturar edits feitas fora do Claude Code (VS Code, Codex, terminal)
- Benchmark de latência por seção do context-engine (qual seção atrasa mais)
- `.rayzenignore` para filtrar arquivos de manutenção (.sql, .bak) da indexação automática
