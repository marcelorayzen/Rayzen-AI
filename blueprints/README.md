# Rayzen AI V2 — Blueprints

Documentos de design para a arquitetura V2 orientada a missões.
V2 rodará como `apps/api-v2/` — app paralelo ao V1 existente.

## Arquitetura

```
Usuário
  ↓
Router
  ↓
Mission Engine
  ↓
Context Engine
  ↓
Memory Engine       ← fatos: o que foi feito, status, timeline
  ↓
Knowledge Engine    ← relações: como módulos/entidades/regras se conectam  ← ADR-016
  ↓
AI Router / Skills
  ↓
Dynamic Workflows
  ↓
QA Engine + Documentation Engine
  ↓
Entrega
```

## Componentes

| # | Componente | Fase | V1 equivalente | Gap principal |
|---|---|---|---|---|
| [001](001-mission-engine.md) | Mission Engine | 1 | `project-state/` + `event/` | Entidade Mission com lifecycle de execução |
| [002](002-router.md) | Router | 1 | `orchestrator/` | Separação entre classificação e roteamento |
| [003](003-ai-router.md) | AI Router | 2 | `orchestrator.classify()` | Seleção dinâmica de modelo por tier de custo |
| [004](004-memory-engine.md) | Memory Engine | 1 | `memory/` + `brain/` | Lifecycle de classes, consolidação automática |
| [005](005-context-engine.md) | Context Engine | 2 | `orchestrator.getProjectContext()` | Templates por work mode, cache, relevance scoring |
| [006](006-skill-engine.md) | Skill Engine | 2 | `executor.ts` switch-case | Registry dinâmico com metadata e composição |
| [007](007-documentation-engine.md) | Documentation Engine | 3 | `wiki/` + `documentation/` | Doc gerado nativo por missão concluída |
| [008](008-qa-engine.md) | QA Engine | 3 | `qa/` + `data-quality/` | QA gate linkado ao lifecycle da missão |
| [009](009-cost-controller.md) | Cost Controller | 4 | Logging de tokens disperso | Budget enforcement com bloqueio ativo |
| [010](010-observability.md) | Observability | 4 | `metrics/` + `event/` | Trace IDs distribuídos, mission timeline |
| [011](011-specialists.md) | Specialists | 5 | `supervised-session` | Especialistas dinâmicos com lifecycle gerenciado |
| [012](012-project-memory.md) | Project Memory | 2 | `Document` + `Event` | Memória estruturada por tipo e classe por projeto |
| [013](013-local-models.md) | Local Models | 2 | Ollama (sem uso real) | Tier 0 de custo zero integrado ao AI Router |
| [014](014-human-approval-gates.md) | Human Approval Gates | 3 | `dryRun` + confirmations | Gates formais com audit trail e timeout |
| [015](015-dynamic-workflows.md) | Dynamic Workflows | 3 | Nenhum | DAG de steps com execução paralela e retry |
| [016](016-telegram-agent.md) | Telegram Agent | 2 | Bot passivo de notificação | Interface mobile completa com comandos e chat |
| [017](017-knowledge-engine.md) | Knowledge Engine | 2 | `graphify` (parcial) | Grafo de relações entre módulos, entidades e ADRs |

## Fases de implementação

```
Fase 1: Mission Engine + Router + Memory Engine

Fase 2: Skill Engine + AI Router + Context Engine
        + Local Models + Project Memory
        + Knowledge Engine          ← adicionado via ADR-016
        + Telegram Agent

Fase 3: Knowledge Graph Builder + Relationship Extractor
        + Impact Analyzer + Project Mapper
        + Documentation Engine + QA Engine
        + Human Approval Gates + Dynamic Workflows

Fase 4: Cost Controller + Observability completa

Fase 5: Specialists + Multi-agent runtime + Planejamento autônomo
```

## Decisões de arquitetura

| ADR | Decisão |
|---|---|
| ADR-001 a 027 | Ver `CLAUDE.local.md` — decisões da V1 |
| [ADR-016](ADR-016-knowledge-engine.md) | Knowledge Engine como componente separado do Memory Engine |

**Princípios:**
- **App paralelo**: V2 em `apps/api-v2/` — V1 continua rodando sem interrupção
- **Mission como unidade central**: toda execução é uma missão com lifecycle
- **Skills antes de IA**: o Skill Engine é consultado antes de acionar modelos
- **Memory ≠ Knowledge**: fatos operacionais (memory) separados de relações estruturais (knowledge)
- **Ollama como tier 0**: modelos locais para classificação, resumo e extração
- **Memória com lifecycle**: `inbox → working → consolidated → archive` com decay
- **Trace distribuído**: `traceId` propagado de ponta a ponta
