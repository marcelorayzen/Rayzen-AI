# Auditoria — estado das fases

> Sessões 1 e 2 · 2026-08-19. Retomada por aqui.
>
> A sessão 1 seguiu o **critério de parada** do prompt em vez de varrer as 5 fases em ordem: os
> três itens priorizados até causa raiz. A sessão 2 fechou a Fase 2 de leitura, clicando a UI de
> verdade. O que sobrou está registrado como pendência — nunca como "assumido funcionando".

---

## Fase −1 — o que já sabemos e NÃO precisa ser re-auditado

| Fonte | O que já está estabelecido |
|---|---|
| `docs/FROZEN.md` | **5 módulos V2 congelados** com evidência de não-uso medida em 13/08: `mission-scheduler`, `observability`, `vault`, `resource-manager`, `qa-engine`. Se aparecerem como órfãos, são **já conhecidos** |
| `docs/FROZEN.md` | `knowledge` (570 nós) e `cost-controller` (220 registros) **não** são órfãos — têm dado e já ganharam tela em `/insights` |
| memória `project_rayzen_audit_2026-08` | O eixo de diagnóstico deste projeto é **existe · recebe dado · é alcançável**. Usado aqui, sem taxonomia nova |
| memória `project_rayzen_audit_2026-08` | "sem consumidor" precisa dizer *consumidor de quê* — contar só o que a UI chama superestima o desperdício |
| `CLAUDE.md` | Invariantes (10) e ciclos automáticos (5) já documentados. Confirmados nesta sessão, não re-derivados |

**Correção de estado ao vivo:** `CLAUDE.local.md` registra o ciclo `guardian` como `nunca-subiu`.
Medido hoje em `GET /v2/system/status`: **os 5 ciclos estão `saudavel`**, guardian incluído.

---

## Cobertura desta sessão

| Fase | Situação | Onde |
|---|---|---|
| −1 · ler o já auditado | ✅ completa | esta seção |
| 0 · inventário | 🟡 **parcial** — frontend e backend mapeados por contagem e por chamada; agent e integrações só parcialmente | `inventario.md` |
| 1 · estática | 🟡 **parcial** — feita só sobre os itens priorizados | `inventario-final.md` |
| 2 · funcional | ✅ **leitura completa** + 3 fluxos de escrita (sessão 2) — 10 rotas, 9 modais e 3 submissões reais | `fase2-funcional.md` |
| 3 · cobertura | ✅ completa | `inventario-final.md` (F-004) |
| 4 · consolidação | ✅ completa | `inventario-final.md` |
| 5 · registro no Rayzen | ✅ completa | ver abaixo |

### O que foi gravado no Rayzen (Fase 5)

| | |
|---|---|
| **Backlog** | `PATCH /projects/:id/state/planning` com a **lista inteira** — 4 itens que já existiam (id preservado) + 3 achados = **7**, abaixo do teto de 10. Verificado após a escrita: 7 gravados, `milestones` (3) e `nextSteps` (2) intactos |
| **Evento** | **um** consolidado, `intent: problem`, apontando para `inventario-final.md`. Não um por achado — dezenas de eventos com `intent: problem` passariam a dominar objetivo e foco na próxima síntese |
| **Aprendizado** | `rayzen_capture_learning` — "Teste com prisma mockado não pega defeito que mora na forma do dado" (`gotcha`), com o método de diagnóstico reproduzível |

> O MCP `rayzen_update_planning` **não expõe `backlog`** — só `milestones`, `blockers`, `nextSteps`.
> O backlog foi escrito pela API (`PATCH …/state/planning`, que aceita o campo), enviando a lista
> completa por causa da semântica de REPLACE.

### Como a UI foi exercitada

**Sessão 1:** nada foi clicado. Exercitei a camada abaixo do clique — os endpoints de cada
componente, com token real, contra o banco de produção, de dentro do servidor.

**Sessão 2:** clique real, com **Puppeteer 22.15.0 que já era dependência do repo** (`apps/api`,
usado para PDF). Nada instalado, `package.json` intocado, headless — não toma a tela. Deu o que
faltava: erro de console, exceção de página e toda resposta HTTP ≥ 400. Método completo e as duas
correções de rota em `fase2-funcional.md`.

> A escolha registrada no início da sessão 2 foi `jarvis:browse_and_screenshot`, e ela **não servia
> sozinha** — não clica, e os ~19 modais são estado React, não endereçáveis por URL. Serviu para a
> primeira descoberta da sessão (F-007) e foi substituída pelo Puppeteer.

