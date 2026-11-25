# QA Service
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0

---

## Objetivo

Transformar critérios de aceite em testes verificáveis, rastreáveis e com evidência — indexando padrões de falha para evitar regressão futura.

---

## Intenções cobertas

| IntentType | Descrição |
|---|---|
| `create_test` | Criar testes automatizados a partir de critério |
| `run_tests` | Executar suite e capturar resultado |
| `analyze_failure` | Analisar falhas, logs, JUnit |

---

## Agentes

- **qa-agent** (primário) — cria e executa testes, analisa critérios
- **failure-agent** (suporte) — analisa logs e JUnit, indexa padrões de falha

---

## Skills utilizadas

- `retrieve_project_context` — busca histórico de falhas e testes existentes
- `create_test_case` — gera teste a partir de critério de aceite
- `run_test_suite` — executa testes e captura resultado
- `parse_junit_result` — interpreta JUnit XML
- `index_failure_pattern` — grava padrão de falha na memória long_term

---

## Ferramentas permitidas

| Ferramenta | Uso | Risco |
|---|---|---|
| filesystem | Ler arquivos de teste e produção | low |
| terminal | Executar suite de testes (apenas local) | medium |
| memory-engine | Buscar padrões de falha históricos, indexar novos | low |
| github | Ler diff para escopo de teste | low |
| litellm | Gerar asserções e casos de borda | low |

---

## Critérios de sucesso

- [ ] Teste criado cobre o critério de aceite especificado
- [ ] Suite executada sem quebrar testes existentes
- [ ] Evidência gerada (JUnit XML ou relatório)
- [ ] Resultado registrado na memória
- [ ] Falha indexada se houver (pattern + contexto)

---

## Limites

```
✗ Não rodar suite em ambiente de produção
✗ Não alterar regra de negócio sem aprovação
✗ Não apagar testes sem substituição equivalente
✗ Não marcar teste como passando sem evidência real
```

---

## Métricas

- Cobertura de critérios de aceite por feature
- Taxa de falso-positivo em testes gerados por IA
- Padrões de falha recorrentes indexados
- Tempo médio de análise de falha (failure-agent)
