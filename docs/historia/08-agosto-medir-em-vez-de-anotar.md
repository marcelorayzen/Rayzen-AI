---
capitulo: 8
titulo: "Agosto — Medir em vez de anotar"
periodo: "2026-08-02 a 2026-08-15"
fontes:
  commits: ["8d08536", "1c4f4f4", "0604de4", "c050f87", "4d30ce3", "440d6ed", "8ef38df", "5aaeadc"]
  docs: ["docs/FROZEN.md", "docs/roadmap.md", "docs/migracao-servidor.md", "CLAUDE.md"]
  memory: ["memory/project_rayzen_audit_2026-08.md", "memory/project_encoding_cleanup.md", "memory/project_token_rotation.md", "memory/reference_vps_ssh.md", "memory/project_benchmark_set_incoherent.md"]
confianca: "alta"
---

# Capítulo 8 — Medir em vez de anotar

Agosto foi o mês em que o Rayzen parou de acreditar nas próprias anotações.

A meta da rodada era "fechar o ciclo aberto da V2 — eixo QA Scientist", e fechou: **11 de 11
critérios**. Mas o que ficou não foram os critérios. Foi a descoberta de um modo de falha que se
repetia em toda parte do sistema, sempre com a mesma assinatura:

> **Nada dava erro. Tudo reportava sucesso. E o dado estava errado.**

Sete vezes, em sete subsistemas diferentes, a mesma coisa. Vale listar porque o padrão é mais
útil que qualquer correção individual.

## As sete falhas silenciosas

| O que parecia | O que era |
|---|---|
| QA Scientist "parado desde junho" | Rodava **todo dia** — varrendo um projeto que não estava no `project_catalog`. Parado e rodando sobre nada dão exatamente o mesmo silêncio |
| Benchmark com 46/46 falhas | O Groq free tier estoura o TPM em qualquer lote e o LiteLLM põe o deployment em cooldown. Sem retry honrando o `Retry-After`, não existia rodada possível |
| Fitness baixo = prompt ruim | O prompt de `summarize` não declarava a convenção de formato que os casos esperavam. `classify` misturava duas tarefas distintas |
| Estratégias medidas sem nota | `fitnessScore` ficava `null` porque cada orquestrador persistia por conta própria, e quem chamava a rota direto não persistia nada |
| Gate aprovado | `approved` no banco sem nunca ter chamado `promote()` |
| Custo de LLM baixo | **Nada** gravava custo. O único gancho vivo era um setter que nenhum módulo jamais chamou |
| Painel dizendo "JWT expira em 12 dias" | Lia uma data escrita à mão no `.env`, não o `exp` do token |

Nenhum desses aparece em log de erro. Nenhum quebra teste. Todos exigem alguém desconfiar de um
número e ir medir.

## O caso que ensina o método

O conjunto de `BenchmarkCases` foi declarado incoerente em 07/08 — "mistura formatos, fitness
baixo mede a mistura, não o prompt". A conclusão estava registrada em memória e parecia sólida.

Em 15/08 a hipótese foi testada antes de refazer o conjunto. O modelo produzia saída
semanticamente correta, mas não seguia a convenção `"Sessao de <tipo>: ..."` que os casos
esperavam — e **o prompt nunca declarava essa convenção**. Duas ações, nenhuma tocando num caso:

- declarar a convenção no prompt de `summarize`
- separar `classify` (rótulo simples) de `classify_event` (objeto JSON) — eram duas tarefas

Resultado: `classify` **0.474 → 0.918**, sem alterar um único caso. A prova de que o conjunto não
era o problema é essa: se fosse, mexer só no prompt não moveria o número.

O registro anterior foi corrigido em vez de apagado. Errar a causa e documentar a conclusão errada
é como uma anotação vira dogma.

## O relógio que derrapou 8h43m

O servidor mudou de máquina em 09/08 — o notebook travou sob carga de build e passou a recusar
boot, e o SSD foi para uma placa H81. O runbook está em `docs/migracao-servidor.md`.

Em 14/08, no meio de uma sessão, o relógio do servidor estava **8h43m atrasado** e o NTP corrigiu
sozinho pouco depois. O invariante `relogio_sincronizado` pegaria isso com folga — limiar de 120s
contra deriva de 31.380s. **Ele não rodou.** Quem disparava os invariantes era o watcher do agent
desktop, e o desktop estava desligado.

