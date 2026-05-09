# Rayzen Goal Graph

**Data:** 2026-05-08  
**Status:** implementado — MVP Fase 1  
**Branch:** `local/marcelo`  
**Commit:** `4f2c762`

---

## A ideia

O Rayzen já sabia *o que foi feito* (eventos, sínteses de sessão) e *onde está* (ProjectState: objective, milestones, blockers, risks). Mas faltava a terceira dimensão: **onde quer chegar**.

Sem uma meta declarada, o sistema não consegue responder:
- O que está atrasado em relação ao objetivo?
- Qual a ação mais impactante agora?
- O projeto está convergindo ou divergindo da intenção original?

O **Goal Graph** é a camada de intenção. Ele conecta:

```
Meta declarada (ProjectGoal)
        ↕  LLM compara
Estado atual (ProjectState)
        ↓
Gap Analysis → Next Best Action
        ↓
Diagrama Mermaid (visual)
```

---

## O problema que resolve

Antes do Goal Graph, o Rayzen funcionava como um **espelho do passado**: capturava atividade, sintetizava, gerava docs. Mas não orientava o futuro.

Com o Goal Graph:
- Você declara onde quer chegar (título + critérios de sucesso + KPIs + prazo)
- O sistema compara com o que foi feito e onde está agora
- Entrega uma lista priorizada de gaps e **uma ação concreta** para executar

A pergunta "o que eu deveria fazer agora?" passa a ter uma resposta gerada em contexto, não genérica.

---

## O plano (como foi decidido)

### Abordagem escolhida

**MVP com Mermaid.js via CDN** — sem React Flow (Fase 2 futura), sem nova dependência npm. Rende diagramas SVG a partir de strings `.mmd` geradas pela API.

### O que foi reutilizado

| Existente | Como foi reutilizado |
|---|---|
| `ProjectState` | Estado atual: milestones, blockers, risks, objective — input direto para o gap analysis |
| `ProjectState.milestones` | Nós do diagrama Mermaid de estado atual |
| `ProjectStateService.get()` | Chamado diretamente pelo `GraphService` |
| `HealthScoreService.getCurrent()` | Score exibido no `GoalGraphResponse` |
| `Event.intent` | Filtra `decision` e `problem` para enriquecer o contexto do LLM |
| `extractJson()` | Copiado de `synthesis.service.ts` — parsing robusto de JSON sem `response_format` |
| `DataLineageEdge` | Padrão de grafo (source → target) como referência arquitetural para Fase 2 |

### O que foi criado

**Schema:**
```prisma
model ProjectGoal {
  id              String    @id @default(uuid())
  projectId       String    @map("project_id")
  title           String
  description     String?
  successCriteria Json      @default("[]")  // [{id, text, done}]
  kpis            Json      @default("[]")  // [{metric, target, current?, unit}]
  status          String    @default("active")  // active|achieved|paused|cancelled
  targetDate      DateTime?
  parentGoalId    String?   // hierarquia de goals
  // ...timestamps, relations
  @@map("project_goals")
}
```

**API — módulo `graph`:**

| Rota | Descrição |
|---|---|
| `GET /projects/:id/graph` | Mermaid do estado atual (milestones + blockers + next steps) |
| `GET /projects/:id/graph/goal` | GoalGraphResponse: meta + estado + gap analysis + mermaid + health score |
| `GET /projects/:id/graph/goals` | Lista todos os goals do projeto |
| `POST /projects/:id/graph/goal` | Cria nova meta ativa (pausa a anterior) |
| `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId` | Toggle critério done/undone |

**GapAnalysis — LLM gpt-4o-mini (temp 0.2):**

Contexto enviado: meta completa + estado atual (milestones, blockers, risks, stage) + últimos 10 eventos de decision/problem.

Resposta estruturada:
```typescript
{
  gaps: [{ area, description, severity: 'high'|'medium'|'low', relatedCriteria? }]
  nextBestAction: string    // 1 frase concreta
  goalProgress: number      // 0–100
  confidence: 'low'|'medium'|'high'
}
```

**Web:**
- Botão **grafo** no header (aparece só com projeto ativo)
- Sub-modo `goal`: meta + barra de progresso + gaps coloridos por severidade + Next Best Action + diagrama
- Sub-modo `estado`: diagrama Mermaid do estado atual
- Formulário de criação: título, descrição, prazo, critérios de sucesso (lista dinâmica)
- Mermaid renderizado via `window.mermaid.init()` em `useEffect`

---

## O resultado

### O que funciona

1. **Definir meta:** formulário com título + critérios + prazo → salvo como `ProjectGoal` ativo
2. **Progresso automático:** marcando critérios como done a barra de progresso atualiza; inclui milestones do `ProjectState`
3. **Gap Analysis:** LLM lê meta + estado + eventos recentes → lista priorizada de gaps com severidade visual
4. **Next Best Action:** uma frase de ação gerada em contexto (não genérica)
5. **Diagrama de estado:** Mermaid do `ProjectState` atual — milestones (verde=done, azul=active, cinza=pending), blockers (vermelho), próximos passos (roxo)
6. **Diagrama do goal:** Mermaid do goal — critérios, gaps high severity, Next Best Action

### Limitações do MVP

- **Fase 2 — React Flow:** interatividade completa (arrastar nós, editar inline, timeline visual) ainda não implementada
- **Sem histórico de goals:** ao criar nova meta, a anterior é pausada mas não há comparação de evolução entre goals
- **KPIs não verificados:** campo existe mas o LLM não tem fonte de dados para KPI atual — fica como contexto declarado
- **Mermaid em mobile:** diagramas complexos podem ficar cortados em telas pequenas

### Arquivos modificados

| Arquivo | O que mudou |
|---|---|
| `apps/api/prisma/schema.prisma` | +`ProjectGoal` model, +`projectGoals` relation em `Project` |
| `apps/api/src/modules/graph/graph.module.ts` | Criado |
| `apps/api/src/modules/graph/graph.service.ts` | Criado — Mermaid gen + gap analysis LLM + CRUD goal |
| `apps/api/src/modules/graph/graph.controller.ts` | Criado — 5 rotas |
| `apps/api/src/app.module.ts` | +`GraphModule` |
| `apps/web/app/page.tsx` | +interfaces GoalGraph, +state vars, +`openGraph`, +`saveGoal`, +`toggleCriteria`, +painel grafo, +formulário de meta |
| `apps/web/app/layout.tsx` | +`<Script>` Mermaid CDN com `theme: dark` |

---

## Fase 2 — próximos passos planejados

- **React Flow:** substituir Mermaid por grafo interativo com arrastar/zoom
- **Histórico de goals:** timeline de metas com datas de criação e conquista
- **KPI tracking:** integrar com eventos para rastrear KPIs automaticamente (ex: commits/semana, testes passando)
- **Goal → EventGraph:** cada evento (Edit, Commit, Decision) vira um nó conectado ao milestone correspondente
- **Tabelas `graph_nodes`/`graph_edges`:** para persistência de nós editados manualmente
- **Notificação proativa:** quando `goalProgress` estagnar por N dias → recomendação automática via `ProjectRecommendation`
