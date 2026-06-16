# Development Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Transformar intenção técnica em código, arquitetura e revisão verificáveis — com contexto do projeto, ADRs e critério de sucesso claros antes de qualquer execução.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `generate_code` | Gerar ou refatorar código |
| `review_code` | Revisar, inspecionar, auditar |
| `create_architecture` | Desenhar ou decidir arquitetura |
| `inspect_repository` | Mapear arquivos impactados por mudança |
| `generate_execution_plan` | Montar plano antes de executar |

---

## Agentes

- **code-agent** (primário) — gera, refatora, revisa código
- **context-agent** (suporte) — recupera contexto arquitetural relevante

---

## Skills utilizadas

- `retrieve_project_context` — busca SOUL.md + ADRs + estado atual
- `inspect_repository` — mapeia arquivos impactados
- `generate_execution_plan` — plano antes de executar
- `generate_code` — geração ou refatoração
- `review_code` — revisão com critério de aceitação

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| filesystem | Ler e escrever arquivos do projeto | medium |
| github | Criar branch, PR, inspecionar diff | medium |
| terminal | Rodar build, lint, typecheck | medium |
| litellm | Geração e revisão de código | low |
| memory-engine | Buscar contexto, indexar decisões | low |

---

## Critérios de sucesso

- [ ] Código gerado e revisado antes de commit
- [ ] Testes existentes continuam passando após mudança
- [ ] Nenhuma violação de ADR vigente
- [ ] Artefato registrado na memória (short_term ou long_term)
- [ ] Branch e PR criados com descrição clara

---

## Limites

```
✗ Não alterar banco de produção diretamente
✗ Não force push em main ou branch protegida
✗ Não apagar arquivos sem backup confirmado
✗ Não deploy sem aprovação explícita
✗ Não ignorar ADRs vigentes sem registrar novo ADR
```

---

## Métricas

- Tempo médio de geração de código por intenção
- Taxa de revisão sem retrabalho
- Violações de ADR detectadas pós-geração