> **Pendência da sessão 1, agora resolvida:** o `curl` da máquina de trabalho devolvia `HTTP=000`
> porque `web`/`api`/`api-v2` publicam **só em `127.0.0.1`**. Virou o achado F-007.

---

## Achados desta sessão

| id | item | classe | severidade |
|---|---|---|---|
| F-001 | ✅ **CORRIGIDO** — `histórico` só listava telemetria; filtro por "tem mensagem de usuário" | bug | **alta** |
| F-002 | ✅ **CORRIGIDO** — upload na UI + a imagem **nunca podia renderizar** (401 no `<img>`) | feature incompleta + bug | média |
| F-003 | ✅ **CORRIGIDO** — Goal Graph levava **64,7s**; análise gravada passa a ser servida e recalculada em background | bug | **alta** |
| F-004 | ✅ **FECHADO** — invariante `historico_serve_conversa` (dado) + `pnpm smoke:web`, 12 asserções (renderização) | decisão de produto pendente | **alta** |
| F-005 | ✅ **CORRIGIDO** — painel de custo superestimava 4,4×; modelo resolvido pela configuração | bug | **alta** |
| F-006 | 🟡 **MITIGADO** — 1 de 5 vídeos vive; os 4 mortos degradam para gradiente. Re-hospedar ou remover = decisão | bug | baixa |
| F-007 | ✅ **CORRIGIDO** — 6 arquivos; o defeito era maior: os docs do **agent** também prescreviam portas inalcançáveis | bug de documentação | média |
| F-008 | ✅ **CORRIGIDO** — `/insights` restaura a escolha do header; o achado estava **parcialmente errado** | bug | baixa |
| **F-009** | ✅ **CORRIGIDO** — `checkpoint` derrubava a aplicação (202 tratado como artefato) | bug | **alta** |
| **F-010** | ✅ **CORRIGIDO** — **PolicyEngine devolvia 500 desde ~30/06**: migração declarava UUID contra um banco TEXT | bug | **alta** |
| F-011 | ✅ **CORRIGIDO** — seção de contexto que falha sumia calada, e o buraco entrava no cache | bug | média |

F-001 a F-004 em `inventario-final.md`; F-005 a F-009 em `fase2-funcional.md`.

### F-010 — a migração que não aplicava escondia uma queda de produção

Achado **por acaso**, ao investigar por que `prisma migrate status` estava sujo — e a contabilidade
de migração não era o problema, era o sintoma.

`20260630000000_policy_exceptions` declarava `id`/`rule_id` como **UUID**, mas `v2.policy_rules.id`
é **TEXT**: a tabela real nasceu de `prisma db push` a partir de `String @id`, não deste diretório.
O Postgres recusava a FK (`Key columns "rule_id" and "id" are of incompatible types: uuid and text`)
e a migração falhava **toda vez**, desde 30/06 — 53 dias.

O que isso derrubou: `policy-engine.service.ts:168` chama `findActiveException()` para **cada regra
em toda avaliação**. Sem a tabela, o Prisma lançava e `POST /v2/policy/evaluate` devolvia **500**.
O PolicyEngine inteiro estava fora do ar, incluindo o `block` que impede conhecimento com trust
baixo de entrar no Brain.

**Nada acusou.** Heartbeats verdes, invariantes verdes, painel verde — o mesmo padrão da quebra da
Groq em 17/08 e o mesmo da auditoria de agosto: *construído, e ninguém exercita*.

| | antes | depois |
|---|---|---|
| `POST /v2/policy/evaluate` | **500** | 200 |
| trust 0.2 | — | `allowed:false`, bloqueado por `low_confidence_knowledge` |
| trust 0.95 | — | `allowed:true` |
| regras habilitadas | 3 (uma só no arquivo) | 4 |

A regra `synthesizer_requires_sources` existia **apenas no SQL** e nunca chegou ao banco. Inserida
junto — com `updated_at` explícito, porque a coluna é `NOT NULL` sem default (o Prisma a gerencia
via `@updatedAt` na aplicação, então SQL cru precisa preenchê-la).

Aplicado em produção com `prisma migrate diff` (read-only) para obter o delta exato, dentro de
transação, e só então `migrate resolve --applied` — **depois** de corrigir o arquivo, senão o
checksum gravaria a versão errada.

