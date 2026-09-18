# n1 — baseline da **precisão** de `memory_relevant`

> Critério n1 da meta *"O que entra em memory_relevant é escolhido, não sorteado"*.
> Medido em **2026-08-21**, contra produção, em 2 projetos **vivos** (o banco-imob ficou de fora
> de propósito: é projeto de teste e não serve de âncora).
>
> A pergunta não é "quantos chars", é **quantos dos 5 trechos injetados eram de fato úteis**.

## O resultado

| # | consulta | úteis /5 | slots gastos em documento repetido | melhor score | queda 1º→5º |
|---|---|---:|---:|---:|---:|
| 1 | RA · por que o checkpoint derruba a aplicação | **2** | 2 | 0,676 | 0,108 |
| 2 | RA · como o invariante de modelos LLM sonda o litellm | **3** | 0 | 0,570 | 0,030 |
| 3 | RA · onde o boost por modo é aplicado no ranking | **4** | 1 | 0,748 | 0,169 |
| 4 | RA · como o hook resolve o repoSlug | **4** | 0 | 0,744 | 0,087 |
| 5 | RA · implementar cache de sessão na autenticação | **2** | 1 | 0,601 | 0,044 |
| 6 | CM · controle de permissões por tenant | **3** | 1 | 0,580 | 0,048 |
| 7 | CM · onde o pedido muda de status | **2** | 0 | 0,557 | 0,033 |
| 8 | CM · implementar desconto no carrinho | **0** | 2 | 0,414 | 0,024 |
| 9 | CM · como o caixa fecha a sessão do dia | **0** | 1 | 0,411 | 0,032 |
| 10 | CM · importar catálogo em massa | **4** | 0 | 0,578 | 0,079 |

**Precisão média: 24 de 50 trechos = 48%.** Praticamente metade do que ocupa 58% do orçamento
não serve para a tarefa.

## Três padrões, e os três são acionáveis

### A. Um documento come vários slots

O chunking divide um arquivo em vários pedaços, e nada impede que 2–3 deles ocupem o top-5.
Na consulta 3, `project_memory_ranking.md` aparece em **4º, 5º e 6º**; na 1, o blueprint do
Guardian ocupa **4º, 5º e 6º**; na 8, `layout.tsx` e `page.tsx` aparecem **duas vezes cada**.

**9 dos 50 slots** foram para um documento que já estava na lista. É o mesmo defeito do dedup do
Brain (56% de duplicata em 2026-08-16), mas na **leitura** em vez da escrita.

### B. O data-catalog duplica o arquivo real

Entradas como `Dataset: identity-jwt.module.ts / Tipo: file / Descrição: Arquivo de código`
competem no mesmo ranking que o **conteúdo** do arquivo — e às vezes ganham dele. Nas consultas
4 e 5 elas ocuparam um slot cada, sempre ao lado do arquivo verdadeiro. São metadados de
catálogo indexados como se fossem conhecimento.

### C. A curva plana é sinal de que não há nada

Onde havia resposta boa, a queda do 1º ao 5º foi grande (**0,169** e **0,108**). Onde não havia,
foi mínima (**0,024** e **0,032**) — tudo empatado num patamar baixo, que é o retrato de "nenhum
documento se destaca porque nenhum serve".

As duas consultas com **0/5** são justamente as de menor queda **e** menor score absoluto (0,414 e
0,411). O piso de 0,52 já as elimina — as duas viriam vazias hoje, o que está correto: o Commerce
não tem spec de carrinho nem de caixa indexada.

> Isso valida o piso do ciclo anterior com dado novo, e sugere que **a queda é um segundo sinal
> aproveitável** — não só o nível absoluto.

## O que este baseline NÃO diz

O julgamento de utilidade é **meu**, trecho a trecho, não uma métrica automática. Está registrado
aqui para que a re-medição de **n5** use o mesmo critério e as mesmas 10 consultas — comparar
precisão com julgamento diferente não compararia nada.

E `cache.module.ts`, o documento mais óbvio para a consulta 5, ficou em **10º**. Não é falta de
dado: é ordenação.

---

# Resultado do padrão A (dedup por documento) — medido em 2026-08-21

