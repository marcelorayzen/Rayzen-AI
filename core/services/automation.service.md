# Automation Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Criar e operar automações que conectam o Rayzen ao mundo externo — webhooks, WhatsApp, e-mail, n8n, integrações com APIs de terceiros — sempre com aprovação humana para ações que disparam efeitos reais.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `generate_code` | Criar webhook handler, worker, integração |
| `deploy` | Publicar automação (high risk — aprovação obrigatória) |
| `trigger_n8n_workflow` | Disparar fluxo n8n existente |

---

## Agentes

- **code-agent** (primário) — cria handlers, workers e integrações
- **security-agent** (suporte) — valida permissões e classifica risco antes de disparar

---

## Skills utilizadas

- `generate_code` — handler de webhook, worker BullMQ, cliente de API
- `trigger_n8n_workflow` — disparo de automação externa (high risk)
- `request_human_approval` — aprovação obrigatória antes de qualquer disparo real
- `inspect_repository` — mapear impacto antes de criar nova automação

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| filesystem | Criar handler, worker | low |
| terminal | Rodar worker localmente para teste | medium |
| n8n | Disparar workflow externo | high |
| github | Criar branch e PR de integração | medium |
| litellm | Gerar código de integração | low |

---

## Critérios de sucesso

- [ ] Automação criada e testada em ambiente local antes de produção
- [ ] Aprovação humana registrada para qualquer disparo real
- [ ] Logs de execução registrados (tokensUsed, durationMs, status)
- [ ] Rollback plan documentado antes de ativar em produção

---

## Limites

```
✗ Nunca disparar WhatsApp/e-mail real sem aprovação explícita
✗ Nunca acionar workflow de produção no n8n sem aprovação
✗ Nunca armazenar credentials de API em memória ou brain
✗ Nunca chamar API de pagamento sem dupla confirmação
```

---

## Canais planejados (roadmap)

| Canal | Fase | Status |
|---|---|---|
| Claude Code (terminal) | Atual | Ativo |
| Web Panel (Next.js) | Ciclo 2 | Em progresso |
| WhatsApp / Telegram | Futuro | Planejado |
| E-mail | Futuro | Planejado |
| n8n workflows | Futuro | Planejado |
