# Rayzen Goal Graph

**Atualizado:** 2026-05-10  
**Status:** implementado — Fase 3 (KPI Tracking + Goal History + Alertas de Estagnação + Onboarding Wizard)  
**Branch:** `local/marcelo`

---

## A ideia

O Rayzen já sabia *o que foi feito* (eventos, sínteses de sessão) e *onde está* (ProjectState: objective, milestones, blockers, risks). Mas faltava a terceira dimensão: **onde quer chegar**.

O **Goal Graph** é a camada de intenção. Ele conecta:

```
ProjectGoal (meta declarada)
        ↕  LLM compara
ProjectState (estado atual)
        ↓
Gap Analysis → Next Best Action
        ↓
Grafo interativo React Flow (visual + CRUD)
```

---

## O problema que resolve

Antes do Goal Graph, o Rayzen funcionava como um **espelho do passado**: capturava atividade, sintetizava, gerava docs. Mas não orientava o futuro.

Com o Goal Graph:
- Você declara onde quer chegar (título + critérios de sucesso + KPIs + prazo)
- O sistema compara com o que foi feito e onde está agora
- Entrega gaps priorizados e **uma ação concreta** para executar agora
- Você edita o estado do projeto diretamente no grafo (CRUD visual)
- KPIs são rastreados com barra de progresso e edição inline
- Histórico de metas mostra a timeline completa de goals passados
- Alertas proativos quando o progresso da meta estagna por 5+ dias

---

## Arquitetura

