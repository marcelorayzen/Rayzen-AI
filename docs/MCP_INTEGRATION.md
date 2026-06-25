# MCP_INTEGRATION — Rayzen AI

> Integração Model Context Protocol entre Claude Code e o sistema Rayzen. Dois servidores MCP distintos com transports diferentes.

---

## Objetivo

Expor as capacidades do Rayzen como ferramentas MCP que Claude Code pode chamar diretamente — sem HTTP manual, com contexto de projeto resolvido automaticamente.

---

## Dois servidores MCP

| Servidor | Transport | Arquivo | Quando usar |
|---|---|---|---|
| MCP stdio | `stdio` | `apps/agent/src/mcp/rayzen-mcp.mjs` | Claude Code (IDE/CLI) — processo de longa duração |
| MCP HTTP | SSE/HTTP | `apps/agent/src/mcp/rayzen-mcp-http.mjs` | Clientes HTTP, debug, integrações externas |

---

## MCP stdio (`rayzen-mcp.mjs`)

### Processo de longa duração

O servidor stdio sobrevive a várias sessões do Claude Code. Config é relida a cada chamada se o `mtime` do `hook.config.mjs` mudou — evita "projectId não definido" após correção do config sem restart.

```js
// Recarrega config apenas quando arquivo muda (stat() síncrono)
if (cachedConfig && mtimeMs === cachedMtimeMs) return cachedConfig
const mod = await import(`${fileUrl}?t=${mtimeMs}`)  // invalida cache de import()
```

### Configuração (`.claude/settings.json`)

```json
{
  "mcpServers": {
    "rayzen": {
      "command": "node",
      "args": ["apps/agent/src/mcp/rayzen-mcp.mjs"],
      "env": {
        "AGENT_API_URL":    "http://192.168.0.174:3101",
        "AGENT_API_V2_URL": "http://192.168.0.174:3103",
        "AGENT_TOKEN":      "<JWT>"
      }
    }
  }
}
```

---

## Ferramentas MCP disponíveis

### Estado e contexto

| Tool | Descrição | Quando usar |
|---|---|---|
| `rayzen_get_resume` | Resumo comprimido do projeto (ProjectState + events recentes) | Início de sessão rápida |
| `rayzen_get_context` | Contexto cirúrgico por modo e query | Início de task complexa |
| `rayzen_get_state` | ProjectState completo estruturado | Quando precisa do estado detalhado |
| `rayzen_get_goal` | Meta ativa (Goal Graph) | Quando precisa do objetivo atual |
| `rayzen_get_wiki` | Página específica da wiki | Consulta de conhecimento documentado |
| `rayzen_search_memory` | Busca semântica em memória do projeto | Contexto de implementação específica |
| `rayzen_get_events` | Eventos recentes do projeto | Diagnóstico de atividade |

### Captura e síntese

| Tool | Descrição | Quando usar |
|---|---|---|
| `rayzen_add_event` | Registra decisão/problema/ideia manualmente | Após decisão significativa |
| `rayzen_capture_learning` | Indexa aprendizado no brain do projeto | Após descoberta importante |
| `rayzen_checkpoint` | Síntese completa: state + docs + Universe | Fim de sessão com código modificado |
| `rayzen_update_planning` | Atualiza milestones/nextSteps/backlog | Após mudança de escopo |

### Missões V2

| Tool | Descrição | Quando usar |
|---|---|---|
| `rayzen_agent_task` | Cria e executa missão V2 diretamente | Task estruturada multi-step |
| `rayzen_list_specialists` | Lista tipos de specialists disponíveis | Debug de inferência |

### Blueprints

| Tool | Descrição | Quando usar |
|---|---|---|
| `rayzen_blueprint_import` | Importa plano externo → wiki + brain + state + events | Iniciar novo projeto/feature |
| `rayzen_blueprint_preview` | Preview antes de importar | Validar estrutura do plano |
| `rayzen_blueprint_import_markdown` | Importa markdown direto | Planos sem estrutura formal |
| `rayzen_blueprint_create_feature_plan` | Cria feature plan estruturado | Nova feature com planejamento |

---

## Resolução de projectId

Prioridade nas ferramentas MCP:
1. `args.projectId` (passado explicitamente na chamada)
2. `cfg.projectId` do `hook.config.mjs`
3. `MCP_PROJECT_ID` env var

Se nenhum: erro `'projectId não definido. Configure projectId no hook.config.mjs...'`

---

## Protocolo de sessão (quando usar o quê)

O hook `UserPromptSubmit` injeta contexto automaticamente — **não é necessário chamar `rayzen_get_resume` em toda sessão**.

| Situação | Chamar |
|---|---|
| Início de task complexa (implementação / debugging) | `rayzen_get_context(mode, query)` |
| Decisão significativa tomada | `rayzen_add_event(type:'decision', content:'...')` |
| Fim de sessão com código real modificado | `rayzen_checkpoint()` |
| Backlog / milestones para atualizar | `rayzen_update_planning()` |
| Tool calls de leitura | **Não registrar** — não viram eventos |

---

## API bridge interna

O MCP stdio expõe dois clientes HTTP internos:

```js
api(method, path, body)    // → cfg.apiUrl (:3101 — V1)
apiV2(method, path, body)  // → cfg.apiV2Url (:3103 — V2)
```

Ambos usam o mesmo token JWT. `apiV2` deriva a URL automaticamente da V1 (porta 3101 → 3103) se `apiV2Url` não estiver explícito.

---

## Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| Processo stdio não reinicia após fix do config | projectId errado em toda sessão | Reload dinâmico por mtime do hook.config.mjs |
| `rayzen_get_context` chamado em toda tool call | Ruído no event log | Hook filtra `mcp__rayzen__rayzen_get*` |
| Token expirado no MCP | Toda tool falha com 401 | GET /infra/health retorna validade JWT |
| apiV2Url não configurado | Tools V2 apontam para porta errada | Derivação automática de porta 3103 como fallback |

---

## Critérios de pronto

- Toda nova ferramenta MCP → documentada neste arquivo com "quando usar"
- `rayzen_checkpoint` executado com sucesso ao final de toda sessão com código modificado
- `rayzen_get_context` retorna contexto em < 2s (dentro do budget do hook)
- projectId resolvido automaticamente para qualquer projeto com hook.config.mjs correto

---

## Próximos ajustes

- `rayzen_run_benchmark` — trigger manual do benchmark via MCP
- `rayzen_get_missions` — listar missões pendentes com status
- Health check integrado ao MCP (`rayzen_health`) para diagnóstico rápido
- Documentação de cada tool com schema de input/output (hoje implícita no código)
