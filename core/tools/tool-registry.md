# Tool Registry — Rayzen AI
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Princípio: toda ferramenta tem intenções permitidas, ações proibidas e risco declarado.

---

## github

| Campo | Valor |
|---|---|
| **Risco** | medium |
| **Requer aprovação** | não (exceto force push e delete) |
| **Ambientes** | local, staging, production |

**Intenções permitidas:** `generate_code`, `review_code`, `inspect_repository`, `create_test`, `generate_documentation`, `update_roadmap`

**Ações proibidas:**
```
✗ delete_repo
✗ force push em qualquer branch (--force)
✗ push direto em main sem PR
✗ modificar branch protegida sem aprovação
✗ expor secrets em commit
```

---

## terminal

| Campo | Valor |
|---|---|
| **Risco** | high |
| **Requer aprovação** | sim (para qualquer comando em produção) |
| **Ambientes** | local (automático), staging (com log), production (aprovação) |

**Intenções permitidas:** `run_tests`, `generate_code`, `inspect_repository`

**Ações proibidas:**
```
✗ rm -rf sem escopo e backup confirmado
✗ DROP DATABASE em qualquer ambiente
✗ deploy production sem aprovação explícita
✗ kill -9 processo de produção
✗ alterar variáveis de ambiente de produção
✗ rodar script desconhecido sem inspeção prévia
```

**Log obrigatório:** comando completo + saída + exit code

---

## filesystem

| Campo | Valor |
|---|---|
| **Risco** | medium |
| **Requer aprovação** | não (exceto delete) |
| **Ambientes** | local |

**Intenções permitidas:** `generate_code`, `generate_documentation`, `update_roadmap`, `create_test`, `retrieve_context`, `summarize_session`

**Ações proibidas:**
```
✗ path traversal (../) em qualquer operação
✗ delete sem backup confirmado
✗ overwrite sem confirmação se arquivo existir
✗ read de arquivos com secrets (.env, *.pem, *.key)
```

---

## mcp

| Campo | Valor |
|---|---|
| **Risco** | low |
| **Requer aprovação** | não |
| **Ambientes** | local, staging, production |

**Intenções permitidas:** `retrieve_context`, `classify_intent`, `summarize_session`, `request_approval`

**Tools permitidas:**
```
rayzen_get_context       → contexto cirúrgico
rayzen_get_state         → estado do projeto
rayzen_get_resume        → estado comprimido
rayzen_add_event         → registrar decisão/evento
rayzen_checkpoint        → fechar loop de sessão
rayzen_update_planning   → atualizar planejamento
rayzen_capture_learning  → indexar aprendizado na memória
rayzen_search_memory     → busca semântica na Brain
rayzen_blueprint_import  → importar plano externo
```

**Ações proibidas:**
```
✗ acionar tool fora da lista permitida acima
✗ chamar MCP de outro projeto sem projectId explícito
```

---

## n8n

| Campo | Valor |
|---|---|
| **Risco** | high |
| **Requer aprovação** | sempre |
| **Ambientes** | local, staging (nunca produção sem aprovação) |

**Intenções permitidas:** `trigger_n8n_workflow`

**Ações proibidas:**
```
✗ acionar workflow de produção sem aprovação humana
✗ disparar workflow que envia mensagem real sem confirmação
✗ acionar workflow que cobra pagamento automaticamente
✗ criar/deletar workflow sem aprovação
```

---

## memory-engine (pgvector)

| Campo | Valor |
|---|---|
| **Risco** | low |
| **Requer aprovação** | não |
| **Ambientes** | local, staging, production |

**Intenções permitidas:** `retrieve_context`, `summarize_session`, `analyze_failure`

**Escopos de memória:**

| Escopo | TTL | Uso |
|---|---|---|
| session | fim da sessão | contexto imediato |
| short_term | 7 dias | decisões e bugs recentes |
| long_term | permanente | ADRs, padrões, arquitetura |

**Ações proibidas:**
```
✗ guardar senha, token, secret ou PII
✗ sobrescrever memória long_term sem confirmação
✗ indexar conteúdo de outro projeto sem projectId correto
✗ indexar sem escopo definido (shouldNotStore não declarado)
```

---

## litellm

| Campo | Valor |
|---|---|
| **Risco** | low |
| **Requer aprovação** | não |
| **Ambientes** | local, staging, production |

**Intenções permitidas:** `classify_intent`, `generate_code`, `generate_documentation`, `summarize_session`, `review_code`, `create_test`, `retrieve_context`

**Models configurados:**

| Alias | Provider | Uso |
|---|---|---|
| `gpt-4o` | Groq llama-3.3-70b (fallback Claude Sonnet) | geração, análise |
| `gpt-4o-mini` | Groq 8b | classificação, síntese rápida |
| `gpt-4o-premium` | Claude Sonnet direto | tasks complexas |

**Ações proibidas:**
```
✗ apontar direto para OpenAI/Anthropic/Groq (sempre via LiteLLM proxy)
✗ usar modelo fora do orçamento sem alerta de custo
✗ usar response_format: json_object com Claude (não suportado — usar extração robusta)
```

**Obrigatório em toda chamada:** logar `tokens_used` e `duration_ms`.

---

## Resumo de risco por ferramenta

| Ferramenta | Risco | Aprovação obrigatória? |
|---|---|---|
| memory-engine | low | não |
| mcp | low | não |
| litellm | low | não |
| filesystem | medium | somente para delete |
| github | medium | somente para force push |
| terminal | high | sim, para staging/production |
| n8n | high | sempre |
