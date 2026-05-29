# 008 — QA Engine

## Visão Geral

O QA Engine valida automaticamente as entregas de cada missão. Na V2, toda missão de tipo `implementation` ou `debugging` tem um step implícito de validação. O QA Engine integra testes automatizados, qualidade de dados e análise de regressão em um pipeline unificado.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/qa/` | Parse de relatórios JUnit/Allure, armazena `TestRun` |
| `apps/api/src/modules/data-quality/` | Regras (not_null, unique, range, freshness), resultados, score |
| `apps/api/src/modules/health/` | Score 0-100 de saúde do projeto (activity, documentation, consistency) |
| `apps/agent/src/actions/run-tests.ts` | Executa jest/vitest/pytest/playwright/maven |
| `apps/agent/src/actions/parse-test-report.ts` | Parseia relatório e envia para API |
| `apps/agent/src/actions/capture-test-failure.ts` | Screenshot + log de falha como evidência |

**O que já funciona:**
- Execução e parse de testes funcional
- Regras de qualidade de dados com score
- Evidências de falha (screenshots)

**Gap principal:** Resultados de QA não impactam o status de missões — são dados isolados sem consequência no fluxo de execução.

---

## Gaps

- Linkagem `TestRun → MissionStep`: step de validação bloqueia próximo step se falhar
- Trend analysis: detectar piora de cobertura, tempo de execução ou flakiness
- SLA definitions: por projeto, definir % mínimo de aprovação para missão ser marcada como done
- Detecção de regressão: comparar TestRun atual vs. N anteriores
- Data quality como gate: missões que tocam dados precisam passar pela data quality check
- Dashboard V2 com visão integrada (testes + qualidade + health)

---

## Interface / Endpoints

```
POST /v2/qa/run/:missionId      # Dispara QA para missão (executa + valida)
GET  /v2/qa/results/:missionId  # Resultados de QA da missão
POST /v2/qa/reports/ingest      # Ingesta relatório externo (mantém V1)
GET  /v2/qa/trend/:projectId    # Tendência de qualidade ao longo do tempo
GET  /v2/qa/sla/:projectId      # SLAs definidos e status atual
POST /v2/qa/sla/:projectId      # Define SLA de QA
```

---

## Modelo de Dados

```typescript
interface QASla {
  id:            string
  projectId:     string
  minPassRate:   number     // % mínimo de testes passando (ex: 0.95)
  maxFlakeRate:  number     // % máximo de flaky tests (ex: 0.05)
  maxDurationMs: number     // tempo máximo de suite (ex: 120000)
  appliesTo:     MissionType[]
}

interface QAGateResult {
  missionId: string
  stepId:    string
  passed:    boolean
  slaViolations: string[]
  regressions:   string[]   // testes que passavam e agora falham
  summary:   string         // texto gerado por LLM
}

// Evolução de TestRun existente
interface TestRunV2 extends TestRun {
  missionId?:   string
  stepId?:      string
  isRegression: boolean
  regressions:  string[]
  qaSlaId?:     string
  gatePassed?:  boolean
}
```

---

## Dependências

- **001 — Mission Engine**: QA Gate bloqueia/libera transição de status de step
- **006 — Skill Engine**: skill `run_tests` é chamada pelo QA Engine
- **003 — AI Router**: tier 2 para gerar summary de QA
- **010 — Observability**: correlaciona falhas de QA com eventos de missão

---

## Fase de Implementação

**Fase 3** — após Mission Engine e Skill Engine.

Ordem:
1. `QAEngineService` — encapsula `qa/` e `data-quality/` existentes
2. Linkagem `TestRun.missionId` (migration Prisma)
3. QA Gate no Mission Engine (pré-condição para `step:done`)
4. SLA definitions (`QASla` model)
5. Trend analysis e detecção de regressão
