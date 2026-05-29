# 011 — Specialists (Especialistas Dinâmicos)

## Visão Geral

Especialistas são agentes de AI temporários, instanciados sob demanda para tarefas específicas dentro de uma missão. Cada especialista tem um system prompt focado, ferramentas limitadas ao necessário e um ciclo de vida curto — é destruído após concluir sua tarefa.

Inspirados no padrão de sub-agentes do Claude Code e nos workers do OpenHands.

---

## Mapeamento V1

| Componente V1 | Sobreposição |
|---|---|
| `apps/agent/src/actions/supervised-session.ts` | Única forma atual de agente autônomo — loop Claude API com até 20 iterações, tools hardcoded |

**Problema na V1:** `supervised-session` é uma ação única e genérica. Não há especialização por domínio, sem isolamento de contexto entre especialistas, sem lifecycle gerenciado pelo sistema.

---

## Gaps

- `SpecialistRegistry`: catálogo de tipos de especialistas (coder, reviewer, tester, architect, researcher)
- Instanciação dinâmica: especialista criado para um step, destruído ao concluir
- Isolamento de contexto: cada especialista vê apenas o que é relevante para sua tarefa
- Human approval gate para especialistas com risco alto
- Limite de iterações e custo por especialista
- Resultado do especialista gravado como output do step da missão

---

## Interface / Endpoints

```
POST /v2/specialists/spawn          # Instancia especialista para uma tarefa
GET  /v2/specialists/:id            # Status do especialista ativo
POST /v2/specialists/:id/interrupt  # Interrompe especialista
GET  /v2/specialists/types          # Lista tipos disponíveis
```

---

## Modelo de Dados

```typescript
type SpecialistType =
  | 'coder'       // implementa código
  | 'reviewer'    // revisa código
  | 'tester'      // escreve e executa testes
  | 'architect'   // desenha arquitetura
  | 'researcher'  // pesquisa e sintetiza
  | 'debugger'    // depura problemas

interface SpecialistDefinition {
  type:           SpecialistType
  name:           string
  systemPrompt:   string
  allowedSkills:  string[]          // subset do Skill Registry
  maxIterations:  number
  maxCostUsd:     number
  model:          string            // tier recomendado
  requiresApproval: boolean
}

interface SpecialistInstance {
  id:           string
  type:         SpecialistType
  missionId:    string
  stepId:       string
  status:       'running' | 'done' | 'failed' | 'interrupted'
  iterations:   number
  costUsd:      number
  output?:      Record<string, unknown>
  startedAt:    Date
  endedAt?:     Date
}
```

---

## Dependências

- **001 — Mission Engine**: especialistas são instanciados para steps de tipo `executor: 'ai'`
- **006 — Skill Engine**: especialistas chamam skills do registry
- **003 — AI Router**: seleciona modelo para o especialista
- **005 — Context Engine**: monta contexto isolado para o especialista
- **014 — Human Approval Gates**: especialistas de alto risco aguardam aprovação
- **009 — Cost Controller**: limite de custo por instância

---

## Fase de Implementação

**Fase 5** — componente avançado, depende de toda a infraestrutura anterior.

Ordem:
1. `SpecialistRegistry` com definições dos 6 tipos básicos
2. `SpecialistService.spawn()` — adaptado de `supervised-session`
3. Integração com Mission Engine (step spawna especialista)
4. Isolamento de contexto via Context Engine
5. Human approval gate para tipos com risco
6. Multi-especialista paralelo (Fase 5 avançada)
