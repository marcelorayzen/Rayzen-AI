# Rayzen Goal Graph

**Atualizado:** 2026-05-09  
**Status:** implementado — Fase 2 (React Flow interativo)  
**Branch:** `local/marcelo`  
**Commits:** `4f2c762` (MVP) → `9e21b8d` (React Flow + CRUD)

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
| `GET /projects/:id/graph/goals` | Lista todos os goals do projeto |
| `POST /projects/:id/graph/goal` | Cria nova meta ativa (pausa a anterior) |
| `PATCH /projects/:id/graph/goal/:goalId/criteria/:criteriaId` | Toggle critério done/undone |

### API — planning (atualizado)

`PATCH /projects/:id/state/planning` agora aceita:
```typescript
{
  milestones?: { id, title, status }[]
  blockers?: string[]        // ← adicionado para CRUD do grafo
  nextSteps?: string[]       // ← adicionado para CRUD do grafo
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
- **Linha 2 (azul/verde):** critérios de sucesso (done=verde, pending=azul)
- **Linha 3 (vermelho/laranja):** gaps de alta severidade
- **Base (ciano):** Next Best Action

Leitura apenas — edições são feitas via formulário de goal.

### Visual

- Background `#050508` com grid sutil
- Nodes com **glow neon** colorido por tipo
- Edges animadas para conexões ativas
- MiniMap no canto inferior direito
- Controles de zoom/pan integrados

---

## Fluxo de uso

1. **Abrir grafo** → botão "grafo" no header (visível só com projeto ativo)
2. **Estado atual** → aba mostra milestones/blockers/próximos passos do projeto
   - Se vazio: clicar **⟳ gerar estado** → LLM analisa eventos e gera estado
   - Se quiser editar manualmente: usar CRUD do grafo → salvar
3. **Goal Graph** → aba define a meta
   - Se sem meta: formulário (título, critérios, prazo)
   - Com meta: vê progresso, gaps por severidade e Next Best Action
   - Marcar critérios como done atualiza a barra de progresso
4. **Atualizar** → botão "atualizar" no footer recarrega ambos os dados

---

## Histórico de implementação

### Fase 1 — MVP (2026-05-08)
- Schema `ProjectGoal`, módulo `graph` (service + controller)
- Gap Analysis via LLM
- Web: painel modal com 2 abas, formulário de goal, cards de gap
- Diagrama: tentativa com Mermaid.js

### Fase 2 — React Flow (2026-05-09)
- Substituição completa de Mermaid por `@xyflow/react`
- `GraphCanvas.tsx` — componente client-only com `StateCanvas` e `GoalCanvas`
- CRUD de nodes no `StateCanvas` (criar, editar inline, deletar, ciclar status)
- Persistência via `PATCH /projects/:id/state/planning` (adicionado suporte a `blockers` e `nextSteps`)
- Visual futurista: glow neon, edges animadas, MiniMap

**Por que Mermaid não funcionou:**
- Mermaid 11 é ESM puro — não define `window.mermaid` como global (CDN UMD inválido)
- `await import('mermaid')` em Next.js 15 falhou silenciosamente mesmo com `serverExternalPackages`
- React Flow é nativo React e carrega sem problemas via `next/dynamic + ssr: false`

---

## Arquivos

| Arquivo | Status |
|---|---|
| `apps/api/prisma/schema.prisma` | +`ProjectGoal` model |
| `apps/api/src/modules/graph/graph.module.ts` | criado |
| `apps/api/src/modules/graph/graph.service.ts` | criado |
| `apps/api/src/modules/graph/graph.controller.ts` | criado |
| `apps/api/src/modules/project-state/project-state.service.ts` | +`blockers`/`nextSteps` no `updatePlanning` |
| `apps/api/src/modules/project-state/project-state.controller.ts` | +`blockers`/`nextSteps` no body |
| `apps/api/src/app.module.ts` | +`GraphModule` |
| `apps/web/app/components/GraphCanvas.tsx` | criado — React Flow canvas |
| `apps/web/app/page.tsx` | +painel grafo, +`openGraph`, +`saveGoal`, +`toggleCriteria`, +`graphStateData` |
| `apps/web/next.config.ts` | +`serverExternalPackages: ['mermaid']` (legado) |
| `apps/web/package.json` | +`@xyflow/react` |

---

## Próximos passos

- **Histórico de goals:** timeline de metas com datas de criação e conquista
- **KPI tracking:** integrar com eventos para rastrear KPIs automaticamente
- **GoalCanvas CRUD:** edição inline dos critérios diretamente no grafo
- **Goal → EventGraph:** cada evento (Edit, Commit, Decision) vira nó conectado ao milestone
- **Notificação proativa:** quando `goalProgress` estagnar por N dias → recomendação automática