> **A lição vale além deste caso: na V2, migração é decorativa.** O schema real vem de `db push`.
> Um diretório de migrações que ninguém roda não é documentação inofensiva — é uma segunda fonte
> de verdade que discorda em silêncio, e aqui ela custou 53 dias de motor de política morto.

#### Verificado em produção — 2026-08-22T01:24Z (deploy `0642b54`)

Deploy conferido pela regra da casa: **container mais novo que a imagem**, nunca `docker compose ps`.
`api-v2` img `01:23:45` → cont `01:24:05`. Webhook entregou 8s depois do push (202), sem o atraso
de 36 min visto em 17/08.

| sonda | resultado |
|---|---|
| `POST /v2/policy/evaluate`, `trustScore: 0.2` | `allowed:false` — `low_confidence_knowledge` |
| `POST /v2/policy/evaluate`, `trustScore: 0.95` | `allowed:true` |
| `POST /v2/context/surgical` | `falhas: []`, 6 seções, 3.174 chars, sem aviso (correto — nada falhou) |

> Duas armadilhas de payload no caminho, e as duas são do tipo que dá **falso negativo de
> auditoria**: o DTO exige `operation` (não `action`), e a regra lê `ctx.data.trustScore` — mandar
> em `payload` é aceito com **200 e sem violação**, exatamente igual a "a regra não existe".
> Sonda que não conhece o contrato mede o próprio erro.

**Fica aberto, agora visível:** `v2.policy_rules` tem **2 linhas por regra** nas 4 antigas (8
linhas, todas `project_id NULL`), inclusive 2 ativas de `deployment_requires_review`. Não foi
introduzido aqui — a regra nova entrou uma vez só. Era invisível enquanto o motor devolvia 500.

### F-011 — seção de contexto que falha sumia calada

O `catch` do `Promise.all` em `ContextEngineService.build()` só logava, e o log fica no servidor.
Do lado de fora, `memory_relevant` ausente por **falha transitória** era indistinguível de
`memory_relevant` ausente por **não haver memória relevante** — e as duas pedem reações opostas:
uma é "não há o que saber", a outra é "eu não sei o que há".

Achado medindo o n5: a seção veio vazia numa consulta porque o container tinha acabado de subir.
Nada no pacote dizia isso.

Continua sem relançar de propósito — retrato parcial vale mais que exceção. O que faltava era o
rastro: `falhas[]` no pacote, aviso **no texto** (só quando há falha), e a guarda de cache — sem
ela, meio segundo de falha congelava o buraco pelo TTL inteiro, fazendo o erro durar ordens de
magnitude mais que a causa.

### ✅ Deploy executado e verificado em produção — 2026-08-20T01:29Z

Push às `01:28:27Z` → webhook entregue `01:28:36Z` (9s) → **containers recriados `01:29:29`/`01:29:40`,
mais novos que as imagens `01:29:13`/`01:29:23`.** A troca aconteceu de fato — conferido por
`docker inspect`, não por `docker compose ps`.

**Medido em produção, depois do deploy:**

| | antes | depois |
|---|---|---|
| **F-001** `GET /sessions` | **20 de 20** com título "Conversa" | **0 de 20** — "responda apenas: ok", "qual estado atual do projeto?", "descreva a historia desde o inicio do rayzen ai" |
| **F-005** custo do mês | **$11,1722** | **$2,5554** · `project-state` agora `gpt-4o` a $0,7396 |
| **F-003** `graph/goal` ×3 | **64,7s** · 0,034s · 0,010s | **0,021s · 0,012s · 0,005s** — inclusive a primeira |
| **F-009** clique em `checkpoint` | `TypeError` → página morta | `POST 202`, **sem crash**, modal com artefato real |

> A primeira chamada do Goal Graph já veio em 21ms porque as metas ativas **já tinham**
> `last_gap_analysis` gravada — a análise existia no banco desde sempre e nunca era lida.

---

### As quatro correções