Commit `831c188`, no ar às 20:48Z. Mesmas 10 consultas, mesmo critério de julgamento.

## O que melhorou: diversidade, exatamente como prometido

**5 de 5 documentos distintos em todas as 10 consultas.** Antes havia consultas com 3 documentos
ocupando 5 slots. O mecanismo funcionou.

## O que NÃO melhorou: a precisão

| # | consulta | antes | depois |
|---|---|---:|---:|
| 1 | RA · checkpoint derruba | 2 | 2 |
| 2 | RA · invariante LLM | 3 | 3 |
| 3 | RA · boost por modo | 4 | **5** |
| 4 | RA · repoSlug | 4 | 4 |
| 5 | RA · cache de sessão | 2 | 2 |
| 6 | CM · permissões por tenant | 2 | 2 |
| 7 | CM · pedido muda de status | 2 | 2 |
| 8 | CM · desconto no carrinho | 0 | 0–1 |
| 9 | CM · caixa fecha a sessão | 0 | 0 |
| 10 | CM · importar catálogo | 4 | 4 |

**24/50 → ~26/50. De 48% para ~52%.** Praticamente parado.

## Por que a previsão errou

Eu havia estimado 48% → 66%, supondo que cada slot liberado viraria documento útil. **Não vira.**
Os 9 slots recuperados foram preenchidos pelos documentos de 6º a 10º lugar — que são tão
medíocres quanto os repetidos que saíram.

O único ganho real foi a consulta 3, onde `memory-ranking.const.ts` subiu do 7º para o 5º e é
genuinamente útil. Nas outras, o que entrou foi `catalog-guardian-item-5` no lugar de um chunk
repetido do blueprint do Guardian: troca de ruído por ruído.

> **A duplicação desperdiçava slots, mas os candidatos alternativos não eram melhores.**
> O gargalo não é diversidade — é a qualidade do ranking e do acervo.

## Vale manter? Sim, e por um motivo diferente do previsto

Pelo mesmo orçamento de chars, o contexto passa a carregar **5 documentos distintos em vez de 3**.
Isso é estritamente mais informação, mesmo que a fração útil não tenha mudado — e remove um modo
de falha (um documento longo monopolizar a seção) que voltaria a morder em qualquer consulta nova.

Mas ele **não é** a alavanca de precisão. Essa continua aberta.

## Para onde isso redireciona o ciclo

Duas evidências apontam para ranking, não para filtragem:

- **`cache.module.ts` continua em 10º** para "implementar cache de sessão" — o documento mais
  óbvio da consulta, fora do top-5 antes e depois
- **O data-catalog continua duplicando o arquivo real** (padrão B): `Dataset: identity-jwt.module.ts`
  ocupa o 4º slot ao lado do próprio `identity-jwt.module.ts` no 2º. O dedup por caminho não pega,
  porque são caminhos diferentes para o mesmo conteúdo

O padrão B e o boost por modo (n2) são os próximos alvos, e os dois mexem em **ordenação**.

---

# Resultado do padrão B (purga do `data_asset`) — 2026-08-21

**Não foi mudança de código: foi limpeza de dado.** 397 documentos apagados do índice.

## O que eram

Resíduo de um domínio **já aposentado**. A migração `20260805150654_drop_data_governance`
dropou a tabela `data_assets` ("477 linhas que eram apenas o rastro de arquivos") e **esqueceu os
documentos indexados** — 397 continuaram no `documents`, competindo no ranking da memória.

Conteúdo típico: `Dataset: identity-jwt.module.ts / Tipo: file / Descrição: Arquivo de código /
Origem: <caminho>`. Metadado **sobre** um arquivo, não o conteúdo dele — e **334 dos 397 (84%)**
tinham o arquivo real indexado à parte, competindo lado a lado.

Nada os escrevia (última criação: 05/08, data da migração) e nada os lia: a única referência viva
no código é um rótulo de exibição em `apps/web/app/page.tsx` (`data_asset` → "catalog"), agora sem
efeito prático.

## Como foi feito

Seguindo o precedente da purga do Langfuse, e a lição dela — **ausência de FK não é ausência de
dependência**:

