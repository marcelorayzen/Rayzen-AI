# Rayzen Blueprint Intake Template

Use este template para estruturar qualquer ideia bruta antes de importar no Rayzen AI.

---

## Como usar

Cole o prompt abaixo no ChatGPT ou Claude (fora do VS Code), substitua `[COLE AQUI]` pela sua ideia e receba o Blueprint Markdown pronto.

---

## Prompt completo (estruturação detalhada)

```
Estruture esta ideia no modelo Rayzen Blueprint.

Quero um Blueprint em Markdown pronto para importar no Rayzen AI usando `rayzen_blueprint_import_markdown`.

Use esta estrutura:

# [Nome da Ideia / Feature / Projeto]

## 1. Resumo executivo
Explique em poucas linhas o que é a ideia e por que ela existe.

## 2. Problema
Descreva o problema real que isso resolve.

## 3. Objetivo
Explique o objetivo principal da implementação.

## 4. Contexto atual
Descreva o que já existe no projeto, o que não existe e quais partes serão aproveitadas.

## 5. Solução proposta
Explique a solução de forma prática e técnica.

## 6. Arquitetura
Descreva os módulos, fluxo, camadas e integrações.

## 7. Endpoints / Interfaces
Liste endpoints, comandos, tools MCP, telas ou funções necessárias.

## 8. DTOs / Dados necessários
Liste os campos, payloads, estruturas JSON ou tipos TypeScript necessários.

## 9. Regras de negócio
Liste regras, validações e comportamentos esperados.

## 10. Decisões técnicas
Liste decisões no formato:
- Decidimos usar X porque Y.

## 11. Problemas / riscos
Liste riscos, blockers e pontos de atenção no formato:
- Problema: ...

## 12. Tarefas de implementação
Liste tarefas acionáveis começando com verbos:
- Implementar ...
- Criar ...
- Adicionar ...
- Validar ...
- Testar ...

## 13. Checklist de validação
Liste como validar que está funcionando.

## 14. Próximos passos
Liste a sequência recomendada de execução.

Ideia bruta:
[COLE AQUI]
```

---

## Prompt curto (uso diário rápido)

```
Transforme a ideia abaixo em um Rayzen Blueprint pronto para importar com `rayzen_blueprint_import_markdown`.

Preciso que venha em Markdown com:
Resumo, Problema, Objetivo, Contexto atual, Solução, Arquitetura, Endpoints/Interfaces, Dados/DTOs, Regras, Decisões, Problemas, Tarefas, Checklist e Próximos passos.

Use frases detectáveis pelo parser:
- Decidimos ...
- Problema: ...
- Implementar ...
- Criar ...
- Adicionar ...
- Testar ...

Ideia:
[COLE AQUI]
```

---

## O que o parser detecta automaticamente

| Padrão no Markdown | O que vira no Rayzen |
|---|---|
| `- Implementar ...` / `- Criar ...` / `- Adicionar ...` | nextSteps + backlog |
| `- Decidimos ...` / `- Optamos ...` / `- Aprovado ...` | Evento `decision` |
| `- Problema: ...` / `- Blocker: ...` / `- Issue: ...` | Evento `problem` |
| `## Seção` / `### Subseção` | Página Wiki separada |

---

## Comando para importar no Claude Code (VS Code)

Depois de gerar o Markdown, cole no Claude Code:

```
Use rayzen_blueprint_preview com este Markdown e me mostre o que será criado antes de importar.

title: "[TÍTULO]"
markdown:
"""
[MARKDOWN COMPLETO]
"""
```

Se o preview estiver correto:

```
Agora importe usando rayzen_blueprint_import_markdown.
```
