# Auditoria — Fase 2: funcional

> Sessão 2 · 2026-08-19. Exercitado contra **produção** (`https://rayzen.com.br`), com token e
> projeto ativo reais.

## Método — escolhido, corrigido em curso, e registrado

A escolha inicial foi `jarvis:browse_and_screenshot`. Ela **não serve sozinha**: a ação abre a URL
no navegador padrão e captura a tela inteira (`browse-screenshot.ts:18-23`), sem clicar — e os ~19
modais do `Header.tsx` são estado React, **não endereçáveis por URL**. Cobriria as rotas e nenhum
modal.

Método final: **Puppeteer 22.15.0, que já é dependência do repo** (`apps/api`, usado para PDF).
Nenhuma dependência instalada, nada adicionado ao `package.json`. Roda headless, então não toma a
tela. Isso dá o que faltava: **clique real, erro de console, exceção de página e toda resposta
HTTP ≥ 400**.

Scripts em `scratchpad/` (`rotas.mjs`, `modais2.mjs`) — descartáveis, fora do repo.

> **Duas correções de método, ambas pegas medindo.**
>
> **1. A primeira rodada de modais rodou com "sem projeto".** `grafo` disse *"Nenhuma meta ativa"*,
> `qa` disse *"Nenhum run registrado"*, `evidências` disse *"Nenhuma evidencia"*. Ia registrar três
> achados; eram **artefato do harness** — o projeto ativo mora em `localStorage`
> (`rayzen_active_project_id`) e a sessão headless nascia limpa. Refeito com o projeto semeado, os
> três passaram a mostrar dado real.
>
> **2. `ERR_ABORTED` não é falha.** Aparece em massa nas rotas e são requisições canceladas quando
> a página navega ou fecha. Ignoradas.

---

## Resultado geral — saudável na leitura, com um buraco na escrita

**Na leitura: 10 de 10 rotas em `HTTP 200`, 9 de 9 modais com dado real, zero erro de JavaScript e
zero HTTP ≥ 400**, com uma exceção (`/deck`). A UI está bem melhor do que a Fase 1 sugeria.

**Na escrita o quadro muda:** dos 3 fluxos submetidos, 2 funcionam e **1 derruba a aplicação**
(F-009). Vale como lição de método — a varredura de leitura, sozinha, daria um laudo bom demais.

| modal | veredito | o que renderizou |
|---|---|---|
| `missões` | ✅ funciona | 10+ missões reais, de junho, com status `DONE`/`FAILED`/`CANCELLED` |
| `atividade` | ✅ funciona | feed ao vivo com filtros (`sinal`, `cli`, classes de memória) |
| `qa` | ✅ funciona | último run `843 / 0 falhou / 100%` — **bate exatamente** com o `pnpm test` local |
| `evidências` | ✅ funciona | "Nenhuma evidencia registrada ainda." — correto, ver F-002 |
| `síntese` | ✅ funciona | sínteses de sessão com decisões e próximos passos |
| `docs` | ✅ funciona | documentação viva, 5 abas, gerada 11:19 |
| `recomendações` | ✅ funciona | "Tudo em ordem" |
| `costs` | ⚠️ **abre, e o número está errado** | ver F-005 |
| `grafo` | ⚠️ **"Carregando…" indefinido** | ver F-003 |

| rota | veredito |
|---|---|
| `/` · `/catalog` · `/guardian` · `/work-panel` · `/mission` · `/settings` · `/login` | ✅ 200, sem erro |
| `/insights` | ✅ 200 — mas ignora o projeto ativo global (F-007) |
| `/discovery` | ✅ 200 — ver nota de não-reprodução abaixo |
| `/deck` | ⚠️ 200 com 4 recursos 404 (F-006) |

---

## Fluxos de escrita (sessão 2, segunda rodada)

Três submissões reais, contra produção, no projeto Rayzen AI.

| fluxo | resultado |
|---|---|
| `+ capturar` → **Registrar (⌘ + Enter)** | ✅ `POST 201 /events`; gravado como `manual/note/idea` **com dono** — verificado no banco |
| chat → **Enviar** | ✅ `POST 201 /orchestrate/stream`; respondeu em < 5s, `módulo: system` |
| **`checkpoint`** | ❌ **derruba a aplicação** — ver F-009 |

