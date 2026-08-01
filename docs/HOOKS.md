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

Dispara antes de cada prompt: classifica a intenção (debugging/architecture/review/study/implementation), resolve o projeto e injeta contexto cirúrgico (`additionalContext`) construído pelo `ContextEngineService`.

> Ver `docs/CONTEXT_PIPELINE.md` para o fluxo completo do Hook 2 (UserPromptSubmit) — classificação de intenção, budget de timeout por etapa, cache e seções de contexto por modo.

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

**Token JWT expira periodicamente** (sem rotação automática) — renove via `POST /auth/login` e atualize `apiToken` neste arquivo + `AGENT_TOKEN` no `.env`.

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
