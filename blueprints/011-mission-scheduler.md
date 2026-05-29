# 011 — Mission Scheduler

## Visão Geral

O Mission Scheduler gerencia a fila de missões — prioridade, dependências entre missões, pausa, retomada e execução paralela controlada. É o componente que garante que missões complexas e interrelacionadas sejam executadas na ordem certa, sem sobrecarregar os recursos.

Enquanto o **Dynamic Workflows** gerencia a ordem de *steps dentro de uma missão*, o **Mission Scheduler** gerencia a ordem de *missões entre si*.

---

## Diferença Scheduler vs Dynamic Workflows

```
Mission Scheduler:
  Missão A → Missão B → Missão C
  (dependência entre missões inteiras)

Dynamic Workflows:
  Step 1 → Step 2 → Step 3  (dentro da Missão A)
  (dependência entre steps de uma missão)
```

Exemplo real:
```
Mission: Sistema Restaurante
  ├── Sub-mission: Architecture Design     (Scheduler: executar primeiro)
  ├── Sub-mission: Database Schema         (Scheduler: após Architecture)
  ├── Sub-mission: Backend Implementation  (Scheduler: após Database)
  └── Sub-mission: Frontend               (Scheduler: paralelo ao Backend)
```

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `execution/` + Bull Queue | Fila de tasks atômicas — sem dependências entre missões |
| `poller.ts` no agente | Poll de tasks pendentes por role — sem prioridade |

**Status V1:** Não existe scheduler de missões. Tasks são executadas na ordem de chegada (FIFO) sem prioridade, dependências ou agrupamento.

---

## Gaps

- Fila de missões com prioridade (`critical > high > normal > low`)
- Dependências entre missões (`missionB.dependsOn: [missionA.id]`)
- Execução paralela controlada: N missões simultâneas (respeitando Resource Manager)
- Pausa e retomada de missões com estado preservado
- Agendamento futuro: "executar esta missão amanhã às 9h"
- Missões recorrentes: "toda segunda-feira, gerar relatório de progresso"
- Dashboard de fila: visualizar estado de todas as missões pendentes

---

## Interface / Endpoints

```
GET  /v2/scheduler/queue              # Fila de missões (todas as pendentes)
GET  /v2/scheduler/running            # Missões em execução agora
POST /v2/scheduler/missions/:id/prioritize  # Altera prioridade
POST /v2/scheduler/missions/:id/schedule    # Agenda execução futura
POST /v2/scheduler/missions/:id/pause       # Pausa missão em andamento
POST /v2/scheduler/missions/:id/resume      # Retoma missão pausada
GET  /v2/scheduler/dependencies/:id         # Grafo de dependências da missão
```

---

## Modelo de Dados

```typescript
type MissionPriority = 'critical' | 'high' | 'normal' | 'low'

interface ScheduledMission {
  missionId:    string
  priority:     MissionPriority
  dependsOn:    string[]          // ids de missões que devem completar antes
  scheduledAt?: Date              // execução agendada (null = execute agora)
  recurrence?:  string            // cron expression para missões recorrentes
  queuedAt:     Date
  startedAt?:   Date
  pausedAt?:    Date
  state?:       Record<string, unknown> // estado preservado ao pausar
}

interface SchedulerStatus {
  queued:    number
  running:   number
  paused:    number
  completed: number
  failed:    number
  byPriority: Record<MissionPriority, number>
}
```

**Algoritmo de scheduling:**
```
1. Filtrar missões prontas: status 'queued' + dependências satisfeitas
2. Ordenar por prioridade (critical → low) e depois por queuedAt (FIFO)
3. Verificar Resource Manager: há slots disponíveis?
4. Despachar próxima missão elegível
5. Repetir a cada ciclo (trigger: missão completa ou novo item na fila)
```

**Exemplo de dependência:**
```typescript
// Sistema Restaurante
{ missionId: 'M-002', dependsOn: ['M-001'] }  // Database após Architecture
{ missionId: 'M-003', dependsOn: ['M-001'] }  // Backend após Architecture
{ missionId: 'M-004', dependsOn: ['M-001'] }  // Frontend após Architecture
// M-003 e M-004 podem rodar em paralelo (ambos dependem só de M-001)
```

---

## Dependências

- **001 — Mission Engine**: o Scheduler controla quando missões iniciam/pausam
- **010 — Resource Manager**: verifica slots disponíveis antes de despachar
- **015 — Dynamic Workflows**: execução interna de cada missão (separação de responsabilidades)
- **013 — Observability**: métricas da fila (tamanho, tempo de espera, throughput)
- **014 — Human Approval Gates**: missões críticas aguardam aprovação antes de entrar na fila

---

## Fase de Implementação

**Fase 4** — após Mission Engine e Dynamic Workflows estáveis.

Ordem:
1. `ScheduledMission` model (migration Prisma)
2. `MissionSchedulerService` — fila com prioridade
3. Dependências entre missões (topological sort, mesmo conceito do Dynamic Workflows)
4. Pausa e retomada com estado preservado (Redis)
5. Agendamento futuro (BullMQ `delay`)
6. Missões recorrentes (BullMQ `repeat`)
7. Dashboard de fila
