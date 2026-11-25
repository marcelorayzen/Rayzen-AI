# Arquitetura — {{nome}}

## Visão

{{estilo escolhido (ex.: monólito modular) e por que é o mais simples que atende}}

```
{{diagrama em texto: módulos, fluxo de dados, integrações}}
```

## Módulos e responsabilidades

| módulo | responsabilidade | depende de |
|---|---|---|
| {{…}} | {{…}} | {{…}} |

## Dados, integrações e segurança

- **Persistência:** {{…}} · **Integrações externas:** {{…}}
- **Autenticação/autorização:** {{…}}
- **Falhas:** {{o que acontece quando X cai; idempotência; retentativa}}
- **Observabilidade:** {{logs, métricas, alertas}}

## Tecnologias

| tecnologia | para quê | por que | alternativa considerada |
|---|---|---|---|
| {{…}} | {{…}} | {{…}} | {{…}} |

## Deploy

{{onde roda e como publica — detalhes em docs/DEPLOY.md quando existir}}