| | o quê | verificação | testes |
|---|---|---|---|
| **F-009** | `checkpoint` parou de tratar o 202 como artefato; `sessionId` protegido | clique real: `POST 202`, sem crash, modal exibiu **o artefato que o clique criou** | ⚠️ **nenhum** — `apps/web` não tem runner (F-004) |
| **F-005** | modelo do módulo resolvido pela configuração, não por constante | projetado sobre o dado real do mês: **$11,1722 → $2,5210** (4,43×) | 6 novos, **validados reintroduzindo o bug** (2 falham) |
| **F-001** | histórico filtra por "tem mensagem de usuário", antes do corte | consulta nova em produção devolve títulos reais até junho | 3 novos + 1 reescrito |
| **F-003** | gap analysis sai do caminho da resposta; valor gravado servido, recálculo em background | 3 das 4 metas ativas **já têm** `last_gap_analysis` gravada → servem na hora após deploy | 6 novos, **4 falham** com o bug reintroduzido |
| **F-004** | invariante `historico_serve_conversa` (11º do catálogo) **+** `pnpm smoke:web` | invariante: 20 servidas, 0 genéricas → OK · smoke: **13/13**, e **vermelho com o F-009 reintroduzido** | 5 novos + 13 asserções de UI |
| **F-002** | `+ enviar print` no `EvidenceModal` **+** imagem buscada com auth e servida por blob | upload exercitado pela UI: `POST 201`, imagem renderizou (4×4 reais), exclusão limpou banco e disco | 1 asserção de UI |

`pnpm test` **843 → 863** (api 411 · api-v2 362 · agent 90), typecheck das 5 apps verde.

**F-007 era maior do que registrei.** Não eram só as URLs do navegador: `docs/HOOKS.md`,
`docs/MCP_INTEGRATION.md` e `docs/GUARDIAN.md` mandavam configurar o **agent** com
`servidor-local:3101/:3103` — que nunca funcionaria. A config real, lida do
`hook.config.mjs` que funciona, é `https://api.rayzen.com.br`. Corrigidos 6 arquivos.

> **Uma porta que parecia errada estava certa:** `langfuse` publica em `0.0.0.0:3200`, então
> `http://servidor-local:3200` responde. Quase troquei junto num `sed` cego. O critério não é
> "é IP:porta", é **em que interface o container publica** — `docker ps --format '{{.Ports}}'`.

**F-008 estava parcialmente errado, e vale registrar.** Chamei de inconsistência descuidada; o
código tinha um comentário deliberado — *"sem default silencioso para um projeto fixo: atribuir
custo ao projeto errado já aconteceu"* — fundamentado no incidente da Urna. A decisão era **certa**
e continua valendo. O que ela conflava são duas coisas diferentes: **default arbitrário** (perigoso,
segue proibido) e **restaurar a escolha explícita do usuário** (não é default). Só a segunda foi
implementada, sem fallback para `list[0]`.

**F-006 ficou mitigado, não fechado — e a medição mudou o enunciado.** Não são "os 4 vídeos": são
**4 de 5**; o primeiro slide responde `200` e toca. Os `playbackId` vêm de
`NEXT_PUBLIC_MUX_PLAYBACK_ID_1..5`, que **não existem em lugar nenhum** — o código roda nos
fallbacks fixos. As env entraram no `.env.example` e slide sem vídeo válido passou a exibir
gradiente em vez de quadro preto (verificado: 1 vídeo + 4 fallbacks, zero erro de JS).
**Re-hospedar os 4 ou aposentar o `/deck` continua sendo decisão de produto.**

> **O F-002 escondia um segundo defeito, mais grave que o primeiro.** A parte conhecida era a
> ausência de upload. Ao exercitar o caminho novo, o print subiu (`POST 201`) e **a imagem não
> apareceu**. Medido: `GET /evidence/file/…` responde **200 `image/png` com token e 401 sem** — e
> `<img src>` não manda header. **Nenhuma evidência jamais poderia ter renderizado**, com ou sem
> upload. O primeiro `onError` que escrevi dizia "arquivo não encontrado" e era diagnóstico errado:
> o arquivo estava no disco.
>
> Corrigido buscando com `authHeaders()` e exibindo por `blob:`. As alternativas — abrir o endpoint
> ou aceitar token na query — trocariam autenticação por URL difícil de adivinhar, ou poriam o JWT
> em log de acesso e histórico do navegador. O link "abrir" tinha o mesmo defeito e virou botão.