Não exercitados: criar projeto, importar blueprint, regenerar docs, criar missão. `definir meta`
não foi alcançável — mora dentro do modal `grafo`, que fica em "Carregando…" (F-003).

---

## Achados

### [alta] ✅ CORRIGIDO — `checkpoint` derrubava a aplicação

- **Camada:** frontend ↔ api-v1 (quebra de contrato) · **Tipo:** botão do `Header`
- **Status:** **corrigido em 19/08** · **Classe:** bug · **Esforço:** pequeno (confirmado)

**Evidência.** Clique real no botão `checkpoint` com projeto ativo:

```
--- clicando ---
  PAGEERROR: TypeError: Cannot read properties of undefined (reading 'slice')
  t+5s:  This page couldn’t load  Reload to try again, or go back.
  t+10s: This page couldn’t load …
  t+30s: This page couldn’t load …
```

A aba não se recupera. Reproduzido duas vezes (foi também o `TargetCloseError` que matou a
primeira varredura de modais).

**Causa raiz — identificada, é quebra de contrato em uma linha.**

`POST /synthesis/checkpoint` é **fire-and-forget** por desenho, e devolve **202** com um corpo que
não é um artefato (`synthesis.controller.ts:24-36`):

```ts
@Post('checkpoint')
@HttpCode(202)
checkpoint(…) {
  this.svc.checkpoint(…)…        // roda em background
  return { status: 'processing', checkpointId, message: 'Checkpoint iniciado — atualize em alguns segundos' }
}
```

Não há `sessionId`. Não há `content`. Mas `page.tsx:800-804` trata a resposta como artefato — e
`res.ok` é **verdadeiro para 202**:

```ts
if (res.ok) {
  const artifact = { ...raw, content: raw['content'] ?? raw['synthesis'] } as SynthesisArtifact
  setSynthesisArtifacts(prev => [artifact, ...prev])   // objeto sem sessionId entra na lista
  setSynthesisOpen(true)                              // e a modal abre
}
```

O `as SynthesisArtifact` é uma **asserção**, não uma validação: o TypeScript aceita, e em runtime o
objeto não tem os campos. Aí `SynthesisModal.tsx:60` faz:

```tsx
<span …>{a.sessionId.slice(0, 8)}…</span>
```

**É o único acesso não protegido do bloco.** Tudo em volta usa optional chaining —
`a.content?.confidence`, `a.content?.summary`, `a.content?.decisions?.length ?? 0`. Só `a.sessionId`
não. `undefined.slice` lança durante o render, o React desmonta a árvore e a página morre.

**E o checkpoint funciona.** O servidor gravou normalmente enquanto a interface morria — o clique
desta auditoria produziu `checkpoint-1787151911839` às 15:05:12, confirmado em
`conversation_messages`. **O usuário vê a aplicação quebrar e conclui que o checkpoint falhou;
ele não falhou.**

> Isto é a Fase 1, item 4 — *"tipos divergentes entre o que o backend retorna e o que o frontend
> espera"* — na sua forma mais cara: a ação que `CLAUDE.local.md` e a memória
> `feedback_rayzen_checkpoint_habit` mandam repetir **a cada item de trabalho** é a única que
> derruba o app. E o `catch { /* silencioso */ }` do `doCheckpoint` (`page.tsx:806`) não protege:
> o erro não acontece no `fetch`, acontece no render seguinte.

**Correção aplicada — as duas pontas.**

1. **`page.tsx`** — `doCheckpoint` parou de tratar o 202 como artefato. Agora abre a modal em
   estado de carregamento e **relê `GET /synthesis/artifacts`** em janelas crescentes
   (4s · 6s · 10s · 15s · 20s), parando assim que a lista cresce. É o que a própria mensagem do
   endpoint manda fazer. A leitura foi extraída para `buscarArtefatos()`, agora fonte única
   compartilhada com `openSynthesis`.
2. **`SynthesisModal.tsx:60`** — `a.sessionId` protegido como todo o resto do bloco. Cinto: um
   artefato malformado vindo de qualquer outra origem passa a render um `—` em vez de derrubar
   a árvore.

`onSynthesizeCurrent` (`page.tsx:614`) usa o mesmo padrão e **foi verificado como seguro** —
`POST /synthesis/session` é síncrono e devolve `{ id, sessionId, projectId, synthesis, createdAt }`
(`synthesis.service.ts:99`). Não foi tocado.

