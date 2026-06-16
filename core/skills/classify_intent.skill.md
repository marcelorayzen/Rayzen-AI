# Skill: classify_intent
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Risco: low | Agente: context-agent, business-agent

---

## Objetivo

Categorizar a intenção bruta do usuário em um `IntentType` estruturado — antes de qualquer roteamento para Service ou Agent.

---

## Entrada

| Campo | Tipo | Descrição |
|---|---|---|
| `rawInput` | string | Input bruto do usuário (texto livre) |
| `projectId` | string | Projeto atual (para contexto de histórico) |
| `sessionContext?` | string | Contexto da sessão atual (opcional) |

---

## Saída

```typescript
{
  intentType: IntentType;      // categoria classificada
  confidence: number;          // 0.0 a 1.0
  reasoning: string;           // uma frase explicando a classificação
  ambiguous: boolean;          // true se input admite mais de uma interpretação
  clarificationNeeded?: string; // pergunta a fazer se ambiguous = true
}
```

---

## IntentTypes disponíveis

```typescript
type IntentType =
  | 'generate_code'
  | 'review_code'
  | 'create_test'
  | 'run_tests'
  | 'analyze_failure'
  | 'generate_documentation'
  | 'update_roadmap'
  | 'retrieve_context'
  | 'classify_intent'
  | 'create_architecture'
  | 'client_discovery'
  | 'deploy'
  | 'database_migration'
  | 'summarize_session'
  | 'request_approval'
```

---

## Ferramentas usadas

- `litellm` — classificação via LLM (model: gpt-4o-mini, temperature: 0)

---

## Pré-condições

- `rawInput` não pode estar vazio
- Se `ambiguous = true` → retornar `clarificationNeeded` antes de rotear

---

## Critérios de sucesso

- [ ] IntentType retornado pertence ao enum definido
- [ ] Confidence ≥ 0.7 para seguir sem clarificação
- [ ] Se confidence < 0.7 → `ambiguous: true` + pergunta de clarificação
- [ ] Classificação não inventa intenção não presente no input

---

## Posição no fluxo

```
Input bruto → [classify_intent] → JARVISHealthCheck → Service Router → ...
```
