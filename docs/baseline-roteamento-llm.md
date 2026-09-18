# Baseline — roteamento de LLM

> Medido em **2026-09-06** sobre `langfuse.observations`, janela de **7 dias**, 2.780 chamadas com
> `model_group` registrado. Existe para que a próxima mudança no roteamento seja avaliada por
> comparação, não por impressão.
>
> A fonte é o `metadata->>'model_group'` (o **alias pedido**) cruzado com `model` (o **modelo
> servido**). Sem esse par não há como saber se a rota respeitou a intenção — foi a primeira coisa
> a confirmar, porque decidia se o critério era medível.

---

## 1. Confiabilidade por grupo

| grupo pedido | servido por | chamadas | erros | taxa |
|---|---|---:|---:|---:|
| `gpt-local` | Ollama **local** | 411 | **0** | **0%** |
| `gpt-4o` | Groq `gpt-oss-120b` | 500 | 24 | 4,8% |
| `gpt-4o-mini-gemini` | `gemini-3.1-flash-lite` | 691 | 109 | 15,8% |
| `gpt-4o-mini` | Groq `gpt-oss-20b` | 650 | 189 | **29,1%** |
| `gpt-4o-gemini` | `gemini-3-flash-preview` | 471 | 247 | **52,4%** |

**Dois fatos que mudam o desenho:**

- **`gpt-4o-gemini` falha mais da metade das vezes — e é o PRIMEIRO fallback do `gpt-4o`.** A rede
  de proteção montada em 22/08 é o elo mais frágil da cadeia. Ela resolveu o problema real de não
  haver fallback nenhum, mas a ordem escolhida coloca o menos confiável na frente.
- **O modelo local tem zero erro em 411 chamadas**, e quase nada é roteado para ele por escolha
  deliberada — só os módulos que pedem `gpt-local` explicitamente.

---

## 2. Causa dos erros

| grupo | tipo | erros |
|---|---|---:|
| `gpt-4o-gemini` | **429 cota** | 226 |
| `gpt-4o-mini` | **429 cota** | 192 |
| `gpt-4o-mini-gemini` | outro | 67 |
| `gpt-4o-mini-gemini` | 503 indisponível | 43 |
| `gpt-4o-mini` | outro | 28 |
| `gpt-4o` | 429 cota | 24 |
| `gpt-4o-gemini` | 503 indisponível | 17 |
| `gpt-4o-gemini` | 404 sumiu | 4 |
| `gpt-4o-premium` | sem crédito | 1 |

**Cota domina: 442 dos ~615 erros são 429.** Isso decide o tipo de conserto — não é modelo
quebrado nem configuração errada, é **recurso escasso mal distribuído**. Backoff, distribuição e
preferência pelo que não consome cota resolvem; trocar de modelo, não.

> Os `404 sumiu` do `gpt-4o-gemini` merecem vigilância: é a assinatura da descontinuação silenciosa
> que derrubou a plataforma em 17/08. Quatro em sete dias ainda é ruído; uma subida não é.

---

## 3. Vazamento de intenção

`gpt-local` é pedido justamente por ser **local e sem cota**. Em 7 dias:

| servido por | chamadas | |
|---|---:|---|
| Ollama (local) | 386 | respeitou a intenção |
| Groq | **25** | **6,1% saíram da máquina** |

Pequeno, e é o fallback configurado funcionando. Mas é vazamento de intenção: pedir "local" e
receber "nuvem" é diferente de pedir "rápido" e receber "lento".

> **Correção de rumo registrada.** Antes desta medição eu afirmei que uma chamada a `gpt-local`
> terminou num 429 do Gemini, e usei isso como evidência de que o roteador trai a intenção. **Os
> dados não sustentam**: em 7 dias, `gpt-local` nunca foi servido por Gemini. O que eu vi era o
> **Hermes ignorando a flag `-m`** e usando o `model:` do próprio config — defeito do cliente, que
> eu mesmo já havia identificado, atribuído ao roteador. A crítica ao roteamento continua de pé;
> a evidência que eu citei era outra coisa.

---

## 4. Rastro incompleto — e o que ele estava escondendo

**A maior parte dos erros caía em `name = litellm-acompletion`**, sem identificação de `caller`.
O `CLAUDE.md` declara que toda chamada LLM se identifica no Langfuse, justamente para o rastro
responder *"quem gastou isso"*.

**O anônimo tinha dono, e era a própria sonda de invariantes.** Achado em 06/09, e ele
**invalida parcialmente as tabelas 1 e 2 acima**:

| janela | anônimo | nomeado |
|---|---:|---:|
| 04h–12h (ninguém trabalhando) | ~10–11/hora, **contínuo** | **0** |

