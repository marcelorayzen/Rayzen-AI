# Descoberta e diagnóstico — roteiro de apoio

Carregue quando a ideia for vaga ou o problema não estiver claro. Use o que ajuda; não
aplique tudo por obrigação.

## Descoberta — uma pergunta por vez, nesta ordem aproximada

1. **Motivação** — por que isto precisa existir agora? O que acontece se nada for feito?
2. **Problema** — o que acontece hoje × o que deveria acontecer; quem sofre; com que
   frequência; que evidência existe.
3. **Pessoas e sistemas** — quem usa, quem administra, quem decide, que sistemas tocam.
4. **Estado atual** — processos, sistemas, dados e ferramentas que já existem.
5. **Estado desejado** — resultado esperado, capacidades, indicador de sucesso.
6. **Restrições** — prazo, orçamento, infraestrutura, quem mantém, privacidade, legal.

**Suficiente quando:** resultado esperado claro, problema principal definido, pessoas
importantes identificadas, restrições conhecidas, desconhecidos críticos registrados.

## Diagnóstico — saída obrigatória

Enunciado do problema · estado atual · estado desejado · hipóteses de causa (marcadas como
hipótese) · evidências · restrições · impacto · desconhecidos · critérios de sucesso.

## Métodos (escolha os que servem)

| método | use quando |
|---|---|
| **Kidlin** | o problema está difuso — escreva-o numa frase clara |
| **5 porquês** | há um sintoma e é preciso chegar à causa |
| **Primeiros princípios** | a solução "óbvia" é cópia de algo que talvez não sirva |
| **Navalha de Occam** | duas explicações competem — prefira a mais simples que cabe nos fatos |
| **Pareto** | muitos problemas — ache os poucos de maior impacto |
| **Murphy / FMEA** | antecipar como vai falhar e o que custa cada falha |
| **Bayes** | atualizar hipóteses à medida que chega evidência |
| **Goodhart** | a métrica de sucesso pode ser "batida" sem resolver o problema |
| **Pensamento sistêmico** | a mudança mexe em outros processos/sistemas |
| **Lean** | há trabalho que não gera valor e pode sair |

## Escolha da arquitetura — opções, não padrão

Monólito modular · Clean/Hexagonal · DDD · orientada a eventos · microsserviços ·
centrada em dados · agêntica · serverless. Para cada uma considerada: por que serve, por que
não, custo de manutenção. A recomendação padrão para quem mantém sozinho é **monólito
modular** até haver evidência de que não basta.

## Especializações por domínio

- **Web**: frontend, backend, API, banco, UX, acessibilidade, auth, deploy, E2E.
- **API**: contratos, validação, versionamento, persistência, observabilidade, testes de integração.
- **IA**: modelo, contexto, ferramentas, permissões, memória, avaliação (evals), guardrails, custo.
- **Dados**: ingestão, contratos de dados, qualidade, metadados, linhagem, acesso, auditoria.
- **Automação**: gatilhos, idempotência, retentativas, segredos, monitoramento, recuperação.
