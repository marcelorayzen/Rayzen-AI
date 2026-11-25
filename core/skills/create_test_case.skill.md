# Skill: create_test_case
> Versão: 1.0 | Atualizado: 2026-06-15 | RIOM v1.0
> Risco: medium | Agente: qa-agent

---

## Objetivo

Gerar teste automatizado a partir de critério de aceite — com asserção real, cobertura do caso de borda mais crítico e sem duplicar teste já existente.

---

## Entrada

| Campo | Tipo | Descrição |
|---|---|---|
| `criterio` | string | Critério de aceite ou comportamento esperado |
| `arquivo` | string | Path do arquivo/módulo a testar |
| `testType` | string | `unit`, `integration`, `e2e` |
| `existingTests?` | string[] | Paths de testes já existentes (para evitar duplicação) |
| `failurePatterns?` | string[] | Padrões de falha históricos relevantes |

---

## Saída

```typescript
{
  testFilePath: string;       // onde o arquivo de teste foi criado
  testCode: string;           // código do teste gerado
  coveredCriteria: string[];  // critérios cobertos por este teste
  edgeCases: string[];        // casos de borda identificados
  notCovered: string[];       // o que este teste NÃO cobre (transparência)
}
```

---

## Ferramentas usadas

- `filesystem` — ler arquivo-alvo, escrever arquivo de teste
- `litellm` — gerar asserções, identificar casos de borda
- `memory-engine` — buscar padrões de falha históricos relacionados

---

## Convenções de teste do projeto

| Tipo | Framework | Localização | Comando |
|---|---|---|---|
| Unit (api) | Jest | `apps/api/src/**/*.spec.ts` | `pnpm --filter api test` |
| E2E (api) | Jest + supertest | `apps/api/test/` | `pnpm --filter api test:e2e` |
| Unit (web) | Vitest | `apps/web/**/*.test.ts` | a definir |

---

## Pré-condições

- Critério de aceite deve ser específico (não "deve funcionar")
- Arquivo-alvo deve existir
- `testType` deve ser compatível com o ambiente disponível
- Não rodar o teste em produção

---

## Critérios de sucesso

- [ ] Teste criado no path correto para o tipo
- [ ] Teste roda sem erro de configuração
- [ ] Asserção cobre o critério de aceite especificado
- [ ] Testes existentes não foram quebrados
- [ ] Resultado indexado na memória com evidência

---

## Posição no fluxo

```
qa-agent recebe step → [create_test_case] → run_test_suite → parse_junit_result → index_failure_pattern
```
