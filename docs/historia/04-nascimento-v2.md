---
capitulo: 4
titulo: "Nascimento da V2 — Mission Oriented Engineering System"
periodo: "2026-05-29 a 2026-05-31"
fontes:
  commits: ["3410e71", "4d6c200", "3335fd3", "eb8b3f0", "285a423", "4f1f66a", "4ce318b", "3f78261", "cb183ce", "2cbc079", "0b84245", "9b9df8b", "ea31c6b", "5af051b"]
  docs: ["blueprints/VISION.md", "blueprints/README.md"]
  memory: ["memory/project_specialist_architecture.md"]
confianca: "alta"
---

# Capítulo 4 — Nascimento da V2

Se o capítulo 3 mostrou a V1 construindo, sem nomear, protótipos do que a V2 formalizaria, este capítulo é a formalização em si — e ela aconteceu rápido: **scaffold completo em 05-29, ~12 engines funcionais até o fim de 05-31**. Três dias.

## O vision statement

`blueprints/VISION.md` registra a virada de forma explícita:

> "O Rayzen AI deixa de ser um assistente conversacional e passa a ser um **sistema operacional orientado a missões**, capaz de compreender projetos, preservar conhecimento, executar fluxos complexos, validar resultados e coordenar especialistas sob demanda com controle de custo, contexto e qualidade."

O princípio central, resumido em duas linhas que aparecem em toda a documentação subsequente do V2:

```
V1:  Usuário → Pergunta → Resposta
V2:  Usuário → Objetivo → Missão → Execução → Validação → Entrega
```

"A IA deixa de ser o centro do sistema. O centro passa a ser a missão." A tabela comparativa do VISION.md deixa a mudança de postura ainda mais concreta: de "responde perguntas" para "executa objetivos"; de "contexto temporário" para "conhecimento persistente"; de "um agente genérico" para "especialistas sob demanda"; de "sem controle de custo" para "budget enforcement por missão".

Os blueprints (24 documentos, `blueprints/001` a `blueprints/024`) não têm data de motivação registrada — nasceram como arquitetura aspiracional antes de qualquer linha de código da V2 existir, commitados no mesmo dia 05-29 (`3410e71`, `eed7403`, `d9be558`, `62ec7e9`, `9bc4490`) junto com o scaffold real.

## Fase 1 — a fundação (05-29)

O primeiro commit de código é `4d6c200` — *"scaffold completo do apps/api-v2 — Mission Engine fase 1"*. No mesmo dia, `3335fd3` já entrega o Router (`POST /v2/route` classificando e criando missões) e o `LlmService`. Note o padrão: a V2 nasceu com schema Prisma isolado desde o primeiro commit (`3d5cbc2`, `efccdf8` movendo o client gerado para fora de `src/`) — a regra "schema `v2` isolado, V1BridgeService só lê `public`, nunca escreve" não foi uma decisão posterior, foi condição de nascimento.

## Fase 2 — inteligência, em um único dia (05-30)

No dia seguinte, seis motores nascem em sequência, todos com o mesmo padrão de commit `feat(v2): Fase N`:

- `eb8b3f0` — Memory Engine, como camada de lifecycle sobre o storage que já existia na V1
- `285a423` — AI Router + Context Engine + Skill Engine
- `4f1f66a` / `4ce318b` — Knowledge Engine + Project Memory, com `KnowledgeGraphBuilder` (`POST /v2/knowledge/build/:projectId`)
- `3f78261` — Approval Gates + Dynamic Workflows + QA Engine + Documentation Engine
- `2cbc079` — Cost Controller + Observability + Resource Manager + Mission Scheduler
- `cb183ce` — Specialists (Specialist Factory sob demanda)
- `0b84245` — Vault Engine + Telegram Agent

É o dia mais denso de todo o projeto em termos de superfície arquitetural nova. Nenhum desses motores ficou como protótipo descartável — todos aparecem, meses depois, em `docs/architecture.md` como módulos ativos da V2.

No mesmo 05-30, dois fixes menores mas reveladores: `3b80639` — "resolução robusta de projeto por slug — corrige eventos não vinculados" — primeira tentativa de resolver o problema de `repoSlug` que só seria diagnosticado por completo em 05-30 mais tarde (ver capítulo 3) e definitivamente em 06-17; e `21acd5f` (A-009) — scanner de dados sensíveis com inventário gerado, a origem direta de `docs/security/data-inventory.md` e do comando `pnpm scan:secrets` que existe até hoje.

## Fase 3 — a UI alcança o motor (05-31)

Em 05-31: Context Broker entra no fluxo de conversa, junto com o Conversation Pipeline e o Work Panel (`9b9df8b`); painel de Missões V2 na web (`ea31c6b`); loop de aprovação por etapa no supervised-session (`25d6fa7`); geração automática de documentação ao concluir uma missão (`5878bc3`). Fechando o dia, dois commits de limpeza que valem menção: remoção do Prisma client gerado do git (-71MB, `e4a7ad7`) e o primeiro corte real de `CLAUDE.md` (227 linhas → ~95, movendo tabelas de referência para `docs/`, commit `5af051b`) — o mesmo princípio de "documentação como referência, não repetição" que estrutura este próprio livro.

## Duas camadas de Specialist — um detalhe que quase virou confusão

`memory/project_specialist_architecture.md` registra algo que só ficaria claro semanas depois, durante o "Ciclo 2 Peça 1": a V2 acabou com **duas** camadas de "specialist" que fazem coisas diferentes e não devem ser confundidas.

- **`SpecialistModule`** (`apps/api-v2/src/specialists/`) — motor de execução: spawn, loop iterativo, controle de custo. Tipos hardcoded (`coder | reviewer | tester | architect | researcher | debugger`) em `specialist-registry.ts`.
- **`SpecialistAgentModule`** (`apps/api-v2/src/specialist-agent/`) — perfis persistentes em banco (`backend | qa | infra | general`) usados no momento de *planejar* uma missão, não de executá-la.

O fluxo integrado: `POST /v2/route` cria a missão → `SpecialistAgentService.findForTask()` escolhe um perfil de banco para enriquecer o prompt de planejamento → quando um step é de fato executado, `SpecialistService.spawn()` decide o tipo de execução runtime. Ou, como registrado na própria memória: "separação clara — quem planeja (perfil DB) vs. quem executa (loop runtime)". Essa distinção — sutil o bastante para gerar confusão mesmo dentro do próprio projeto — é a peça que sustenta toda a orquestração de missões descrita no capítulo seguinte.

## O que ficou pronto, e o que ficou pendente

Ao fim de 05-31, a V2 tinha: Mission Engine, Router, Memory/Knowledge/Context/Skill/QA/Documentation Engines, Approval Gates, Dynamic Workflows, Cost Controller, Observability, Resource Manager, Mission Scheduler, Specialists, Vault Engine e Telegram Agent — nominalmente, as Fases 1 a 5 inteiras do roadmap do VISION.md, em 3 dias. O que não estava pronto — e que o capítulo 5 mostra da forma mais dura possível — era a garantia de que essa engrenagem toda executava de ponta a ponta sem intervenção manual. Ter as peças construídas e ter a missão funcionando de verdade eram, ainda, duas coisas diferentes.