Nessa janela o tráfego anônimo era **exatamente os 5 grupos de `GRUPOS_LLM_SONDADOS`**, em
contagens quase iguais (14, 14, 14, 16, 17 em 7h). A sonda roda a cada 30min em 5 grupos, 24h por
dia — **~1.700 das 2.780 chamadas da semana, cerca de 60% de tudo**.

> Consequência sobre este documento: **as taxas de erro por grupo medem majoritariamente o sensor,
> não o trabalho.** Os 52,4% do `gpt-4o-gemini` são, em boa parte, a sonda batendo em cota com
> `max_tokens: 1`. Decidir a ordem da cadeia de fallback com esses números seria otimizar o
> roteamento para quem só pergunta *"você está vivo?"*.

Corrigido: a sonda agora manda `trace_name: rayzen:invariants:sonda-llm`, com teste que exige o
rótulo no **corpo** de todas as sondas — nome errado é tão anônimo quanto nome nenhum. **A próxima
medição separa sensor de trabalho; esta não separava.**

### O que apareceu assim que os nomeados foram olhados

`rayzen:v1:documentation` é o maior consumidor real da plataforma e falha **quase metade das
vezes**:

| grupo | chamadas | erros | |
|---|---:|---:|---|
| `gpt-4o-mini` | 326 | **222** | **68%** |
| `gpt-4o-mini-gemini` | 264 | 66 | 25% |

A mensagem não é 429 cru: é **`No deployments available for selected model, Try again in 497
seconds`** — o *cooldown* que o próprio LiteLLM aplica ao deployment depois de levar 429. Ou seja,
o efeito da cota não é a chamada que estoura, é o bloco de ~8 minutos que vem depois e derruba
tudo que pedir aquele grupo.

**Investigado no mesmo dia, e o dono é o auto-checkpoint.** `SmartCheckpointService` (api **V1**,
a cada 10min) dispara `synthesis.checkpoint()` quando há ≥5 eventos e burst/decisão/2h — durante
trabalho ativo o burst é trivial, todo `Edit` é um evento, então ele fura o gatilho **toda
rodada**. Cada disparo regenera os 4 documentos por LLM.

E regenerava **em dobro**: `checkpoint()` já chama `generateAll(force: true)` no fim do próprio
pipeline, e o `SmartCheckpointService` chamava de novo na linha seguinte. Duas execuções
concorrentes, ambas com `force`, escrevendo as mesmas linhas de `project_documents`. Invisível
porque as duas são fire-and-forget com `.catch()` mudo.

| | |
|---|---|
| checkpoints em 06/09 | **38** (21 automáticos) — contra 2–5 nos dias parados |
| chamadas de documento no dia | 519, das quais **285 falharam** |
| conta | 38 × **2** × 4 tipos = 304, mais as retentativas do SDK |

**Três consertos, todos em 06/09:**

1. **A chamada redundante saiu**, junto com a injeção `forwardRef` que existia só para ela.
2. **Piso de 1h entre regenerações do mesmo documento**, furado por pedido humano (`?force=true`)
   e por gatilho `decision_detected`. A cadência de 10min do ciclo **não mudou** — o que se
   separou foi o ritmo dos dois produtos: a síntese é de janela curta, o documento é rollup de 30
   dias.
3. **`force` deixou de responder duas perguntas.** Ele significava "ignore documento revisado à
   mão" *e* "regenere mesmo estando fresco"; o caminho automático precisa da primeira e levava a
   segunda de carona. Agora são dois parâmetros, e a rota HTTP mapeia `?force=true` para os dois
   porque ali significa *"uma pessoa pediu"*.

> **Por que piso de tempo e não hash de conteúdo**, contrariando o padrão do `contentChangedAt`:
> em 7 dias o `project_state` teve **74 versões e ZERO byte-idênticas**. O LLM reformula sempre,
> mesmo sem informação nova — a chamada é justamente o que descobriria que nada mudou. E o hash
> da *entrada* economizaria menos aqui, porque ela muda ~8% a cada 10min: o hash mudaria e não
> pularia, exatamente no caminho quente.

O ciclo também **passou a bater no painel** (`auto-checkpoint`), com detalhe
`{ varridos, disparados }`. Primeiro batimento real: `{"varridos": 10, "disparados": 1}`.

**Verificado em produção, não inferido da queda de volume.** O volume caiu de 93 para 7
chamadas/hora, mas isso estava **confundido com ociosidade** — só houve um gatilho automático na
janela. A prova veio de chamar o endpoint com os parâmetros exatos do caminho automático:

```bash
curl -X POST -H "Authorization: Bearer $AGENT_TOKEN" \
  http://127.0.0.1:3101/documentation/generate/<projectId>     # SEM ?force
# → 201 devolvendo os generatedAt ANTERIORES, e max(generated_at) idêntico antes e depois
```

