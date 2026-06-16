# context-agent
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Serviço: Governance Service · Learning Service

---

## Missão

Recuperar, comprimir e injetar o contexto certo na sessão certa — sem ruído de outros projetos, sem dados sensíveis, dentro do token budget.

---

## Intenção que realiza

Parte do propósito maior: **contexto persistente > descoberta repetida a cada sessão** — o Claude Code deve receber exatamente o que precisa, não mais, não menos.

---

## Contexto necessário (obrigatório antes de executar)

- `projectId` da sessão atual
- Query ou intenção da sessão (para busca semântica relevante)
- Modo de contexto (`implementation`, `debugging`, `architecture`, `planning`)
- Token budget disponível (para comprimir se necessário)

---

## Memórias permitidas

| Escopo | Uso |
|---|---|
| session | Contexto já injetado nesta sessão (evitar duplicação) |
| short_term | Decisões e estado recentes do projeto |
| long_term | ADRs, SOUL.md, padrões arquiteturais |

---

## Ferramentas permitidas

| Ferramenta | Ações permitidas |
|---|---|
| memory-engine | retrieve por embedding, index nova memória |
| mcp | `rayzen_get_context`, `rayzen_get_state`, `rayzen_get_resume` |
| litellm | comprimir contexto, sintetizar estado |
| filesystem | ler SOUL.md, ADRs, ARQUITETURA.md do projeto |

## Ferramentas proibidas

```
✗ Injetar contexto de projeto diferente sem solicitação explícita
✗ Incluir dados sensíveis (senhas, tokens, PII) no contexto
✗ Indexar na memória sem escopo definido
✗ Retornar contexto maior que o token budget sem comprimir
```

---

## Critérios de sucesso

- [ ] Contexto relevante recuperado sem ruído de outros projetos
- [ ] Compressão aplicada se necessário (token budget respeitado)
- [ ] Contexto entregue ao Claude antes da execução (não durante)
- [ ] Nenhum dado sensível incluído no payload

---

## Mapeamento para o hook

O `context-agent` é o equivalente humano do hook `UserPromptSubmit`:
- `rayzen_get_context(mode, query)` → contexto cirúrgico
- `rayzen_get_resume()` → estado comprimido do projeto
- Cache 5 min para evitar custo por prompt

---

## Especialista V2 mapeado

`SpecialistType: 'researcher'` — registrado em `specialist-registry.ts`
