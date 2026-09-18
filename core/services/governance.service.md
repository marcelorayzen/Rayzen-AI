# Governance Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Garantir que o Rayzen opere com integridade — memória consistente, lineage rastreável, impacto avaliado antes de cada ação e aprovação humana no ponto certo.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `retrieve_context` | Buscar e comprimir contexto relevante para a sessão |
| `request_approval` | Acionar aprovação humana para ação de alto risco |
| `summarize_session` | Fechar loop: state + docs + memória |
| `classify_intent` | Classificar e rotear intenção bruta |

---

## Agentes

- **context-agent** (primário) — recupera, comprime e injeta contexto correto
- **security-agent** (suporte) — valida permissões, classifica risco, aciona aprovação

---

## Skills utilizadas

- `retrieve_project_context` — contexto cirúrgico por query + projectId
- `classify_intent` — classifica intenção bruta antes do roteamento
- `request_human_approval` — gate de aprovação para ações high risk
- `summarize_session` — fecha a sessão com checkpoint no Rayzen
- `index_failure_pattern` — registra incidentes e decisões de governança

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| memory-engine | Buscar e gravar contexto, decisões, incidentes | low |
| mcp | Chamar Rayzen MCP (get_context, checkpoint, add_event) | low |
| litellm | Classificar intenção, comprimir contexto | low |

---

## Responsabilidades do Governance Service

### Memória
- Garantir escopo correto (session / short_term / long_term)
- Evitar duplicação de contexto já indexado
- Marcar `shouldNotStore: true` para dados sensíveis

### Lineage
- Toda decisão significativa → `rayzen_add_event(type: 'decision')`
- Toda sessão com código modificado → `rayzen_checkpoint()`
- Mudanças de planejamento → `rayzen_update_planning()`

### Aprovação
- Identificar ações high risk antes de executar
- Criar ApprovalGate no Rayzen para ações destrutivas
- Aguardar confirmação — nunca contornar por eficiência

---

## Critérios de sucesso

- [ ] Contexto relevante recuperado sem ruído de outros projetos
- [ ] Todas as decisões significativas registradas como eventos
- [ ] Sessão fechada com checkpoint quando código foi modificado
- [ ] Nenhuma ação high risk executada sem ApprovalGate

---

## Limites

```
✗ Não injetar contexto de projeto diferente sem solicitação
✗ Não incluir dados sensíveis no contexto injetado
✗ Não aprovar ação high risk automaticamente
✗ Não pular checkpoint ao fechar sessão com mudanças reais
```

---

## Referências

- `core/safety/security-wall.md` — taxonomia completa de risco
- `CLAUDE.local.md` — protocolo de sessão Claude Code ↔ Rayzen
- ApprovalGates: `GET /v2/approval-gates` (api-v2)
- Checkpoint MCP: `rayzen_checkpoint()`