| checagem | resultado |
|---|---|
| citados por `wiki_source_references` (FK, `RESTRICT`) | **0** |
| presentes em `project_document_versions` (sem FK) | **0** |
| com linha em `v2.memory_meta` (sem FK) | **0** |

Backup antes: `~/backups/data-assets-pre-purga-20260821-211515.csv.gz` (1,8 MB, gzip verificado).
Conferido por **id**, não por contagem de linhas — o conteúdo tem quebras embutidas, então
1.986 linhas de CSV para 397 registros. **397 ids no backup, 397 no banco, 0 ausentes.**

## O efeito, medido nas mesmas 10 consultas

**Zero entradas `Dataset:` sobraram.** Precisão:

| consulta | antes de B | depois de B |
|---|---:|---:|
| RA · repoSlug | 4 | **5** |
| RA · cache de sessão | 2 | 2 |
| *(as outras 8)* | — | sem mudança |

**~26/50 → ~27/50 (54%).**

Na consulta 4 o ganho é limpo: `Dataset: useProjects.ts` deu lugar a `repo-slug.spec.ts`, que é o
teste da função em questão. Na 5, o `Dataset: identity-jwt.module.ts` saiu e entrou
`migration.sql` — **ruído trocado por ruído**, o mesmo padrão do A.

---

# O que as duas medições, juntas, deixam claro

| | precisão |
|---|---:|
| baseline | 24/50 — **48%** |
| após A (dedup por documento) | ~26/50 — **52%** |
| após B (purga do `data_asset`) | ~27/50 — **54%** |

Duas limpezas estruturais, **+6 pontos**. O índice ficou genuinamente melhor — 397 documentos de
lixo a menos, nenhum documento repetido no top-5 — mas a fração útil mal se moveu.

> **Limpar o acervo dá ganho pequeno. A alavanca é a ordenação.**
>
> A prova está parada na consulta 5 desde o começo: `cache.module.ts` **nunca entrou no top-5**
> para "implementar cache de sessão", nem antes, nem depois de A, nem depois de B. Não é
> duplicata, não é lixo, não é falta de dado — é ranking.

O próximo alvo é **n2**: o boost por modo age sobre **2,6% do acervo**, então na prática a
ordenação é cosseno cru. É lá que os outros 46% estão.

---

# n2 — o boost por modo: hipótese testada e **reprovada** (2026-08-21)

Cobertura re-medida: **54 de 1.781 documentos = 3,0%** com `memory_meta` (32 com tipo).
O boost age sobre 3% do acervo; 97% saem por cosseno.

## A opção (a) do critério é inalcançável, e o código já explicava por quê

O docstring de `boostDoModo` já declara o escopo, com o argumento certo:

> *"`decision`, `lesson`, `pattern` e `constraint` descrevem conhecimento curado. Não existe
> resposta certa para 'qual o tipo do `page.tsx`'."*

Preencher os 97% exigiria forçar taxonomia de conhecimento em arquivo de código. Concordo com a
decisão registrada: não é descuido, é escopo.

## A hipótese que testei

Adicionar um **segundo eixo** que existe para 100% do acervo: a **natureza** do documento, derivada
só do caminho (`codigo` · `teste` · `licao` · `doc` · `config`), com preferência por modo — em
`implementation`, código antes de lição; em `architecture`, doc antes de código.

Motivação concreta: na consulta 5, `cache.module.ts` perdia o 5º slot para um `feedback_nextauth`
por **0,004**. Em modo de implementação, código deveria ganhar esse empate.

## O resultado da simulação — não implementei

Simulado sobre os candidatos reais das 10 consultas (`docs/_n2-simulacao.mjs`), modo
`implementation`:

| consulta | antes | com o eixo de natureza | |
|---|---:|---:|---|
| 5 · cache de sessão | 2 | **4** | ✅ `cache.module.ts` e `middleware.ts` entram |
| 2 · invariante LLM | 3 | **2** | ❌ perdeu `config.yaml` — o `model_list` do LiteLLM |
| 3 · boost por modo | 5 | **4** | ❌ perdeu `memory-ranking.const.ts` |
| 4 · repoSlug | 5 | **4** | ❌ perdeu `repo-slug.spec.ts`, ganhou `rayzen-mcp.mjs` |
| 1, 6, 7, 8, 9, 10 | — | — | neutro |