> **Consequência a conhecer:** checkpoint chamado **sem `meta`** conta como pedido humano e fura o
> piso. Os três chamadores do `POST /synthesis/checkpoint` são o botão da UI e os dois servidores
> MCP (`rayzen_checkpoint`), e nos três o pedido é deliberado — fim de sessão quer documento
> fresco. Mas um automatismo novo que chame essa rota sem `meta` passa direto pelo piso sem
> ninguém notar.

---

## 5. O que este baseline permite perguntar depois

1. A cadeia mudou de ordem para pôr o mais confiável antes? (`gpt-4o-gemini` sai da 1ª posição)
2. A taxa de 429 caiu, ou só se moveu de grupo?
3. O percentual de pedidos "local" servidos fora da máquina caiu de 6,1%?
4. **Descontando a sonda, qual é a taxa de erro do trabalho real?** Só agora é possível perguntar
5. Os `404` do Gemini subiram? (sinal de descontinuação)
6. Quanto do consumo é sensor e quanto é trabalho? Se a proporção seguir em ~60/40, a frequência
   da sonda passa a ser uma decisão de orçamento de cota, não de higiene

---

## Nota de método

O custo **não** entra como eixo, e isso foi verificado: `v2.cost_records` tem 545 linhas de 31/05
a **24/08** — nada depois — e os últimos 30 dias somam **menos de dois centavos de dólar**. A
plataforma roda em free tier, então o recurso escasso não é dinheiro: é **cota e disponibilidade**.

> **O `cost_records` não parou de gravar — quem gravava parou de rodar.** Investigado em 06/09;
> ver a seção abaixo.

---

## `cost_records` — a tabela estava certa, o ciclo é que morreu

`v2.cost_records` para em **24/08**. No Langfuse, os traces `rayzen:benchmark:geracao`,
`rayzen:benchmark:avaliador` e `rayzen:qa-scientist:analyze` param **no mesmo dia**. A tabela
registrou fielmente o que aconteceu: **nada.**

O QA Scientist coleta sinal de falha em três fontes, e as três estão vazias — cada uma por um
motivo diferente, e nenhum deles é temporário:

| fonte | último registro | por quê |
|---|---|---|
| `mission_steps` (failed/skipped) | 03/08 | executor de missões **congelado por decisão de produto** |
| `benchmark_results` (fitness < 0.5) | 17/08 | só **este mesmo ciclo** os produz — fome circular |
| `trace_spans` (status error) | — | **a tabela nunca teve uma linha** |

Sem sinal, `dailyCycle` devolve `no_failures` e nenhuma chamada de LLM acontece. Sem chamada, não
há custo a gravar. E o batimento reportava `{ ciclos: 10 }` com `ok: true` todo dia — **um ciclo
vivo, pontual e sem nada para fazer é byte a byte igual a um ciclo desligado.**

> É a versão seguinte do problema que o batimento foi construído para resolver. Lá a pergunta era
> *"morreu ou está quieto?"*, e a resposta foi separar o batimento da saída. Aqui a pergunta é
> *"está quieto porque tudo vai bem, ou porque ninguém liga mais na entrada?"* — e o batimento não
> respondia. Agora o detalhe traz `{ ciclos, semSinal, hipoteses }`.

**Não foi construída fonte nova de sinal.** Existe sinal de falha real na plataforma (os ~615
erros de LLM desta semana, os invariantes, `agent_audit_logs`), e ligá-lo à entrada do QA Scientist
é decisão de escopo, não conserto de defeito — entra como candidato de meta, não aqui.

**A V2 é a única que grava custo, e isso é estrutural.** O `createLlmClient` da V1 instrumenta
`trace_name` no `fetch` e **não tem caminho de custo nenhum** — nunca teve. Como a V1 é hoje 100%
do trabalho real, `cost_records` está estruturalmente cego ao que a plataforma de fato gasta.
Deliberadamente **não corrigido**: em 30 dias o gasto medido foi **menos de dois centavos**, e o
recurso escasso é cota, não dinheiro. Instrumentar custo em 25 pontos de chamada para medir dois
centavos seria trabalho no eixo errado — o que passou a ser rastreável é o consumo **por
chamador**, no Langfuse, e isso saiu de graça ao nomear a sonda.

Consulta que produziu as tabelas 1 e 3:

```sql
SELECT metadata->>'model_group' AS pedido, model AS servido,
       count(*) AS total, count(*) FILTER (WHERE level='ERROR') AS erros
FROM observations
WHERE start_time > now() - interval '7 days'
  AND metadata->>'model_group' IS NOT NULL
GROUP BY 1,2 ORDER BY 3 DESC;
```