**Verificação — exercitada, não deduzida.** Web local (`:3000`) contra a API de produção, clique
real via Puppeteer:

```
--- clicando em checkpoint ---
  POST 202 https://api.rayzen.com.br/synthesis/checkpoint
  t+6s: … fechar 19/08/2026, 15:40:14 checkpoint low checkpoi… Foi executado um diagnóstico…
RESULTADO: NAO QUEBROU
```

E o artefato exibido **é o que aquele clique acabou de criar** — `session_artifacts`
`696c8c48-9333-4eac-98c9-9c48801406e7`, sessão `checkpoint-1787164813985`, `18:40:14 UTC`.
`pnpm test` 843/843 e `pnpm typecheck` nas 5 apps, verdes.

> Para exercitar o web local contra a API de produção é preciso subir o Chrome de teste com
> `--disable-web-security`: `api.rayzen.com.br` não libera CORS para `http://localhost:3000`. É
> flag do harness de teste — nada em produção mudou.

---

### [alta] O painel de custo superestima o gasto em 4,4×, e 84% do total vem de um preço errado

- **Camada:** api-v1 · **Tipo:** modal (`costs`) · **Status:** **quebrado**
- **Classe:** bug · **Esforço:** pequeno

**Evidência — o que a tela mostra:**

```
Tokens 3.383.124 | Mensagens 1.094 | Custo est. $10.5208
POR MÓDULO
  documentation  58%  $1.3633
  project-state  29%  $8.8402      ← 29% dos tokens, 84% do custo
  synthesis      13%  $0.3155
```

**Causa raiz — identificada.** `costs.service.ts:14-24` mapeia módulo → modelo com uma constante
**fixa**:

```ts
const MODULE_MODEL: Record<string, string> = {
  'project-state': 'gpt-4o-premium',   // $9.00 / 1M
  'documentation': 'gpt-4o',           // $0.70 / 1M
  …
}
```

Mas o `project-state` **não escolhe o modelo estaticamente** — escolhe em runtime
(`project-state.service.ts:393-394`):

```ts
const premiumEnabled = … this.rayzenConfig.getConfig().premiumStateRefresh ?? false
let model = premiumEnabled ? 'gpt-4o-premium' : 'gpt-4o'
```

E o valor em produção, lido ao vivo em `GET /configuration`:

```
premiumStateRefresh = false
```

Ou seja: **o módulo roda em `gpt-4o` ($0,70) e é cobrado como `gpt-4o-premium` ($9,00) — 12,86× a
mais.** Como ele responde por 84% do total exibido, o painel inteiro erra:

| | exibido | corrigido |
|---|---:|---:|
| project-state | $8,8402 | **$0,6876** |
| **total do mês** | **$10,5208** | **≈ $2,37** |

Há ainda um terceiro caminho não modelado: em rate limit o service cai para `gpt-4o-mini`
(`:402-403`), que o mapa também não representa.

> Isto é exatamente a família de falha do `cost-controller` já registrada em `docs/FROZEN.md` — a
> diferença é que lá o painel mostrava **$0** por não gravar nada, e aqui mostra um número
> **plausível e errado**, que é pior: não há sintoma. Vale notar que existem **dois** sistemas de
> custo sem reconciliação — este (V1, estimado por token) e o `cost_records` da V2 (medido), que
> para este projeto devolve `$0,0163`.

**Recomendação.** Parar de inferir o modelo pelo módulo. O modelo real é conhecido no momento da
chamada — gravá-lo junto com `tokens_used` na `conversation_messages` e precificar pelo valor
gravado. Enquanto a coluna não existir, ler `premiumStateRefresh` na hora de precificar já derruba
o erro dominante. E atualizar o comentário da tabela de preços: ele cita
`llama-3.3-70b` e `llama-3.1-8b`, **descontinuados em 17/08**.

---

### [alta] Goal Graph — confirmado pela tela: fica em "Carregando…"

- **Camada:** frontend + api-v1 · **Tipo:** modal (`grafo`) · **Status:** **quebrado na prática**
- **Classe:** bug · **Esforço:** médio

Corrobora o **F-003** do `inventario-final.md` pelo lado do usuário. Com projeto ativo e 7 segundos
após o clique, o painel mostra apenas:

```
GOAL GRAPH | Estado atual | Goal Graph | Eventos | Universe | × | Carregando… | atualizar | definir meta
```

