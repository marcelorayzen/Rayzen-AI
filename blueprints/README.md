# Rayzen AI V2 — Mission Oriented Engineering System

> O Rayzen AI deixa de ser um assistente conversacional e passa a ser um **sistema operacional orientado a missões**, capaz de compreender projetos, preservar conhecimento, executar fluxos complexos, validar resultados e coordenar especialistas sob demanda com controle de custo, contexto e qualidade.

→ Ver [VISION.md](VISION.md) para a arquitetura completa e vision statement.

---

## Princípio central

```
Antes:  Usuário → Pergunta → Resposta

Depois: Usuário → Objetivo → Missão → Execução → Validação → Entrega
```

---

## Componentes por camada

| Layer | Blueprint | Componente | Fase | Gap principal |
|---|---|---|---|---|
| 1 | [001](001-mission-engine.md) | Mission Engine | 1 | Entidade Mission com lifecycle de execução |
| 2 | [002](002-router.md) | Router | 1 | Separação entre classificação e roteamento |
| 3 | [003](003-ai-router.md) | AI Router | 2 | Seleção dinâmica de modelo por tier de custo |
| 4 | [004](004-memory-engine.md) | Memory Engine | 1 | Working/Project/Long-Term/Archive com lifecycle |
| 5 | [005](005-knowledge-engine.md) | Knowledge Engine | 2 | Grafo de relações entre módulos, entidades e ADRs |
| 6 | [006](006-context-engine.md) | Context Engine | 2 | Contexto mínimo necessário — não 100k tokens |
| 7 | [007](007-skill-engine.md) | Skill Engine | 2 | ADR, Roadmap, Architecture, Spec, QA, Review... |
| 8 | [008](008-qa-engine.md) | QA Engine | 3 | QA gate linkado ao lifecycle da missão |
| 9 | [009](009-documentation-engine.md) | Documentation Engine | 3 | Doc gerado nativo por missão concluída |
| T | [010](010-resource-manager.md) | Resource Manager | 4 | Context explosion, zombie agents, loops infinitos |
| T | [011](011-mission-scheduler.md) | Mission Scheduler | 4 | Fila, prioridade, dependências entre missões |
| T | [012](012-cost-controller.md) | Cost Controller | 4 | Budget enforcement com bloqueio ativo e ROI |
| T | [013](013-observability.md) | Observability | 4 | Trace distribuído, mission timeline |
| T | [014](014-human-approval-gates.md) | Human Approval Gates | 3 | Nem tudo deve ser automático |
| — | [015](015-specialists.md) | Specialists | 5 | Criados sob demanda, destruídos após a missão |
| — | [016](016-project-memory.md) | Project Memory | 2 | Memória estruturada por tipo e projeto |
| — | [017](017-local-models.md) | Local Models | 2 | Ollama tier 0 integrado ao AI Router |
| — | [019](019-dynamic-workflows.md) | Dynamic Workflows | 3 | DAG de steps dentro de uma missão |
| — | [020](020-telegram-agent.md) | Telegram Agent | 2 | Interface mobile completa |
| T | [021](021-vault-engine.md) | Vault Engine | 2 | Segredos criptografados — nunca em contexto LLM |
| — | [022](022-skill-runtime.md) | Skill Runtime | 2 | Executor in-process + Specialist Factory on-demand |
| — | [023](023-web-interface-v2.md) | Web Interface V2 | 3 | /mission /knowledge /vault /observability no apps/web |
| — | [024](024-data-strategy.md) | Data Strategy | 1 | Schema v2 separado, V1BridgeService read-only, docker |

*T = componente transversal (presente em todas as camadas)*

---

## ADRs

| ADR | Decisão |
|---|---|
| ADR-001 a 027 | Ver `CLAUDE.local.md` — decisões da V1 |
| [ADR-016](ADR-016-knowledge-engine.md) | Knowledge Engine separado do Memory Engine |

---

## Roadmap

```
Fase 1 — Fundação
  Mission Engine + Router + Memory Engine

Fase 2 — Inteligência
  Skill Engine + AI Router + Context Engine
  + Knowledge Engine + Local Models
  + Project Memory + Telegram Agent
  + Vault Engine

Fase 3 — Qualidade e Controle
  QA Engine + Documentation Engine
  + Human Approval Gates + Dynamic Workflows
  + Knowledge Graph Builder + Impact Analyzer

Fase 4 — Governança
  Resource Manager + Mission Scheduler
  + Cost Controller + Observability completa

Fase 5 — Autonomia
  Specialists + Multi-agent runtime
  + Planejamento autônomo avançado
```

---

## Estrutura de pastas — apps/api-v2

```
apps/api-v2/src/
├── core/
├── mission/
├── router/
├── ai-router/
├── memory/
├── knowledge/
│   ├── graph-builder/
│   ├── graph-storage/
│   ├── graph-query/
│   ├── impact-analyzer/
│   └── relationship-extractor/
├── context/
├── skills/
├── qa/
├── documentation/
├── scheduler/
├── resources/
├── observability/
├── approvals/
└── specialists/
```
