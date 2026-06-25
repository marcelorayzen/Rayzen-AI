# ADR-002 — Adicionar `jarvis:graphify_sync` ao DESKTOP_ACTIONS

**Data:** 2026-06-25  
**Status:** Aceito  
**Contexto:** Fase 0-A (role-policy drift)

## Problema

`jarvis:graphify_sync` estava em `ALLOWED_ACTIONS` (whitelist.ts) e no `executor.ts`, mas ausente de `DESKTOP_ACTIONS` em `role-policy.ts`. Isso causava rejeição silenciosa quando o agent desktop tentava executar `graphify_sync` — o isActionAllowedForRole('desktop', 'jarvis:graphify_sync') retornava `false` mesmo a action estando na whitelist global.

## Decisão

Adicionar `jarvis:graphify_sync` ao `DESKTOP_ACTIONS` em `role-policy.ts`, imediatamente após `jarvis:run_graphify` (mesma categoria).

## Justificativa

- `graphify_sync` é exclusivamente uma operação desktop (acessa `graphify-out/graph.json` local, gitignored)
- `run_graphify` já estava corretamente em DESKTOP_ACTIONS; `graphify_sync` é a ação complementar de sync incremental
- Sem este fix, `graphify update .` disparado pelo agent nunca funcionava

## Consequência

Nenhuma regressão esperada. `graphify_sync` permanece bloqueado para role `server` (não foi adicionado a SERVER_ACTIONS).
