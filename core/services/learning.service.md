# Learning Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Apoiar o desenvolvimento contínuo do Marcelo — inglês técnico, preparação para entrevistas, estudos de arquitetura e absorção de novos conteúdos — com contexto persistente entre sessões.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `retrieve_context` | Buscar o que já foi estudado sobre um tema |
| `summarize_session` | Fechar sessão de estudo com síntese rastreável |
| `generate_documentation` | Criar resumo, flashcard, nota de estudo |

---

## Agentes

- **context-agent** (primário) — recupera e comprime conhecimento acumulado

---

## Skills utilizadas

- `retrieve_project_context` — busca o que já foi estudado sobre o tema
- `summarize_session` — sintetiza sessão de estudo e grava na memória
- `generate_documentation` — cria resumo estruturado, nota ou flashcard
- `index_failure_pattern` — registra conceitos mal compreendidos para revisão

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| memory-engine | Buscar e indexar conhecimento acumulado | low |
| filesystem | Salvar resumo, nota, flashcard | low |
| litellm | Explicar, sintetizar, traduzir conteúdo | low |

---

## Critérios de sucesso

- [ ] Sessão de estudo fechada com resumo indexado na memória
- [ ] Conceito novo registrado com link ao contexto onde apareceu
- [ ] Progresso rastreável entre sessões (sem redescobrir o mesmo)

---

## Limites

```
✗ Não injetar contexto de estudo em sessão de desenvolvimento
✗ Não guardar conteúdo de curso completo — apenas síntese relevante
```
