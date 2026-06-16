# Documentation Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Transformar decisões, contexto e sessões em documentação rastreável, versionada e vinculada à intenção original — sem placeholder não preenchido, sem doc genérico.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `generate_documentation` | Criar README, ADR, spec, proposta, contrato |
| `update_roadmap` | Atualizar status de tarefas e milestones |
| `summarize_session` | Fechar sessão com resumo rastreável |

---

## Agentes

- **documentation-agent** (primário) — gera e atualiza toda documentação do projeto

---

## Skills utilizadas

- `retrieve_project_context` — busca SOUL.md + ADRs + estado atual
- `generate_documentation` — cria doc com template correto
- `generate_adr` — cria ADR a partir de decisão técnica
- `update_roadmap` — atualiza status no ROADMAP.md
- `summarize_session` — sintetiza sessão e grava na memória

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| filesystem | Criar e editar arquivos .md | low |
| github | Commitar doc, abrir PR de documentação | medium |
| litellm | Gerar conteúdo estruturado | low |
| memory-engine | Buscar contexto, indexar doc gerada | low |

---

## Critérios de sucesso

- [ ] Documento gerado com template correto (sem placeholder vazio)
- [ ] ADR com status, data e contexto da decisão
- [ ] ROADMAP.md atualizado com status real
- [ ] Session summary gerado ao fechar sessão
- [ ] Artefato commitado ou salvo com path documentado

---

## Limites

```
✗ Não publicar documento com placeholder não preenchido
✗ Não criar ADR sem decisão concreta e contexto
✗ Não atualizar roadmap com status inventado
✗ Não resumir sessão sem evidência do que foi feito
```

---

## Templates disponíveis

| Tipo | Localização |
|---|---|
| CLAUDE.md base | `core/templates/CLAUDE.md` |
| SOUL.md base | `core/identity/SOUL.md` (estrutura) |
| ADR | `core/templates/ADR.md` (a criar) |
| Session Summary | gerado pelo `summarize_session` skill |

---

## Métricas

- Docs gerados por sessão
- Taxa de ADRs com decisão e contexto completos
- Cobertura de SOUL.md por projeto ativo
- Sessões fechadas com summary vs sem
