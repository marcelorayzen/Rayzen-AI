# Qualidade — {{nome}}

Definido antes de implementar: como saberemos que funciona.

## Verificação mínima (todo commit)

{{comando}} e `git diff --check` — o mesmo que o `AGENTS.md` exige e o
`.github/workflows/quality.yml` roda.

## Estratégia de teste

| nível | o que cobre | ferramenta |
|---|---|---|
| unitário | {{regras de domínio, cálculos}} | {{…}} |
| integração | {{API, banco, contratos}} | {{…}} |
| ponta a ponta | {{fluxos críticos do usuário}} | {{…}} |

## Critérios de aceite por entrega

- Comportamento descrito em `docs/CONTRATO-*.md` coberto por teste determinístico.
- Defeito corrigido ganha teste que falhava antes (prova vermelha).
- {{acessibilidade, desempenho, segurança — o que se aplica}}

## Avaliação de IA (se houver)

{{casos com resposta esperada em `evals/`, que o agente nunca vê; métrica; linha de base}}

## O que os testes NÃO provam

{{ex.: build verde não prova deploy; teste local não prova RLS em produção}}