> Um sensor que só liga quando alguém está olhando não é sensor.

Daí o ciclo próprio no servidor (`c050f87`): 30 em 30 minutos, independente de qualquer máquina de
trabalho. Grava relatório só quando há falha, ou a cada 6h como heartbeat — porque persistir sempre
encheria a tabela de "tudo ok" e o histórico deixaria de servir para achar quando algo quebrou.

## O bug que eu mesmo causei

Instrumentar as chamadas LLM da V1 exigia injetar `metadata.trace_name` no corpo. Feito no `fetch`
do cliente para não depender de lembrar em 25 pontos de chamada. Subiu quebrado: o SDK da OpenAI
declara `content-length` explicitamente, e corpo maior com o número antigo faz o servidor ler menos
bytes do que foram enviados, receber JSON truncado e esperar o resto para sempre.

Toda chamada LLM da V1 pendurava — **sem erro no log da V1 nem do LiteLLM**. Descoberto porque a
verificação falhou: `state/refresh` deu HTTP 000 após 180s. Corrigido em `440d6ed`.

O detalhe que importa mais que o bug: **os quatro testes passavam verdes com a produção quebrada.**
Eles mockavam o `fetch` e olhavam só o corpo, nunca o contrato de transporte. Teste que não exercita
a fronteira real dá a mesma falsa confiança que uma anotação desatualizada.

## A corrupção que era 90% reflexo

Uma varredura de `U+FFFD` encontrou 128 linhas em 11 tabelas, nos dois schemas. Mas **39 dos 44
documentos "corrompidos" eram falso positivo**: continham o caractere de propósito, porque a linha
do índice de memória que *descrevia a corrupção* carregava o char literal no título — e o hook
indexa arquivos de memória na Brain.

A corrupção real (78 tokens, todos palavras portuguesas inequívocas) foi reparada com mapa
explícito, e a segunda passada — só para o caractere solto — mostrou por que regra geral não serve:
quase todos eram travessão, **dois eram crase**. Uma regra "espaço-FFFD-espaço vira travessão"
teria estragado os dois.

Ao fim: corrupção real **zero**, e a última corrupção genuinamente nova datava de 25/06 — o caminho
de criação de missões, congelado desde então.

## O que passou a rodar sozinho

O fio condutor de agosto foi tirar o sistema da dependência de alguém estar olhando:

- **invariantes** com gatilho no servidor (30 min)
- **catálogo** registrando projeto novo automaticamente (6 h) — antes, projeto novo nascia
  invisível para a V2, e foi assim que o Rayzen AI ficou dois meses fora do próprio catálogo
- **custo de LLM** gravado na origem, com `projectId` propagado até o caso do benchmark
- **traces nomeados** no Langfuse nas três camadas (V1, `LlmService`, `AiRouterService`)
- **MCP resolvendo projeto pelo repositório**, o que eliminou o `PROJECT_ID` fixado em
  `settings.json` — configuração que envelhece mal e já tinha gravado blueprint no projeto errado

## Uma nota sobre a rotação de token

Pedida por segurança, depois de encontrar um token em texto plano no histórico git de outro repo.
Investigando antes de executar, duas coisas derrubaram a premissa: **não existe revogação** neste
sistema (emitir token novo não invalida o anterior — só trocar o `JWT_SECRET`), e **o token que
vazou já estava morto** (HTTP 401).

A rotação foi feita mesmo assim, por um motivo que só apareceu ao decodificar o JWT: **ele expirava
em 12 dias** e ninguém estava vendo. Detalhes em `memory/project_token_rotation.md`.

## O que sobrou

- **Crédito Anthropic** — bloqueia `gpt-4o-premium` e o specialist `architect`
- **Bateria CR2032** do servidor — deriva de horas a cada boot até o NTP sincronizar
- **149 mil traces de health check** históricos no Langfuse (93,5% da base). A fonte foi corrigida;
  purgar o acumulado é decisão em aberto. Filtro seguro é `name LIKE '%health%'` — **nunca**
  "traces sem nome", porque 10.316 anônimos são trabalho real anterior à instrumentação