**Saldo ≈ −1.** Ganhei exatamente o caso que projetei e perdi três que não previ.

> **Por que falha, e a razão generaliza:** penalizar categorias inteiras joga fora documentos bons.
> `config.yaml` era o artefato **mais** relevante da consulta 2; `repo-slug.spec.ts` era o teste da
> função em questão. **A natureza do documento não prediz relevância.**
>
> Foi overfitting a um exemplo — e custou uma simulação em vez de um ciclo de deploy + medição,
> que é a lição que A e B ensinaram.

## Onde isso deixa o n2

O critério oferece duas saídas, e a medição fecha as duas:

- **(a) cobrir mais que 3%** — inalcançável sem inventar etiqueta, e inventar cairia na mesma
  família do placeholder de schema virando valor
- **(b) restringir a um subconjunto declarado** — **já está feito**, e está documentado no próprio
  `boostDoModo`

O que sobra não é código, é **decidir se o critério ainda faz sentido como está escrito**. A
pergunta real que ele queria fazer — *"por que metade do contexto sai por cosseno cru?"* — segue
válida, mas a resposta não está no boost.

Três alavancas continuam abertas, e nenhuma é o boost:

1. **A consulta.** `cache.module.ts` não entra porque a consulta diz "cache de sessão" e o arquivo
   fala de `CacheModule`. Reescrita/expansão de consulta ataca isso direto.
2. **O tamanho do trecho** (critério n3): 400 chars fixos para o 1º e para o 5º.
3. **O que está indexado.** Q9 ("caixa fecha a sessão") devolve `globals.css` porque o Commerce
   **não tem** spec de caixa indexada — e há uma `cashier-module.md` indexada no projeto **errado**.

---

# A consulta: quatro tentativas, e o que elas revelam juntas (2026-08-21)

## O diagnóstico estava certo

A consulta **é** um gargalo, e o teste é limpo:

| consulta | 1º resultado | score |
|---|---|---:|
| `implementar cache de sessao no modulo de autenticacao` | `auth.module.ts` | 0,601 |
| **`CacheModule`** | **`cache.module.ts`** | **0,767** |
| `onde fica a configuracao de cache da api` | `route_payload6.json` | 0,627 |

O documento é perfeitamente encontrável. A consulta longa vira um centroide onde "autenticação" e
"módulo" dominam — e o andaime da pergunta (*"onde fica a … da"*) só dilui. A terceira linha é a
prova: a pergunta mais natural devolve o resultado mais absurdo.

## O que testei, e por que não implementei

Duas formas de consulta acham documentos **diferentes e bons**, então a ideia foi fundi-las.
Simulado, nunca implementado:

1. **União por melhor score** — falha. Cosseno de consultas diferentes **não é comparável**: a
   consulta curta produz valores sistematicamente mais altos e domina. Derrubou o
   `OrderStatusSelect.tsx` do 1º lugar na consulta 7.
2. **Fusão por posição (RRF)** — funciona melhor e preserva os casos fortes (a consulta 3 seguiu
   5/5, que a união bruta havia quebrado).

**Mas houve um furo na minha própria medição, e ele importa.** As consultas de termos da primeira
simulação foram escritas **à mão**. Ao escrever o extrator automático, **9 das 10 variantes
diferiram** — o algoritmo mantém verbos (`sonda`, `resolve`, `implementar`, `funciona`) que eu
havia removido por julgamento.

Refeito com as variantes **reais do algoritmo**, o saldo cai de ~+2/+3 para **+1 em 50** — ao custo
de **dobrar as chamadas de embedding em toda busca**. Não compensa.

## O que as quatro tentativas dizem juntas

| tentativa | saldo |
|---|---:|
| A · dedup por documento | +2 |
| B · purga do `data_asset` | +1 |
| n2 · boost por natureza | **−1** |
| consulta · fusão RRF | +1 |

Nenhuma alavanca move mais que ~2 pontos, e uma piora. **Isso não é coincidência.**

