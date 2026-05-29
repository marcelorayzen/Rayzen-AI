# Rayzen AI V2 — Vision Statement

## Nome

**Rayzen AI V2 — Mission Oriented Engineering System**  
*(alternativo: Project Operating System)*

---

## Vision Statement

> O Rayzen AI deixa de ser um assistente conversacional e passa a ser um **sistema operacional orientado a missões**, capaz de compreender projetos, preservar conhecimento, executar fluxos complexos, validar resultados e coordenar especialistas sob demanda com controle de custo, contexto e qualidade.

---

## Princípio Central

**Antes (V1):**
```
Usuário → Pergunta → Resposta
```

**Depois (V2):**
```
Usuário → Objetivo → Missão → Execução → Validação → Entrega
```

A IA deixa de ser o centro do sistema.  
O centro passa a ser a **missão**.

---

## O que isso significa na prática

| V1 | V2 |
|---|---|
| Responde perguntas | Executa objetivos |
| Contexto temporário | Conhecimento persistente |
| Tudo vira prompt | Skills especializadas antes da IA |
| IA sempre presente | IA apenas quando necessário |
| Sem rastreabilidade | Missão com lifecycle completo |
| Sem controle de custo | Budget enforcement por missão |
| Um agente genérico | Especialistas sob demanda |
| Documentação manual | Documentação nativa por missão |

---

## Arquitetura em Camadas

```
┌─────────────────────────────────────────┐
│              USUÁRIO / OBJETIVO          │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 1 — Mission Engine              │
│  Transforma objetivo em missão          │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 2 — Router                      │
│  Decide: Skill? IA? Memória? Aprovação? │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 3 — AI Router                   │
│  Escolhe: Local → Sonnet → Opus         │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 4 — Memory Engine               │
│  Working / Project / Long-Term / Archive │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 5 — Knowledge Engine            │
│  Relações, dependências, mapas, impactos│
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 6 — Context Engine              │
│  Contexto mínimo necessário (não 100k)  │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 7 — Skill Engine                │
│  ADR, Roadmap, Architecture, Spec...    │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 8 — QA Engine                   │
│  Testes, cobertura, validação, audit    │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Camada 9 — Documentation Engine        │
│  ADR, SPEC, Roadmap, Blueprint...       │
└─────────────────┬───────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│              ENTREGA                     │
└─────────────────────────────────────────┘

Transversais (presentes em todas as camadas):
  Camada 10 — Resource Manager    (tokens, contexto, agentes, custos)
  Camada 11 — Mission Scheduler   (fila, prioridade, dependências)
  Camada 12 — Cost Controller     (budget, ROI, dashboard)
  Camada 13 — Observability       (missões, falhas, latência)
  Camada 14 — Human Approval Gates (nem tudo é automático)
  Camada 21 — Vault Engine        (segredos nunca no contexto LLM)
  Especialistas Dinâmicos          (criados e destruídos por missão)
```

---

## Componentes — índice

| Layer | Blueprint | Componente |
|---|---|---|
| 1 | [001](001-mission-engine.md) | Mission Engine |
| 2 | [002](002-router.md) | Router |
| 3 | [003](003-ai-router.md) | AI Router |
| 4 | [004](004-memory-engine.md) | Memory Engine |
| 5 | [005](005-knowledge-engine.md) | Knowledge Engine |
| 6 | [006](006-context-engine.md) | Context Engine |
| 7 | [007](007-skill-engine.md) | Skill Engine |
| 8 | [008](008-qa-engine.md) | QA Engine |
| 9 | [009](009-documentation-engine.md) | Documentation Engine |
| T | [010](010-resource-manager.md) | Resource Manager |
| T | [011](011-mission-scheduler.md) | Mission Scheduler |
| T | [012](012-cost-controller.md) | Cost Controller |
| T | [013](013-observability.md) | Observability |
| T | [014](014-human-approval-gates.md) | Human Approval Gates |
| — | [015](015-specialists.md) | Specialists |
| T | [021](021-vault-engine.md) | Vault Engine |
| — | [ADR-016](ADR-016-knowledge-engine.md) | ADR: Knowledge Engine |

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

---

## Roadmap

```
Fase 1: Mission Engine + Router + Memory Engine
        (fundação — sem isso nada funciona)

Fase 2: Skill Engine + AI Router + Context Engine
        + Knowledge Engine + Local Models
        + Project Memory + Telegram Agent

Fase 3: QA Engine + Documentation Engine
        + Human Approval Gates + Dynamic Workflows
        + Knowledge Graph Builder + Impact Analyzer

Fase 4: Resource Manager + Mission Scheduler
        + Cost Controller + Observability completa

Fase 5: Specialists + Multi-agent runtime
        + Planejamento autônomo avançado
```
