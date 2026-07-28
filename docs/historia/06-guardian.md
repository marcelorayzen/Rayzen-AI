---
capitulo: 6
titulo: "Guardian — Vigilância Proativa de Código"
periodo: "2026-06-26 a 2026-06-30"
fontes:
  commits: ["2928e46", "e1fa2c7", "76eaf44", "673ba08", "c7a7efa", "37bb1a6", "55e5ea6", "fe0b2c3", "a310122", "9e22056", "8419b52", "f08803c", "14a4a49"]
  docs: ["docs/GUARDIAN.md", "docs/adr/ADR-003-role-policy-guardian-browse.md"]
  memory: ["memory/project_role_policy_drift.md"]
confianca: "alta"
---

# Capítulo 6 — Guardian

Depois de um mês inteiro descobrindo bugs por tentativa e erro em produção (capítulo 5), o Rayzen constrói, em cinco dias, um sistema cujo único propósito é evitar que isso se repita: detectar risco *antes* do push, não depois.

## Um sistema construído em um único dia

Em **2026-06-26**, quatro "fases" do Guardian nascem em sequência, todas no mesmo dia:

- `2928e46` — `GuardianModule`: `TestGapDetectorService`, `RiskScorerService`, service e controller.
- `e1fa2c7` — migration `guardian_reports`, no schema `v2`.
- `76eaf44` — cliente no agent, context hook e whitelist.
- `673ba08` — fase 2: pre-push hook + notificação por webhook.
- `c7a7efa` — fase 3: endpoint de histórico + página `/guardian` na web.
- `37bb1a6` — fase 4: MCP tools + `docs/GUARDIAN.md`.

`docs/GUARDIAN.md` descreve o mecanismo completo:

```
workspace-watcher detecta mudança (a cada 30s)
  → POST /v2/guardian/analyze
  → TestGapDetectorService: mapeia arquivo → spec esperada
  → RiskScorerService: calcula score aditivo
  → Persiste GuardianReport no Postgres (schema v2)
  → writeCache(tmpdir/rayzen-guardian-{hash}.json, TTL 10min)
  → rayzen-context-hook lê cache sincronamente (<5ms)
  → Claude Code abre a sessão já com contexto Guardian
```

O score é aditivo e determinístico — sem LLM na hora de classificar risco. Padrões críticos (`whitelist.ts`, `deploy.sh`, `prisma/schema.prisma`) valem +8 sozinhos; padrões de alto impacto (`/auth/`, `/security/`, `/payment/`, `/role/`, `/gateway/`, `main.ts`, migrações Prisma) valem +1.5 cada. Os quatro níveis resultantes:

| Level | Score | Deploy | Comportamento |
|---|---|---|---|
| low | < 3 | safe | silencioso |
| medium | 3–5.9 | review | contexto injetado |
| high | 6–7.9 | review | contexto injetado + log |
| critical | ≥ 8 | block | contexto + pré-push bloqueado |

O pre-push hook (`pnpm guardian:install-hooks`) bloqueia `git push` de verdade quando `riskLevel=critical` e o report não foi overridden — a única barreira automática e não-opcional que o projeto impõe sobre si mesmo antes de um push chegar ao remoto.

No mesmo dia 06-26, ainda: dois fixes de correção rápida (`daf57cc` — cache escrito no tmpdir do agent, não só no container; `c4ed609` — pre-push hook lendo `apps/agent/.env` além do `.env` raiz) e testes formais para `GuardianService`/`StepExecutorService`/`WorkflowEngineService` (`590fc4e`, `c3b1c14`) — o Guardian nasceu sendo o primeiro sistema do projeto a se testar a si mesmo no mesmo dia em que foi construído, não dias depois.

## O fechamento da Fase 0-A — e um terceiro ADR

A construção do Guardian expõe, de imediato, o mesmo padrão de drift que o capítulo 5 já vinha rastreando (ADR-001, ADR-002): `guardian_analyze`, recém-adicionado ao Guardian Module, estava presente em `DESKTOP_ACTIONS` no role-policy mas ausente do `ACTION_ROLE` no `ExecutionService` — despachado sem `targetRole`, qualquer agent online podia recebê-lo. Auditando mais a fundo, um segundo gap aparece: `browse_and_screenshot`, presente na whitelist "desde o início" (segundo o próprio ADR), nunca tinha sido registrado em nenhum dos dois mapas de papel.

**ADR-003** (06-27) fecha os dois gaps e encerra formalmente a Fase 0-A, cross-referenciando ADR-001 e ADR-002 como parte da mesma auditoria. O commit que sincroniza os três arquivos envolvidos — `execution.service.ts`, `role-policy.ts`, `skill-registry.ts` — é `55e5ea6`. `memory/project_role_policy_drift.md` registra o resultado da regeneração do catálogo: **45 ações, 0 warnings**, e formaliza a regra que evita a recorrência: toda ação desktop nova precisa ser adicionada, na mesma sessão, a `ACTION_ROLE`, `DESKTOP_ACTIONS` e `skill-registry.ts`, seguido de `pnpm gen:catalog`.

O padrão de fundo dos três ADRs é sempre o mesmo: uma ação existe em uma whitelist mas não na outra, e a falha resultante é **silenciosa** — nenhum erro, apenas uma ação que nunca chega a executar, ou que executa no agente errado. É exatamente o tipo de risco que o próprio Guardian, dias antes, tinha sido construído para expor antes do push — e aqui ele se prova ao encontrar drift na sua própria camada de segurança.

## Endurecimento — "Blueprint v1.1" (06-29/30)

Três dias depois do nascimento, o Guardian ganha uma segunda rodada de profundidade, batizada nos commits como itens de um "Blueprint v1.1":

- `fe0b2c3` (06-29) — risk score determinístico, detecção discriminada de gaps de teste, gate de review.
- `a310122` (06-29, item 6) — 6 subagentes read-only especializados (arquitetura, auth/MCP, qualidade de contexto, sincronia de docs, risco do Guardian, gaps de teste — os mesmos que hoje aparecem como tipos de agente disponíveis neste próprio ambiente de trabalho).
- `9e22056` (06-29, item 7) — 6 skills Guardian no skill-engine.
- `8419b52` (06-30, item 8) — Plan Mode com entrevista adaptada ao `riskLevel` da mudança.
- `f08803c` (06-30, item 9) — "Ultraplan", revisão com 6 perspectivas paralelas.
- `14a4a49` (06-30, item 10) — Policy Synthesizer com exceções formalizadas.

O padrão de nomeação por item numerado ("item 6", "item 7"...) sugere que o "Blueprint v1.1" foi planejado como uma lista fechada antes de ser executado — diferente do resto da V2, construída em ondas mais orgânicas, o Guardian avançado teve um roadmap explícito seguido item por item, dois dias corridos.

## O que o Guardian deixou

O sistema descrito aqui é o mesmo que injeta o bloco "Políticas ativas" e o contexto de missão ativa vistos no início de cada sessão de Claude Code sobre este repositório — a "Missão ativa: Stress Test v3" e as políticas `deployment_requires_review`/`low_confidence_knowledge`/`memory_requires_source` citadas ao longo deste próprio livro nasceram dessa mesma arquitetura, formalizada nesta semana de junho. O capítulo 7 mostra o que aconteceu quando essa vigilância recém-construída precisou lidar com incidentes reais de produção, uma semana depois.
