# Módulos congelados — V2

> Congelado não é morto. É **construído, registrado, sem uso, e sem plano imediato de uso**.
> Estão aqui para que ninguém os confunda com peça viva do sistema — nem eu, nem você, nem o
> Claude Code lendo o repositório em outra sessão.
>
> Estado medido contra o banco de produção em **2026-08-13**. Cada linha traz a evidência, não a
> impressão.

## Regra

Um módulo congelado:

- **continua registrado** no `app.module.ts` e responde nas rotas — congelar não é deletar
- **não recebe trabalho novo** enquanto estiver aqui
- **sai da lista** no dia em que alguém o chamar de verdade, com o motivo registrado

Descongelar é decisão explícita. Se algo aqui virar necessidade, atualize esta tabela primeiro.

---

## Os cinco (eram seis)

| Módulo | Rota | Evidência de não-uso (2026-08-13) |
|---|---|---|
| `mission-scheduler` | `/v2/scheduler` | `scheduled_missions`: **0 linhas**. Nenhum módulo importa o service |
| `observability` | `/v2/observe` | `trace_spans`: **0 linhas**. A observabilidade real é o Langfuse, alimentado pelo LiteLLM |
| `vault` | `/v2/vault` | `vault_access_logs`: **0 linhas**. Segredos vivem no `.env` do servidor |
| `resource-manager` | `/v2/resources` | Estado só em memória (`Map` de limites, agentes e tokens) — some a cada restart. Nenhuma tabela, nenhum chamador |
| `qa-engine` | `/v2/qa` | `getRecentTestRuns()` **retorna `[]` fixo**, com um `void url` e o comentário "V1 stores TestRun in DB — fetch via V1Bridge". Nunca foi ligado. O QA real são os `test_runs` da V1 (112 registros) |
| ~~`project-memory`~~ | — | **REMOVIDO em 2026-08-15** — era o único que não estava só ocioso; ver abaixo |

### `project-memory` — resolvido em 2026-08-15

Era o único que não estava apenas ocioso: uma **segunda implementação** escrevendo a mesma
tabela `memory_meta`, pela mesma chave `v1DocumentId`, com `update` gravando campos diferentes.

O conflito era concreto: `memory.store()` grava `memoryClass` genérico; `project-memory.index()`
gravava classe auto-derivada mais `memoryType` e `confidence`. **Um `store()` comum rebaixaria
para `inbox` uma decisão marcada como `consolidated`** — sem erro, sem log, sem ninguém saber.

Nunca deu problema por um motivo simples, medido antes de decidir: **o segundo escritor jamais
foi chamado.** Das 22 linhas da tabela, **0** tinham `memory_type`, `confidence` ou `mission_id`,
e nenhum arquivo fora da própria pasta importava o service.

**Foi removido, não congelado** — mas as duas coisas que ele tinha de bom vieram para o `memory`:

- `memoryType` (`decision · lesson · pattern · constraint · assumption`) como campo opcional de
  `store()`, e como filtro em `GET /v2/memory/documents?type=` — um filtro no que já existe, em
  vez das rotas paralelas `/decisions` e `/failures`
- a regra de que **decisão e constraint nascem em `consolidated`**, nunca em `inbox`. Em `inbox`
  uma decisão arquitetural competiria por relevância com anotação solta e sumiria da síntese

Campos tipados só sobrescrevem quando informados, então uma chamada genérica não apaga o tipo
que outra registrou. 6 testes cobrem exatamente o cenário do conflito antigo.

---

## O que NÃO está congelado, apesar de parecer

Dois módulos aparecem em conversas como "sem uso", mas têm dado real e não entram nesta lista:

| Módulo | Dado real | Situação |
|---|---|---|
| `knowledge` | **570 nós, 865 arestas** | Exposto em `/insights` desde 2026-08-14 |
| `cost-controller` | **220 registros** | Exposto em `/insights`; a gravação foi consertada — ver abaixo |

A diferença importa: congelado é "não tem uso". Estes têm dado acumulado e **falta interface** —
problema oposto, e a solução também é oposta. Congelá-los apagaria dado útil da vista.

### O que a apuração do `cost-controller` revelou

Os 220 registros vêm todos de `module = specialist:*`, entre 31/mai e 26/jun — o executor de
missões, congelado desde junho. A leitura natural seria "parou porque o executor parou". Está
errada, e a diferença importa:

**nada no código atual gravava custo.** O único gancho vivo é
`AiRouterService.setCostController()`, um setter que **nenhum módulo jamais chamou** — o campo fica
`null` e o bloco de gravação dentro do `if` nunca executa. Não é código morto óbvio: é código vivo
com uma condição que nunca é verdadeira, que não aparece em teste nem em log.

Benchmark, QA Scientist, evolutionary e router falam com o LiteLLM pelo `LlmService`, que também
não gravava nada. As ~200 chamadas do dia 13/ago custaram **zero** segundo o banco.

Corrigido em 2026-08-14: o `LlmService` grava, com o `CostControllerService` injetado por **DI** e
não por setter tardio. A escolha é deliberada — um setter que depende de alguém lembrar de ligá-lo
é a mesma classe de falha que ele acabou de causar; com DI, ou está ligado ou o boot quebra.

> Se o painel de custo mostrar $0 num período, leia o aviso na tela antes de concluir economia:
> só há registro para chamadas feitas **depois de 14/08/2026**.

### Sobre os 570 nós do `knowledge`

537 deles são do tipo `file`, ligados por 843 arestas `depende_de` — é varredura de código, a mesma
informação que `graphify query` responde no terminal. A camada que existe **só** ali são **33 nós**
escritos à mão: 13 entidades, 12 conceitos, 5 módulos, 2 regras e 1 ADR. A tela separa as duas
coisas justamente porque o volume da varredura esconde a parte curada.

---

> **Desde 2026-08-16 há uma alternativa ao passo 3 para ciclos.** `GET /v2/system/status` mostra
> o batimento dos componentes automáticos, e `nunca-subiu` distingue "declarado e nunca executou"
> de "executa e não produz". Congelamento por evidência colhida à mão numa data envelhece; o
> batimento é estado observável. Vale só para os ciclos — módulo sem ciclo continua exigindo
> `count(*)`.

## Como esta lista foi levantada

Reproduzível, para quem quiser conferir ou repetir:

```bash
# 1. o módulo está registrado e tem rota?
grep -c "<Nome>Module" apps/api-v2/src/app.module.ts
grep -n "@Controller(" apps/api-v2/src/<modulo>/*.controller.ts

# 2. algum outro módulo importa o service?
grep -rln "<Nome>Service" apps/api-v2/src --include=*.ts | grep -v "src/<modulo>/" | grep -v spec

# 3. a tabela tem linha? (count real — n_live_tup é estimativa e mentiu aqui)
docker exec -i rayzen-ai-postgres-1 psql -U rayzen -d rayzen_ai \
  -c "select count(*) from v2.<tabela>;"
```

> O passo 3 tem uma armadilha que caiu nesta própria apuração: `pg_stat_user_tables.n_live_tup`
> reportou **0** para `knowledge_nodes` e `cost_records`, que têm 570 e 220 linhas. É estimativa
> mantida pelo autovacuum e pode estar arbitrariamente velha. Para decidir congelamento, use
> `count(*)`.
