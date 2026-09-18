# ADR-004 — Role Policy: get_qa_summary e get_data_quality são SERVER

**Status:** aceita
**Data:** 2026-08-02

## Contexto

Mesma classe de bug do ADR-001/002/003: ações presentes em `whitelist.ts` e `role-policy.ts`, mas ausentes do `ACTION_ROLE` em `execution.service.ts` (dispatch V1). `get_qa_summary` e `get_data_quality` chegaram a 43/45 entradas em `ACTION_ROLE` sem essas duas.

Diferente dos casos anteriores, aqui a ambiguidade era real, não um simples esquecimento: `role-policy.ts` já listava as duas ações em **ambos** `DESKTOP_ACTIONS` e `SERVER_ACTIONS` — o único par dual-role do sistema. `skill-registry.ts` (V2) também marcava `runtime: 'agent-desktop'` para as duas, reforçando a ambiguidade.

Consequência concreta do gap: em `dispatch()`, quando `ACTION_ROLE[action]` é `undefined`, o guard de fail-fast de heartbeat é pulado inteiro e a task é enfileirada sem `targetRole`. `AgentBridgeService.getPending()`/`claimTask()` usam o filtro `!t.targetRole || !role || t.targetRole === role` — uma task sem `targetRole` é reivindicável por **qualquer** agent (desktop ou server) que fizer poll primeiro. Não é determinístico, é uma race.

## Decisão

Resolver a ambiguidade para **SERVER**, não DESKTOP:

1. `apps/agent/src/actions/get-qa-summary.ts` e `get-data-quality.ts` são clientes HTTP puros contra a própria API (`AGENT_API_URL`) — zero dependência de SO/GUI/browser, ao contrário de ações genuinamente desktop (`screenshot`, `clipboard_*`, `browse_and_screenshot`).
2. O agent server já precisa estar online 24/7 para as outras ações server-only (`docker_ps`, `restart_api`, etc.) — não introduz nova suposição operacional.
3. O mapa de risco separado do V1 (`orchestrator.service.ts`) já classifica as duas como server-flavored, `risk: 'low'`.
4. `runtime` em `skill-registry.ts` é só metadado — `SkillEngineService.dispatchToAgent()` nunca envia `runtime` no POST para `/execution/dispatch`; o roteamento real é 100% controlado pelo `ACTION_ROLE` do V1. Corrigir a metadata para `'agent-server'` é seguro, sem mudança de comportamento.

Mudanças:

- Adicionar ao `ACTION_ROLE` em `execution.service.ts`:
  - `get_qa_summary: 'server'`
  - `get_data_quality: 'server'`
- Remover `'jarvis:get_qa_summary'` e `'jarvis:get_data_quality'` de `DESKTOP_ACTIONS` em `role-policy.ts` (mantidas só em `SERVER_ACTIONS`) — o dual-listing era a origem da ambiguidade.
- Corrigir `runtime: 'agent-desktop'` → `'agent-server'` para as duas em `skill-registry.ts`.
- Gravar `policySource` (`'ACTION_ROLE_MAP'` ou `'UNRESOLVED_NO_ROLE'`) no evento de dispatch (`execution.service.ts`, `metadata` do `EventService.create`) — sinal forense em runtime caso uma ação futura entre na whitelist sem `ACTION_ROLE`, antes mesmo do CI pegar.
- Script `scripts/check-role-drift.mjs` (`pnpm check:role-drift`, rodado no job `typecheck` do CI): garante que toda ação da whitelist tem exatamente uma entrada em `ACTION_ROLE`, e que o role atribuído é aceito pelo `role-policy.ts` correspondente. Estrutural — previne essa classe de bug para qualquer ação futura, não só estas duas.

## Consequências

- Tasks `get_qa_summary`/`get_data_quality` despachadas pelo V1 agora só vão para o agent server. Se o server estiver offline, falha imediatamente com "Agent server offline" em vez de ficar na race ou estourar o timeout de 30s sem explicação.
- `ACTION_ROLE` chega a 45 entradas, batendo 1:1 com a whitelist.
- Diferente do que ADR-003 registrou, `pnpm gen:catalog` **não** regenera nada relacionado a `ACTION_ROLE` — `gen-agent-catalog.mjs` só lê `whitelist.ts` + `skill-registry.ts`, sem nenhuma consciência de `execution.service.ts`. Rodá-lo aqui só reflete a correção de metadata do item 3 acima, não o roteamento em si. Quem previne drift de `ACTION_ROLE` daqui pra frente é `check-role-drift.mjs`.

## Relação com ADRs anteriores

- ADR-001: `supervised_session` e `run_graphify` → DESKTOP
- ADR-002: `graphify_sync` → DESKTOP
- ADR-003: `guardian_analyze`, `browse_and_screenshot` → DESKTOP
- ADR-004 (este): `get_qa_summary`, `get_data_quality` → SERVER — primeiro caso resolvido para SERVER, e primeiro caso envolvendo remoção de um dual-listing em `role-policy.ts`.
