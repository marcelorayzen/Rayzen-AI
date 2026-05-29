# 001 — Mission Engine

## Visão Geral

O Mission Engine é o núcleo da arquitetura V2. Uma **missão** é a unidade principal de execução — qualquer solicitação significativa do usuário gera uma missão com objetivo, passos, estado e rastreabilidade completa.

Enquanto a V1 trata cada mensagem de forma isolada (event + checkpoint), a V2 agrupa execuções relacionadas em uma missão contínua com lifecycle gerenciado.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/project-state/` | Rastreia objetivo, stage, milestones, blockers — mas é estático, não é um executor |
| `apps/api/src/modules/event/` | Log de atividades, mas sem agrupamento por missão |
| `apps/api/src/modules/blueprint/` | Importa planos estruturados, mas não os executa — apenas armazena |
| `apps/api/src/modules/synthesis/` | Gera checkpoints, mas não rastreia progresso de steps |

**Ausente na V1:** Não existe entidade `Mission` com lifecycle de execução, steps dependentes nem orquestração de progresso.

---

## Gaps

- Modelo `Mission` com campos: `id`, `title`, `objective`, `status`, `steps`, `projectId`, `createdAt`, `startedAt`, `completedAt`
- `MissionStep` com: `id`, `missionId`, `title`, `status`, `skillId`, `input`, `output`, `dependsOn[]`, `retries`
- Status machine: `pending → active → paused → done | failed | cancelled`
- Linkagem `BlueprintImport → Mission` (blueprint vira plano de missão)
- Execução rastreada: quem executou cada step (AI, skill, humano)
- Persistência de saída de cada step para uso nos seguintes

---

## Interface / Endpoints

```
POST   /v2/missions                        # Criar missão
GET    /v2/missions                        # Listar missões do projeto
GET    /v2/missions/:id                    # Detalhes da missão
POST   /v2/missions/:id/execute            # Iniciar ou retomar execução
POST   /v2/missions/:id/pause              # Pausar
POST   /v2/missions/:id/cancel             # Cancelar
GET    /v2/missions/:id/steps              # Listar steps
PATCH  /v2/missions/:id/steps/:stepId      # Atualizar step manualmente
POST   /v2/missions/from-blueprint/:bpId   # Criar missão a partir de blueprint
```

---

## Modelo de Dados

```typescript
type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'
type StepStatus    = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface Mission {
  id:          string
  projectId:   string
  title:       string
  objective:   string
  status:      MissionStatus
  steps:       MissionStep[]
  context:     Record<string, unknown>   // contexto acumulado entre steps
  createdAt:   Date
  startedAt?:  Date
  completedAt?: Date
}

interface MissionStep {
  id:          string
  missionId:   string
  title:       string
  status:      StepStatus
  skillId?:    string                    // skill a executar
  prompt?:     string                    // prompt para AI
  input:       Record<string, unknown>
  output?:     Record<string, unknown>
  dependsOn:   string[]                  // ids de steps que devem completar antes
  retries:     number
  executor:    'skill' | 'ai' | 'human'
  approvalGateId?: string               // ref para 014-human-approval-gates
}
```

---

## Dependências

- **002 — Router**: recebe a missão e orquestra o loop de execução
- **006 — Skill Engine**: executa steps do tipo `skill`
- **003 — AI Router**: executa steps do tipo `ai`
- **014 — Human Approval Gates**: bloqueia steps de alto risco para aprovação
- **015 — Dynamic Workflows**: implementa o DAG de dependências entre steps
- **010 — Observability**: timeline da missão, trace por step

---

## Fase de Implementação

**Fase 1** — componente central, bloqueia todo o resto.

Ordem de implementação:
1. Schema Prisma (`Mission`, `MissionStep`)
2. `MissionService` — CRUD + status transitions
3. `MissionController` — endpoints REST
4. Loop de execução básico (steps em sequência, sem DAG ainda)
5. DAG de dependências (Fase 3, via `015-dynamic-workflows`)
