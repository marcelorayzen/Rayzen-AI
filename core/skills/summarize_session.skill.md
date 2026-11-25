# Skill: summarize_session
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Risco: low | Agente: documentation-agent, context-agent

---

## Objetivo

Fechar a sessão com um resumo rastreável que alimenta a memória do Rayzen — sem perder o fio entre sessões, sem inventar o que foi feito.

---

## Entrada

| Campo | Tipo | Descrição |
|---|---|---|
| `projectId` | string | ID do projeto no Rayzen |
| `sessionEvents` | string[] | Decisões, mudanças e ações desta sessão |
| `filesModified` | string[] | Arquivos criados ou alterados |
| `decisionsMode` | string[] | Decisões técnicas ou arquiteturais tomadas |
| `nextSteps` | string[] | O que ficou pendente para próxima sessão |

---

## Saída

```typescript
{
  summary: string;            // resumo em Markdown (< 500 tokens)
  memoryEntries: Array<{
    scope: 'short_term' | 'long_term';
    content: string;
    tags: string[];
  }>;
  checkpointCalled: boolean;  // true se rayzen_checkpoint() foi executado
  planningUpdated: boolean;   // true se rayzen_update_planning() foi executado
}
```

---

## Ferramentas usadas

- `mcp` — `rayzen_checkpoint()`, `rayzen_update_planning()`, `rayzen_add_event()`
- `memory-engine` — indexar summary e decisões na memória
- `litellm` — sintetizar log da sessão em summary comprimido

---

## Pré-condições

- Executar apenas quando a sessão está se encerrando
- `filesModified` deve ser real — não inventar arquivos não alterados
- Se nenhum arquivo foi modificado e nenhuma decisão foi tomada → summary mínimo apenas

---

## Protocolo de encerramento (ordem obrigatória)

```
1. Listar o que foi feito (filesModified + decisionsMode)
2. Gerar summary em Markdown
3. rayzen_add_event(type: 'decision', ...) para cada decisão significativa
4. rayzen_checkpoint() → fecha o loop (state + docs + Universe)
5. rayzen_update_planning() → atualiza nextSteps se mudaram
6. Indexar summary na memória (short_term: 7d)
```

---

## Critérios de sucesso

- [ ] Summary tem: o que foi feito, decisões tomadas, próximos passos
- [ ] Nenhum placeholder ou "a definir" no summary
- [ ] `rayzen_checkpoint()` chamado se código foi modificado
- [ ] Memória indexada com scope correto
- [ ] Próxima sessão pode continuar de onde esta parou sem re-descoberta

---

## Posição no fluxo

```
Execução → Result Validator → Memory Writer → [summarize_session] → fim
```

---

## Quando NÃO chamar

- Sessões de leitura apenas (sem código modificado, sem decisão tomada)
- Sessões interrompidas antes de qualquer ação concreta
