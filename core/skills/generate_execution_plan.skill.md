# Skill: generate_execution_plan
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Risco: low | Agente: code-agent, business-agent

---

## Objetivo

Montar um plano de execução ordenado e verificável antes de qualquer ação — artefato primeiro, código depois.

---

## Entrada

| Campo | Tipo | Descrição |
|---|---|---|
| `intentContract` | IntentContract | Contrato completo da sessão |
| `contextText` | string | Contexto do projeto já recuperado |
| `constraints?` | string[] | Restrições adicionais (ADRs, limites de tempo) |

---

## Saída

```typescript
{
  steps: Array<{
    order: number;
    title: string;
    description: string;
    skillsNeeded: string[];
    riskLevel: 'low' | 'medium' | 'high';
    dependsOn?: number[];    // índice dos steps anteriores que bloqueiam este
    expectedOutput: string;  // o que este step entrega
    successCriteria: string; // como saber que este step terminou
  }>;
  estimatedSteps: number;
  hasHighRiskStep: boolean;  // true se qualquer step é high risk
  approvalNeeded: boolean;   // true se algum step requer aprovação
}
```

---

## Ferramentas usadas

- `litellm` — geração do plano (model: gpt-4o, temperature: 0.2)
- `memory-engine` — buscar planos similares anteriores para reutilizar

---

## Pré-condições

- `IntentContract` deve ter `successCriteria` preenchidos
- `contextText` não pode estar vazio (plano sem contexto = chute)
- Se `hasHighRiskStep = true` → declarar ao Marcelo antes de executar

---

## Critérios de sucesso

- [ ] Steps são ordenados com dependências claras
- [ ] Cada step tem `expectedOutput` e `successCriteria` específicos
- [ ] Steps high risk identificados e declarados antes da execução
- [ ] Plano pode ser convertido em MissionSteps no Rayzen V2

---

## Integração com V2

Os steps gerados aqui podem ser criados como `MissionStep` via:
```
POST /v2/missions/:id/steps
```
Para execução automática pelo `StepExecutorService`.

---

## Posição no fluxo

```
... → Intent Contract Builder → [generate_execution_plan] → Risk Evaluator → Claude Code Delivery
```
