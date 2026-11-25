# Skill: retrieve_project_context
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Risco: low | Agente: context-agent

---

## Objetivo

Buscar e comprimir o contexto mais relevante do projeto para a sessão atual — sem ruído de outros projetos, dentro do token budget.

---

## Entrada

| Campo | Tipo | Descrição |
|---|---|---|
| `projectId` | string | ID do projeto no Rayzen |
| `query` | string | Intenção ou tarefa da sessão (para busca semântica) |
| `mode` | string | `implementation`, `debugging`, `architecture`, `planning` |
| `tokenBudget?` | number | Limite de tokens para o contexto (default: 2000) |

---

## Saída

```typescript
{
  text: string;                    // contexto comprimido pronto para injetar
  sources: string[];               // IDs das memórias e docs usados
  projectState: ProjectState;      // estado atual do projeto
  relevantMemories: MemoryEntry[]; // memórias semânticas relevantes
  truncated: boolean;              // true se contexto foi cortado para caber no budget
}
```

---

## Ferramentas usadas

- `memory-engine` — busca semântica por embedding (pgvector)
- `mcp` — `rayzen_get_context(mode, query)` e `rayzen_get_state()`
- `litellm` — compressão se contexto exceder token budget

---

## Pré-condições

- `projectId` deve existir no Rayzen
- `query` não pode ser vazia (sem query = contexto genérico = ruído)
- Não injetar contexto de outro `projectId` sem solicitação explícita

---

## Critérios de sucesso

- [ ] Contexto retornado é relevante para a query (não genérico)
- [ ] Nenhum dado sensível incluído (senhas, tokens, PII)
- [ ] Token budget respeitado (truncar com aviso se necessário)
- [ ] `sources` preenchido para rastreabilidade

---

## Mapeamento para o hook

Esta skill é executada automaticamente pelo hook `UserPromptSubmit` via:
```javascript
rayzen_get_context(mode, query)  // contexto cirúrgico
```
Cache de 5 min para reduzir custo por prompt.

---

## Posição no fluxo

```
... → JARVISHealthCheck → [retrieve_project_context] → Intent Contract Builder → ...
```