### Schema Prisma

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
  parentGoalId    String?
  // ...timestamps, relations
  @@map("project_goals")
}
```

### API — módulo `graph`

| Rota | Descrição |
|---|---|
| `GET /projects/:id/graph` | Retorna estado atual com `state` (milestones, blockers, nextSteps) |
| `GET /projects/:id/graph/goal` | GoalGraphResponse: meta + estado + gap analysis + health score |
| `GET /projects/:id/graph/goals` | Lista todos os goals do projeto (histórico completo) |
| `POST /projects/:id/graph/goal` | Cria nova meta ativa (pausa a anterior) |
| `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId` | Toggle critério done/undone |
| `PATCH /projects/:id/graph/goal/:goalId/kpi` | Atualiza valor atual (`current`) de um KPI |
| `POST /projects/:id/graph/goal/:goalId/kpi/auto-track` | LLM analisa eventos recentes e atualiza `current` dos KPIs com evidência |
| `PATCH /projects/:id/graph/goal/:goalId/status` | Altera status da meta (active / achieved / paused / cancelled) |

### API — planning (atualizado)

`PATCH /projects/:id/state/planning` aceita:
```typescript
{
  milestones?: { id, title, status }[]
  blockers?: string[]
  nextSteps?: string[]
  backlog?: { id, title, priority }[]
  activeFocus?: string
  definitionOfDone?: string
}
```

### GapAnalysis — LLM (gpt-4o-mini, temp 0.2)

Contexto: meta completa + estado atual + últimos 10 eventos de decision/problem/idea.

```typescript
{
  gaps: [{ area, description, severity: 'high'|'medium'|'low', relatedCriteria? }]
  nextBestAction: string    // 1 frase acionável
  goalProgress: number      // 0–100
  confidence: 'low'|'medium'|'high'
}
```

---

## Componente GraphCanvas

**Arquivo:** `apps/web/app/components/GraphCanvas.tsx`  
**Carregamento:** `next/dynamic` com `ssr: false` (browser-only)  
**Dependência:** `@xyflow/react` v12

### StateCanvas (aba "Estado atual")

Renderiza grafo em 3 colunas:
- **Esquerda (vermelho):** blockers — `[blocker]` nodes
- **Centro (azul):** milestones — `[milestone]` nodes com status colorido
- **Direita (roxo):** próximos passos — `[próximo]` nodes

**CRUD disponível:**
| Ação | Como |
|---|---|
| Criar milestone | Botão `+ milestone` → input → Enter |
| Criar blocker | Botão `+ blocker` → input → Enter |
| Criar próximo passo | Botão `+ próximo` → input → Enter |
| Editar texto | Duplo clique no node → edita inline → Enter/Blur |
| Mudar status | Clique no node milestone → cicla pending→active→done |
| Deletar | Hover no node → clique no × |
| Salvar | Botão **salvar** aparece quando há mudanças → chama `PATCH /state/planning` |

### GoalCanvas (aba "Goal Graph")

Renderiza hierarquia de cima para baixo:
- **Topo (amarelo):** meta com prazo
- **Linha 2 (azul/verde):** critérios de sucesso (done=verde, pending=azul) — **clicáveis: toggle done/undone**
- **Linha 3 (vermelho/laranja):** gaps de alta severidade
- **Base (ciano):** Next Best Action

---

## Goal Card — funcionalidades

### Critérios de sucesso
- Toggle done/undone tanto no card quanto no grafo React Flow
- Ambos chamam `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId`

### KPIs
- Exibidos com barra de progresso (verde ≥100%, azul ≥60%, âmbar abaixo)
- **Edição inline:** clique no valor atual → campo editável → Enter/Blur → `PATCH /projects/:id/graph/goal/:goalId/kpi`
- Campos no formulário de nova meta: métrica, meta (target), unidade

### Histórico de metas
- Botão "histórico de metas" abaixo do diagrama (lazy load)
- Busca via `GET /projects/:id/graph/goals`
- Cada meta exibe: título, badge de status (active/achieved/paused/cancelled), data de criação, mini progress bar (critérios done/total), prazo se definido
- Reseta ao trocar de projeto ou reabrir o grafo

---

## Alerta de estagnação (Proactive)

**Tipo:** `goal_stagnant`  
**Regra (Proactive Regra 7):** se a meta ativa tem `goalProgress < 100%` e `updatedAt` > 5 dias atrás, cria uma `ProjectRecommendation`.

| Condição | Prioridade |
|---|---|
| 5–13 dias sem atualização | medium |
| 14+ dias sem atualização | high |

**Ação sugerida:** "Marque critérios cumpridos no Goal Graph ou redefina a meta para refletir a realidade atual."

---

## Onboarding Wizard

Ao criar um projeto novo, o modal se torna um wizard de 3 passos:

| Passo | Conteúdo |
|---|---|
| 1 — Projeto | Nome, slug (repo), descrição → "Criar e continuar" |
| 2 — Fonte | GitHub repo / Notion page / Pular → indexa no Brain |
| 3 — Meta | Título, prazo, critérios de sucesso → "Concluir" ou "Pular" |

Passo 2 chama `POST /memory/index/github` ou `POST /memory/index/notion`.  
Passo 3 chama `POST /projects/:id/graph/goal`.

---

## Fluxo de uso

1. **Abrir grafo** → botão "grafo" no header (visível só com projeto ativo)
2. **Estado atual** → aba mostra milestones/blockers/próximos passos do projeto
   - Se vazio: clicar **⟳ gerar estado** → LLM analisa eventos e gera estado
   - Se quiser editar manualmente: usar CRUD do grafo → salvar
3. **Goal Graph** → aba define a meta
   - Se sem meta: formulário (título, critérios, KPIs, prazo)
   - Com meta: vê progresso, KPIs, gaps por severidade e Next Best Action
   - Marcar critérios como done atualiza a barra de progresso
   - Editar KPI atual: clique no valor → editar inline
4. **Histórico** → botão "histórico de metas" mostra todas as metas passadas
5. **Atualizar** → botão "atualizar" no footer recarrega ambos os dados

---

## Histórico de implementação

### Fase 1 — MVP (2026-05-08)
- Schema `ProjectGoal`, módulo `graph` (service + controller)
- Gap Analysis via LLM
- Web: painel modal com 2 abas, formulário de goal, cards de gap
- Diagrama: tentativa com Mermaid.js

### Fase 2 — React Flow + CRUD (2026-05-09)
- Substituição completa de Mermaid por `@xyflow/react`
- `GraphCanvas.tsx` — componente client-only com `StateCanvas` e `GoalCanvas`
- CRUD de nodes no `StateCanvas` (criar, editar inline, deletar, ciclar status)
- Persistência via `PATCH /projects/:id/state/planning`
- Visual futurista: glow neon, edges animadas, MiniMap
- **Por que Mermaid não funcionou:** v11 é ESM puro — não define `window.mermaid` como global (CDN UMD inválido); `await import('mermaid')` em Next.js 15 falhou silenciosamente

### Fase 3 — KPI + Histórico + Alertas + Onboarding (2026-05-10)
- **GoalCanvas CRUD:** critérios clicáveis no grafo (toggle done/undone via `onToggle` callback)
- **KPI Tracking:** seção de KPIs no goal card com barras de progresso e edição inline; endpoint `PATCH /goal/:goalId/kpi`; campos de KPI no formulário de nova meta
- **Goal History:** painel "histórico de metas" lazy-load mostrando timeline completa por projeto
- **Stagnation Alert:** Proactive Regra 7 — recomendação `goal_stagnant` quando progresso < 100% e sem atualização por 5+ dias
- **Onboarding Wizard:** modal de novo projeto transformado em wizard 3 passos (projeto → fonte → meta)
- **Scripts:** `start-rayzen-notebook.bat` e `notebook-api-tunnel.bat` corrigidos para iniciar LiteLLM junto com Postgres/Redis

---

## Arquivos

| Arquivo | Status |
|---|---|
| `apps/api/prisma/schema.prisma` | `ProjectGoal` model |
| `apps/api/src/modules/graph/graph.module.ts` | módulo |
| `apps/api/src/modules/graph/graph.service.ts` | `updateKpi()` adicionado |
| `apps/api/src/modules/graph/graph.controller.ts` | `PATCH /goal/:goalId/kpi` adicionado |
| `apps/api/src/modules/proactive/proactive.service.ts` | Regra 7 (`goal_stagnant`) |
| `apps/api/src/modules/project-state/project-state.service.ts` | `updatePlanning` com `blockers`/`nextSteps` |
| `apps/web/app/components/GraphCanvas.tsx` | `onToggle` em criteria nodes; `goalId`/`onToggleCriteria` em GoalCanvas |
| `apps/web/app/page.tsx` | KPI tracking, goal history, onboarding wizard, `saveKpi`, `loadGoalsHistory` |
| `start-rayzen-notebook.bat` | LiteLLM adicionado ao startup |
| `notebook-api-tunnel.bat` | LiteLLM adicionado; Node 22 permitido |

---

## Próximos passos

- **Goal → EventGraph:** cada evento (Edit, Commit, Decision) vira nó conectado ao milestone correspondente
- **GoalCanvas — edição de critérios:** criar/renomear critérios diretamente no grafo (sem abrir o formulário)
- **Bug: indexação Notion no Brain** — `POST /memory/index/notion` sem erro visível na UI