> **Por que o F-004 começou por um invariante e não por Playwright.** A recomendação original
> dizia isso, e a razão ficou mais forte com os consertos: **3 dos 4 defeitos de alta severidade
> moravam na forma do dado**, onde teste com Prisma mockado é estruturalmente cego — o fixture
> representa o dado que o autor imaginou, nunca o que existe.
>
> O invariante sonda `GET /sessions` e mede a **saída**. Medir a composição da tabela daria
> vermelho permanente (a telemetria domina por desenho), e replicar a query do service dentro do
> check repetiria o `Invariante 1` da V1 — enunciado sem sensor, verde com 236 órfãos no banco.
>
> **A parte de renderização foi fechada sem Playwright.** O `pnpm smoke:web` usa o puppeteer que
> **já era dependência** do `apps/api` (está lá para PDF) e clica a UI de verdade: 12 asserções,
> cada uma amarrada a um defeito real. Instalar Playwright nunca foi o bloqueio — o custo estava
> em onde rodar: E2E no CI exigiria Postgres, Redis, LiteLLM, api, api-v2 e web com dado semeado.
> Rodando contra o ambiente no ar, o ambiente já existe.
>
> **Validado como manda a casa:** reintroduzi o F-009 num build local e a suíte ficou vermelha com
> o diagnóstico certo, saindo com código 1. Verde não conta enquanto não se viu o vermelho.
>
> **Limite:** verifica **depois** do deploy. A variante de build local
> (`RAYZEN_WEB_URL=http://localhost:3000 RAYZEN_API_URL=…`) cobre o antes, mas exige subir o web
> à mão.
>
> **Levar para o CI: decidido em 20/08, adiado para depois.** O que isso exige, medido e não
> estimado: o CI hoje não tem `services:` — precisaria de Postgres + Redis + LiteLLM + api +
> api-v2 + web com dado semeado, ou apontar o job para o ambiente no ar (mais simples, mas aí o
> CI passa a depender de produção estar de pé). É a decisão de fundo, e ela vem antes da escolha
> Playwright × Puppeteer.

> **Limite conhecido do F-005:** continua sendo inferência. O fallback para `gpt-4o-mini` em 429
> (`project-state.service.ts:402`) segue não modelado, e não há como saber o modelo de uma linha
> histórica. O conserto estrutural é uma coluna `model` em `conversation_messages` gravada no
> momento da chamada — **21 pontos de escrita em 9 services**, medido, não estimado.
>
> **Limite conhecido do F-001:** o filtro corrige a leitura; a telemetria continua sendo escrita
> na mesma tabela da conversa. Separá-las é a correção estrutural.
>
> **Limite conhecido do F-003:** meta sem análise gravada ainda paga um cold start de ~60s — é
> inevitável sem pré-computar, e vale só uma vez por meta. E a janela de 10min é escolha, não
> medição: recalcular a cada requisição custaria uma chamada de LLM por clique.

> **O saldo da leitura é positivo:** 10 de 10 rotas em `HTTP 200`, 9 de 9 modais com dado real,
> zero erro de JavaScript fora do `/deck`. **Mas a escrita mudou o laudo:** dos 3 fluxos
> submetidos, 2 funcionam e **1 derruba o app** (F-009, `checkpoint`).
>
> **A lição de método é essa.** A varredura de leitura sozinha teria fechado a Fase 2 com "a UI
> está saudável" — e o defeito mais grave da auditoria inteira está atrás de um botão que só
> aparece quando se clica nele. Ler não é exercitar.

---

## Pendências para a próxima sessão

Em ordem do que rende mais:

0. ~~Deploy dos 4 fixes~~ — **feito e verificado em produção em 2026-08-20T01:29Z.** Ver abaixo.
1. **Escrita — 3 de 8 fluxos exercitados.** Feitos: `capturar` (✅), chat (✅), `checkpoint` (❌
   F-009). Faltam: **criar projeto**, **definir meta** (bloqueado por F-003 — mora dentro do modal
   `grafo`, que não carrega), **importar blueprint**, **regenerar docs**, **criar missão**. Faltam
   também as abas internas dos modais (`tendência`/`histórico` do QA, `Eventos`/`Universe` do
   grafo) e a rota `/mission/[id]`.
2. **Fase 1 completa** — o cruzamento contrato frontend↔backend foi feito por sonda (31
   endpoints), não por diff exaustivo dos ~65 paths V1 + 28 V2 contra as 299 rotas. Restam ~230
   rotas sem consumidor identificado; a maioria é infraestrutura interna (ver lição de método da
   Fase −1), mas o número não foi apurado.
3. **44 ações do agent** — contadas (bate com a doc), **não** cruzadas com handlers. Whitelist sem
   handler e handler fora da whitelist seguem não verificados.
4. **Falha de dependência** — não coberto, por decisão: derrubar serviço no H81 cegaria o hook e o
   MCP desta própria sessão.
5. **`catálogo` com dado real** (Fase 2.4) — não medido. Exige cruzar atividade com eventos/commits,
   não com `updatedAt`.
6. ~~Verificar se `:3101` é alcançável pelo navegador~~ — **resolvido na sessão 2**, virou F-007.
