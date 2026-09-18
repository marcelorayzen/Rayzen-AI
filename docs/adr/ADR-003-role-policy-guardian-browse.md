# ADR-003 — Role Policy: guardian_analyze e browse_and_screenshot são DESKTOP-only

**Status:** aceita  
**Data:** 2026-06-27

## Contexto

Auditoria da Fase 0-A revelou dois gaps adicionais entre `execution.service.ts` (dispatch V1) e `role-policy.ts` (guard do agent):

1. **`guardian_analyze`** — adicionado no Guardian Module (2026-06-26). Presente em `DESKTOP_ACTIONS` no role-policy, mas ausente do `ACTION_ROLE` no ExecutionService → despachado sem `targetRole`, qualquer agent online podia receber.

2. **`browse_and_screenshot`** — presente em `whitelist.ts` e `executor.ts` desde o início, mas ausente tanto do `ACTION_ROLE` quanto do `DESKTOP_ACTIONS` no role-policy. Depende de Puppeteer/browser GUI — definitivamente desktop-only.

## Decisão

Adicionar ao `ACTION_ROLE` em `execution.service.ts`:
- `guardian_analyze: 'desktop'`
- `browse_and_screenshot: 'desktop'`

Adicionar ao `DESKTOP_ACTIONS` em `role-policy.ts`:
- `'jarvis:browse_and_screenshot'`

## Consequências

- Tasks `guardian_analyze` e `browse_and_screenshot` despachadas pelo V1 agora só irão para o agent desktop.
- Se o desktop estiver offline, a chamada falha imediatamente com erro claro ("Agent desktop offline") em vez de ser pega pelo server agent e falhar silenciosamente.
- `docs/agent-actions.md` regenerado via `pnpm gen:catalog`.

## Relação com ADRs anteriores

- ADR-001: `supervised_session` e `run_graphify` → DESKTOP
- ADR-002: `graphify_sync` → DESKTOP  
- ADR-003 (este): `guardian_analyze`, `browse_and_screenshot` → DESKTOP
