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

**O diretório vem do `cwd` do PAYLOAD, não de `process.cwd()`** *(2026-09-06)*. A documentação
do Claude Code garante o campo em todo evento, e ele é o que acompanha o Claude ao entrar numa
worktree ou depois de um `cd`. Antes o hook usava o diretório do próprio processo, e o `Stop`
falhou duas vezes com slug `"?"` — lista de candidatos vazia, ou seja, **evento de fim de sessão
nascendo órfão**.

**O nome do repositório é cacheado por diretório** (`rayzen-repo-name-cache.json`, TTL 1h).
Motivo medido: o `PostToolUse` dispara em toda ferramenta, e cada disparo gastava até dois
`execSync` de git — **1739 ms na primeira resolução**, contra um timeout de 2000 ms. 87% do
orçamento consumido com a máquina ociosa; qualquer carga estourava. Com cache: 3–5 ms.

> Quando o git falha, a entrada **vencida ainda é servida**. O modo de falha é git lento, não
> repositório trocado — nome levemente velho ainda resolve o projeto certo, ausência de nome gera
> órfão. É o oposto do que se faz com cache de *resultado* (ver a sonda de LLM, onde falha por
> silêncio **não** entra no cache).

### Timing file

`consumeTimingFile()` lê `rayzen-ctx-timing.json` (escrito pelo hook UserPromptSubmit) e emite evento separado `kind: hook_timing` com `hookDurationMs`, `contextEngineDurationMs`, `cacheHit`.

---

## Hook 2 — UserPromptSubmit (`rayzen-context-hook.mjs`)

Dispara antes de cada prompt: classifica a intenção (debugging/architecture/review/study/implementation), resolve o projeto e injeta contexto cirúrgico (`additionalContext`) construído pelo `ContextEngineService`.

### Bloco de identidade *(2026-09-06)*

Antes de qualquer seção semântica, o hook emite **como endereçar o projeto**:

```
### Rayzen — identidade
projectId: `7690370b-…`
repoSlug: `rayzen-ai-private`
api V1: https://api.rayzen.com.br
api V2: https://api.rayzen.com.br/v2
```

O hook **já resolvia** o `projectId` para buscar tudo que injeta, e o descartava. Tudo o que ia
para o prompt era semântico — objetivo, memória, eventos, políticas — e nada dizia o endereço.
Medido numa sessão real: **~10 chamadas gastas só redescobrindo** UUID do projeto, rota da meta
(depois de um 404), formato de `successCriteria`, que `memory_meta` mora em `v2` e não em
`public`, e nomes de coluna de `approval_gates`.

Três detalhes deliberados:

- **Sai nos dois caminhos de montagem** (cache-hit e busca fresca). Só num deles faria a sessão
  saber o endereço de forma intermitente, que é pior que não saber — você para de conferir.
- **Publica o `repoSlug` REGISTRADO**, não a grafia que resolveu. O diretório `rayzen-ai` resolve
  um projeto cujo slug é `rayzen-ai-private`; publicar a candidata afirmaria um slug que o Rayzen
  não conhece.
- **O token nunca entra** — só onde ele mora. Segredo em contexto injetado vira segredo em
  transcript e em log.

### Aviso de agent parado *(2026-09-06)*

A mesma identidade carrega uma linha a mais **quando o agent desktop não está de pé**:

```
⚠️ agent desktop **sem sinal há 28h** — watcher, Guardian e invariantes não estão rodando.
```

A ausência do agent era **completamente silenciosa**. Os hooks do Claude Code continuam
funcionando (rodam do `src`, não dependem do agent), o painel segue verde, e o contexto injetado
sai igual: os blocos do Guardian e dos invariantes simplesmente não aparecem — que é o que também
acontece quando está tudo bem. Medido em 06/09: **28h sem batimento** depois de um reboot,
descoberto por acaso.

O sinal é um arquivo local (`rayzen-agent-vivo.json` no tmpdir) que o `workspace-watcher` reescreve
a cada tick, **antes** do scan e fora do `then/catch`: a pergunta é "o processo está rodando", não
"o scan deu certo" — quem conta a segunda história é o `beatGuardian({ ok:false })`. Amarrar as
duas faria um watcher com defeito parecer um watcher desligado.

> **Por que arquivo local e não o `system_heartbeats`.** O servidor já sabe, mas o hook tem
> orçamento de ~2,5s e já gasta três chamadas HTTP. E as perguntas são diferentes: o batimento
> responde *"o agent deu notícia?"* do ponto de vista do servidor, que não distingue agent parado
> de rede caída; o arquivo responde *"o agent está rodando NESTA máquina, agora"*.

Calado abaixo de 5 minutos de tolerância, pelo mesmo motivo dos invariantes: aviso em todo prompt
treina a ignorar o aviso.

> Ver `docs/CONTEXT_PIPELINE.md` para o fluxo completo do Hook 2 (UserPromptSubmit) — classificação de intenção, budget de timeout por etapa, cache e seções de contexto por modo.

---

## Configuração (`hook.config.mjs`)

```js
// apps/agent/src/hooks/hook.config.mjs — GITIGNORED
export default {
  // Pelo dominio, NAO pelas portas: api/api-v2/web publicam so em 127.0.0.1 e
  // sao inalcancaveis fora do servidor. Quem roteia por host e o Caddy.
  apiUrl:   'https://api.rayzen.com.br',
  apiV2Url: 'https://api.rayzen.com.br',
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
