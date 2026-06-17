# api-v2 — Estado de congelamento

> ⚠️ **OBSOLETO (2026-06-16).** O executor foi **reativado**. O "Ciclo 2" (auto-chain de steps +
> WebSocket + Specialist dispatch) já tinha religado o loop na prática, e os endpoints `execute`
> **não** retornam mais `410 Gone` — estão vivos. Mantido só por histórico. Estado atual e roadmap
> de reativação: memória NORTE `[[project-rayzen-definition]]` e `.claude/plans/`.

> Decisão original: 2026-06-11 — Executor autônomo de missões congelado; Rayzen passa a ser cérebro de
> memória/QA que alimenta o Claude Code.

## Congelado (dormente — não desenvolver)

| Módulo | Caminho | Motivo |
|---|---|---|
| `mission` | `src/mission/` | Executor LLM nunca funcionou de forma confiável |
| `workflow` | `src/workflow/` | Depende do executor de missão |
| `mission-scheduler` | `src/mission-scheduler/` | Agendamento do executor congelado |
| `specialists` (runtime) | `src/specialists/` | Loop LLM de runtime step-by-step |
| `router` (planejamento) | `src/router/` | Roteamento de missões |

Endpoints congelados (retornam `410 Gone` — não executar):
- `POST /v2/missions/:id/execute`
- `POST /v2/workflows/missions/:id/execute`

## Vivo (mantido e em desenvolvimento)

| Módulo | Caminho | O que faz |
|---|---|---|
| `context-engine` | `src/context-engine/` | `rayzen_get_context` — cérebro da sessão Claude |
| `specialist-agent` | `src/specialist-agent/` | Perfis de especialistas (DB), dispatch de missões |
| `qa-engine` | `src/qa-engine/` | Pipelines determinísticos de QA |
| `approval-gates` | `src/approval-gates/` | Governança de aprovações |
| `cost-controller` | `src/cost-controller/` | Controle de custo LLM |
| `knowledge` | `src/knowledge/` | Base de conhecimento V2 |
| `memory` | `src/memory/` | Proxy de memória semântica para V1 |
| `core/v1-bridge` | `src/core/` | Leitura read-only do schema `public` (V1) |

## Importante

**Não parar o container `api-v2`.**  
`rayzen_get_context` (MCP do Claude Code) depende de `POST /v2/context/build` rodando neste container.