> **Para metade das consultas o acervo simplesmente não contém 5 documentos relevantes.**
>
> A consulta 9 (*"como o caixa fecha a sessão"*) tem **zero** — o Commerce não tem documentação de
> caixa indexada, e a `cashier-module.md` que existe está indexada **no projeto errado**. A
> consulta 1 tem exatamente **dois**: a lição e a memória que escrevi sobre o F-009. A 8 tem um.
>
> Servir **5 slots fixos** quando existem 0, 1 ou 2 documentos relevantes garante precisão baixa
> **por construção** — não importa quão bom seja o ranking. Os outros três slots vão ser
> preenchidos com o menos ruim que sobrar, e foi exatamente isso que A, B e a fusão fizeram:
> trocaram ruído por ruído.

## Para onde ir: n3, e por outro motivo do que o escrito

O critério n3 fala em "trecho de 400 chars deixa de ser fatia fixa". A medição diz que o problema
maior não é o **tamanho** de cada trecho, é a **quantidade**: a seção deveria servir quantos
documentos passam da barra e parar — 2 quando há 2, zero quando há zero.

Isso ataca a causa que A, B e a fusão contornaram, e tem um efeito colateral que as outras não
têm: **corta orçamento sem perder nada útil**, porque o que sai é justamente o que ninguém queria.

---

# n5 — a re-medição que fecha o ciclo (2026-08-21)

## Primeiro, uma correção no meu próprio baseline

Os 48% do n1 foram medidos em `/memory/search/raw` — **a busca, não a seção injetada**. O piso de
0,52 já estava no ar e já removia as duas consultas sem acervo (8 e 9), então o baseline contou
10 slots de lixo que **o contexto nunca serviu**.

Comparação honesta é superfície contra a mesma superfície. Refeita sobre o contexto injetado:

| | slots servidos | úteis | precisão |
|---|---:|---:|---:|
| antes (5 trechos) | 40 | 25 | **62,5%** |
| **agora (4 trechos)** | **32** | **23** | **71,9%** |

As consultas 8 e 9 servem **zero** slots — o piso as bloqueia, corretamente: o Commerce não tem
documentação de carrinho nem de caixa indexada.

## O orçamento

Medido nas 10 consultas, pelo endpoint que monta o contexto de verdade:

```
memory_relevant   1.615 chars quando cheia  (4 × 400 + separadores)
média da seção    1.104 chars
média do contexto 2.586 chars
fatia             42,7%
```

Era **58%** do orçamento no Rayzen AI ao fim do ciclo anterior. Agora a seção é **42,7%** em média,
e a precisão do que ela serve subiu ~9 pontos.

## O que fechou o ciclo, e em que ordem de valor

| | efeito |
|---|---|
| **n3 · servir 4 em vez de 5** | **+9 pontos** de precisão, −20% do orçamento da seção |
| A · dedup por documento | diversidade resolvida (5/5 documentos distintos), precisão ~parada |
| B · purga de 397 `data_asset` | índice mais limpo, precisão ~parada |
| n2 · boost por natureza | **reprovado na simulação** (−1), não implementado |
| consulta · fusão RRF | **reprovado na medição** (+1 ao custo de 2× embedding), não implementado |

> **A única coisa que moveu o número foi servir menos.** Três mecanismos de filtragem e ordenação
> — todos baseados em score — entregaram entre −1 e +2 pontos, porque **o score não separa útil de
> inútil**: na consulta 1 o lixo pontua 0,58 e na 5 o documento certo pontua 0,557.
>
> Dois deles foram descartados **antes** de virar código, por simulação. Foi o que a experiência de
> A e B ensinou: previsão aritmética não vale, e medir custa menos que um ciclo de deploy.

## Nota de robustez, achada por acidente

Na primeira tentativa desta medição, a seção `memory_relevant` veio **vazia** em uma consulta — sem
erro na resposta e sem rastro visível. Causa: o container tinha acabado de subir e a busca falhou
de forma transitória; `fetchSection` engole a exceção e a seção simplesmente **desaparece** do
pacote.

O consumidor não tem como distinguir *"não há memória relevante"* de *"a busca falhou"*. É a
mesma família dos `catch` silenciosos da auditoria de 19/08, e vale um item de backlog.