Screenshot em `scratchpad/shots/m2-grafo.png`. Isso é o caminho frio de **64,7s** medido na sessão
1 visto de dentro da interface: não há erro, não há timeout, não há mensagem — só um spinner que o
usuário não sabe que vai durar mais de um minuto. **É a única tela do sistema que não entrega
conteúdo dentro do tempo de atenção.**

Recomendação inalterada (servir `lastGapAnalysis` persistido e recalcular em background). Some-se:
enquanto durar, a tela deveria dizer que está sintetizando com LLM, não "Carregando…".

---

### [baixa] `/deck` — os 4 vídeos da apresentação retornam 404

- **Camada:** frontend + integração externa · **Tipo:** rota · **Status:** **quebrado**
- **Classe:** bug · **Esforço:** pequeno

**Evidência.** Quatro respostas 404 e quatro erros de console, todos em `stream.mux.com`:

```
404 GET https://stream.mux.com/uQk018u7PZM01VbSA8k4xI3dwS01Q7iWVMf.m3u8
404 GET https://stream.mux.com/j1p02zY1DKxO4L3mIh3BH3X2HoYH012oW00.m3u8
404 GET https://stream.mux.com/fXNzVYXy3mJQ9pJZ3bA02JNzjPqha00pFQ.m3u8
404 GET https://stream.mux.com/VNwG1RZ3q3C2QdLI2zFA3Q02Hj7P6D2wV.m3u8
```

**Causa raiz — identificada.** `deck/page.tsx:53-54` monta a URL a partir de `playbackId`
codificado na página; os assets não existem mais no Mux (conta expirada ou vídeos removidos). O
texto do deck renderiza normalmente — só os vídeos faltam.

> É a mesma classe do incidente da Groq de 17/08: **dependência de terceiro que some sem avisar**.
> A diferença é o alcance — aqui é uma página de apresentação comercial, não a plataforma.

**Recomendação.** Decidir se o `/deck` ainda é usado. Se sim, re-hospedar os quatro vídeos e tratar
falha de carga com fallback visível; se não, é candidato natural a remoção — é a única rota do app
que depende de um serviço externo pago.

---

### [baixa] `/insights` ignora o projeto ativo e obriga a escolher de novo

- **Camada:** frontend · **Tipo:** rota · **Status:** **parcial**
- **Classe:** decisão de produto pendente · **Esforço:** pequeno

Com `rayzen_active_project_id` = Rayzen AI semeado e o header exibindo "Rayzen AI", `/insights`
abre em *"selecione um projeto…"* e *"Escolha um projeto para ver os números."*

`grep -n "rayzen_active_project_id\|activeProject\|useProjects" apps/web/app/insights/page.tsx`
não retorna nada: a página tem seletor próprio e **não lê o projeto ativo global**.

Não é bug de código — é ausência de regra sobre se o projeto ativo é global ou por tela. Vale
decidir de uma vez, porque `/catalog` e `/guardian` também têm seleção própria.

---

## Não reproduzido — registrado para não virar lenda

Na primeira varredura, `/discovery` estourou o `networkidle2` em **72,7s**. Investigado antes de
reportar:

- nenhuma requisição ficou aberta após 30s (sonda dedicada, `scratchpad/disc.mjs`)
- `discovery/page.tsx` não tem `EventSource`, stream nem `setInterval`
- **3 novas tentativas: `HTTP 200` em 1.059ms, 1.754ms e 1.695ms**

Foi transiente. **Não é achado.** Fica aqui porque um número desses em anotação solta vira "a
discovery é lenta" na próxima sessão.

---

## O que a Fase 2 ainda não cobriu

- **Escrita parcial** — 3 fluxos submetidos (capturar, chat, checkpoint). Seguem não exercitados:
  criar projeto, definir meta, importar blueprint, regenerar docs, criar missão.
- **Interação dentro do modal** — abas (`tendência`/`histórico` do QA, `Eventos`/`Universe` do
  grafo), filtros e paginação não foram clicados.
- **`/mission/[id]`** — a rota de detalhe não foi visitada.
- **Falha de dependência** — segue não coberto, pelo mesmo motivo: derrubar serviço no H81 cegaria
  o hook e o MCP da sessão.
- **`histórico` (F-001)** — não re-exercitado aqui; o diagnóstico da sessão 1 é do dado e não muda.
