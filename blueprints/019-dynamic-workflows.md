# 015 — Dynamic Workflows

## Visão Geral

Dynamic Workflows são a camada de orquestração de steps dentro de uma missão. Na V1, cada tarefa do agente é atômica — sem dependências, sem paralelismo, sem retry. Na V2, steps de missão formam um **DAG** (grafo direcionado acíclico) onde steps independentes executam em paralelo e steps dependentes aguardam seus predecessores.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/execution/` | Dispatcher de tasks via Bull Queue — **atômico, sem sequenciamento** |
| `apps/agent/src/poller.ts` | Poll de tasks pendentes, execução unitária |
| `apps/agent/src/actions/supervised-session.ts` | Única forma de workflow multi-step — loop limitado a 20 iterações |

**Status V1:** **Nenhum** workflow engine. Cada task é executada de forma totalmente independente. Não há conceito de "task A deve preceder task B".

---

## Gaps

- DAG de steps: `step.dependsOn: string[]` → só executa quando todos os predecessores estão `done`
- Execução paralela de steps sem dependências
- Retry com backoff exponencial por step
- Checkpoint de estado intermediário: missão pode ser retomada do último step `done`
- Rollback: se step crítico falha, reverter steps anteriores (quando reversível)
- Timeout por step: step que não completa em N ms é marcado como `failed`
- Workflow templates: sequências pré-definidas reutilizáveis por tipo de missão

---

## Interface / Endpoints

```
GET  /v2/workflows/templates          # Templates de workflow disponíveis
POST /v2/workflows/templates          # Cria template customizado
GET  /v2/missions/:id/workflow        # DAG visual da missão atual
POST /v2/missions/:id/workflow/retry  # Retry de steps falhos
GET  /v2/missions/:id/checkpoint      # Último checkpoint de execução
```

---

## Modelo de Dados

```typescript
interface WorkflowTemplate {
  id:          string
  name:        string
  description: string
  missionType: MissionType
  steps:       WorkflowStepTemplate[]
}

interface WorkflowStepTemplate {
  key:         string            // identificador no template
  title:       string
  executor:    'skill' | 'ai' | 'human'
  skillId?:    string
  dependsOn:   string[]          // keys de steps predecessores
  retryPolicy: RetryPolicy
  timeoutMs:   number
  onFailure:   'fail_mission' | 'skip' | 'retry' | 'gate'
}

interface RetryPolicy {
  maxRetries:  number
  backoffMs:   number            // base do backoff exponencial
  maxBackoffMs: number
}

// Estado de execução do DAG (persiste no Redis durante execução)
interface WorkflowState {
  missionId:   string
  steps:       Record<string, StepExecutionState>
  currentStep?: string
  checkpointAt: Date
}

interface StepExecutionState {
  status:     StepStatus
  startedAt?: Date
  endedAt?:   Date
  retries:    number
  output?:    unknown
  error?:     string
}
```

**Templates de workflow pré-definidos:**
```typescript
const WORKFLOW_TEMPLATES: Record<MissionType, WorkflowStepTemplate[]> = {
  'implementation': [
    { key: 'context',    executor: 'ai',    dependsOn: [] },
    { key: 'plan',       executor: 'ai',    dependsOn: ['context'] },
    { key: 'implement',  executor: 'skill', dependsOn: ['plan'], onFailure: 'retry' },
    { key: 'test',       executor: 'skill', dependsOn: ['implement'] },
    { key: 'review',     executor: 'ai',    dependsOn: ['test'] },
    { key: 'document',   executor: 'ai',    dependsOn: ['review'] },
  ],
  'debugging': [
    { key: 'reproduce',  executor: 'skill', dependsOn: [] },
    { key: 'analyze',    executor: 'ai',    dependsOn: ['reproduce'] },
    { key: 'fix',        executor: 'skill', dependsOn: ['analyze'], onFailure: 'retry' },
    { key: 'verify',     executor: 'skill', dependsOn: ['fix'] },
  ],
}
```

---

## Dependências

- **001 — Mission Engine**: DAG é a implementação interna do `Mission.steps`
- **006 — Skill Engine**: executa steps do tipo `skill`
- **011 — Specialists**: executa steps do tipo `ai` (especialistas)
- **014 — Human Approval Gates**: steps com `onFailure: 'gate'`
- **010 — Observability**: cada step é um span rastreado

---

## Fase de Implementação

**Fase 3** — após Mission Engine básico (sequencial) estar funcionando.

Ordem:
1. `WorkflowEngine` — executor de DAG sobre `MissionStep[]`
2. Resolução de dependências: topological sort para definir ordem
3. Execução paralela via `Promise.all` de steps sem dependências
4. Retry com backoff exponencial
5. Checkpoint de estado no Redis
6. Rollback (Fase 4 — apenas para skills reversíveis)
7. Workflow templates (Fase 4)
