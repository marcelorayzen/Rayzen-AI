# ADR-001 — Role Policy: supervised_session e run_graphify são DESKTOP-only

**Status:** aceita  
**Data:** 2026-06-23

## Contexto

`execution.service.ts` mantinha um mapa `ACTION_ROLE` que apontava `supervised_session: 'server'`. Porém `role-policy.ts` (o guardião do agent) não listava `jarvis:supervised_session` em `SERVER_ACTIONS`, causando rejeição silenciosa toda vez que o sistema tentasse despachar essa ação para o server agent.

Da mesma forma, `jarvis:run_graphify` sempre foi DESKTOP-only (listado apenas em `DESKTOP_ACTIONS`) mas não havia registro formal da decisão.

## Decisão

`supervised_session` roda exclusivamente no **desktop agent** porque:
- Executa uma sessão autônoma de Claude Code (`supervisedSession(...)` no executor)
- Claude Code está instalado na máquina de desenvolvimento (PC de trabalho), não no servidor Ubuntu
- O server agent não tem acesso à área de trabalho nem ao ambiente de desenvolvimento

`run_graphify` permanece DESKTOP-only pelos mesmos motivos — o índice graphify e o CLI vivem no repositório local.

### Mudanças aplicadas

| Arquivo | Linha | Antes | Depois |
|---------|-------|-------|--------|
| `apps/agent/src/role-policy.ts` | DESKTOP_ACTIONS | ❌ ausente | ✅ `'jarvis:supervised_session'` adicionado |
| `apps/api/src/modules/execution/execution.service.ts` | ACTION_ROLE | `supervised_session: 'server'` | `supervised_session: 'desktop'` |

## Consequências

- `POST /tasks` com action `supervised_session` → roteado para desktop agent (correto)
- Se desktop agent estiver offline → falha rápida via `AgentHeartbeatService` com mensagem clara
- Server agent não recebe mais essa ação → zero rejeições silenciosas
- `pnpm gen:catalog` regenera `docs/agent-actions.md` refletindo a correção
