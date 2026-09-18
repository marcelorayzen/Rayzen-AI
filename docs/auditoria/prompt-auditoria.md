# Auditoria completa — Rayzen AI

> **Como usar:** cole este arquivo inteiro como prompt no Claude Code, rodando dentro do repo
> (`c:/Users/marce/Desktop/Projects/rayzen-ai`), com esforço máximo. Ele foi desenhado para ser
> executado em fases — pode rodar tudo numa sessão longa ou uma fase por sessão, retomando pelo
> checkpoint. O resultado desta auditoria é o artefato base para o próximo ciclo do projeto:
> **tudo aqui vira dado, nada vira suposição.**

---

## Regras que valem para a auditoria inteira

Estas regras já existem no `docs/claude-ai-project-instructions.md` do projeto — a auditoria segue
o mesmo padrão, sem exceção:

1. **Não invente fato verificável.** Se uma rota, endpoint, tabela ou componente existe, confirme
   lendo o arquivo ou executando a chamada — nunca assuma pelo nome ou pela convenção do resto do
   projeto.
2. **Não afirme que algo "funciona" sem evidência.** Passar no build ou no lint não é funcionar.
   Só conta como "funciona" o que foi de fato exercitado — chamada real, clique real, query real
   — com o resultado registrado.
3. **Meça antes de propor mudança.** Cada achado vem com evidência reproduzível (comando rodado,
   output, screenshot, log). Achado sem evidência entra como "suspeita", em seção separada, não
   como "problema confirmado".
4. **Densidade, não volume.** Um achado com causa raiz identificada vale mais que dez sintomas
   sem explicação. Se não souber a causa raiz, diga isso explicitamente em vez de especular.
5. **Cada fase termina em checkpoint.** Ao fim de cada fase, grave um `rayzen_capture_learning`
   (se for aprendizado reaproveitável) e registre o estado da fase em `docs/auditoria/estado.md`
   — o que foi coberto, o que falta, o que foi encontrado — para que a próxima sessão retome sem
   perder contexto, mesmo que seja um Claude Code diferente.
6. **Números medidos vencem números citados.** Onde este prompt cita um número, ele é referência
   do dia em que foi escrito (2026-08-19). Meça de novo antes de usar como base.

---

## Fase −1 — Ler o que já foi auditado (evita redescobrir)

**Antes de qualquer coisa**, ler e resumir em `docs/auditoria/estado.md` o que já é conhecido:

1. **`docs/FROZEN.md`** — cinco módulos da V2 já foram auditados e declarados congelados, com
   evidência de não-uso. Eles **não são achados novos**. Se aparecerem como "órfãos" na Fase 1,
   marcar como *já conhecido* e seguir.
2. **Memória `project_rayzen_audit_2026-08`** (auditoria de 05/08) — já estabeleceu o padrão de
   falha deste projeto: toda funcionalidade falha em um de três estágios, **existe · recebe dado ·
   é alcançável**. Use esse eixo em vez de inventar taxonomia nova.
3. **`CLAUDE.md`** — seções "Invariantes do sistema" e "Ciclos automáticos" já documentam o que é
   checado e o que roda sozinho. Não re-derivar.
4. **`CLAUDE.local.md`** — meta ativa, backlog e incidentes recentes.

**Checkpoint fase −1:** uma lista curta de "o que já sabemos e não precisa ser re-auditado".

---

## Objetivo

Mapear **toda** a superfície funcional do Rayzen AI — frontend, backend V1, backend V2, agent,
widget, integrações externas — e para cada unidade funcional (uma página, um modal, uma rota, um
serviço, um ciclo em background) determinar:

- **Existe de fato** (código existe e está montado/roteado) ou é órfão (existe no código mas não é
  alcançável, ou é alcançável mas não existe implementação por trás)?
- **Funciona ponta a ponta** quando exercitado de verdade, ou quebra silenciosamente?
- **Tem dado real por trás**, ou mostra estado vazio/zerado disfarçado de "funcionando"?
- **É testado** por suíte automatizada, testado manualmente, ou não testado de forma alguma?
- **Depende de quê** (outro serviço, tabela, variável de ambiente, processo externo) e o que
  acontece quando essa dependência falha?

O output final é um inventário completo com veredito por item, organizado por severidade e
esforço de correção — não uma lista de impressões.

---

## Fase 0 — Inventário (mapa antes de julgamento)

Antes de avaliar qualquer coisa, construir o mapa completo. Sem isso as fases seguintes viram
achismo.

### 0.1 — Frontend: rota **não** é a mesma coisa que botão

⚠️ **A UI do Rayzen mistura rotas e modais.** Auditar tudo como se fosse rota produz falso
"órfão". Medido em 2026-08-19, as rotas de `apps/web/app` são **onze**:

```
/  ·  /catalog  ·  /deck  ·  /discovery  ·  /guardian  ·  /insights
/login  ·  /mission  ·  /mission/[id]  ·  /settings  ·  /work-panel
```

Boa parte do que parece item de menu é **modal aberto pelo `Header.tsx`** — os controles são
`setQuickCaptureOpen`, `setStateOpen`, `setCostsOpen`, `setGitOpen`, `setHealthOpen`,
`setImportOpen`, `setNewProjectOpen`. Outros são **painéis dentro** de `/insights` e
`/work-panel` (ex.: `QADashboardPanel.tsx`).

Para cada item de navegação visível na UI, anotar: **tipo** (rota | modal | painel), arquivo do
componente, como é alcançado, e qual(is) endpoint(s) chama. Confirme a lista acima antes de usar —
ela é de 19/08.

### 0.2 — Backend

Listar endpoints de `apps/api` (V1) e `apps/api-v2` (V2) — método, path, módulo NestJS
responsável, se tem teste cobrindo, e se é chamado por frontend/agent (endpoint morto = ninguém
chama). Referência de escala: ~**135 rotas em 31 controllers** na V1 e ~**164 em 30 controllers**
na V2. É volume demais para prosa — use tabela e agrupe por módulo.

### 0.3 — Agent

Módulos de `apps/agent` e as **44 ações** da whitelist (`apps/agent/src/security/whitelist.ts`):
quais são invocáveis a partir de qual fluxo, e quais estão na whitelist sem handler implementado
(ou o inverso: handler existe, não está na whitelist, logo é inalcançável).

### 0.4 — Background: duas famílias, não uma

⚠️ Não é tudo BullMQ. Existem **duas** famílias, e confundi-las esconde metade:

- **Fila BullMQ** — há essencialmente uma, `agent-tasks`.
- **Ciclos por `setInterval`** — `smart-checkpoint`, `invariants`, `memory` (backfill),
  `catalog` (sync), `qa-scientist`. Estes **não aparecem em nenhum dashboard de fila**.

Para cada um: o que dispara, com que frequência, e como se sabe que falhou. `CLAUDE.md` já
documenta os batimentos em `v2.system_heartbeats` e os quatro estados possíveis — confirme se o
que está documentado bate com o que roda.

### 0.5 — Integrações externas

LiteLLM (e **quais aliases realmente resolvem** — testar contra `infra/litellm/config.yaml`, não
ler só o arquivo), Notion, Postgres (schemas `public` e `v2`), Redis, Langfuse, Cloudflare Tunnel,
webhook de build do GitHub.

**Checkpoint fase 0:** `docs/auditoria/inventario.md` — uma tabela por camada, sem julgamento
ainda, só mapa. Commit.

---

## Fase 1 — Auditoria estática (código morto, quebra de contrato, imports fantasma)

Objetivo: achar quebras que aparecem sem precisar rodar nada.

1. Endpoint que existe no backend e não é chamado por ninguém → candidato a **órfão**.
2. Chamada no frontend/agent para endpoint que não existe (path errado, removido, V1↔V2 trocado
   sem atualizar o chamador) → **quebra de contrato**.
3. Componente que renderiza mas cujo botão não tem handler, ou o handler é stub/TODO.
4. Tipos divergentes entre o que o backend retorna e o que o frontend espera — fonte clássica de
   "a tela não atualiza" sem erro visível.
5. Variável de ambiente referenciada no código e ausente do `.env.example`.
6. Para cada item de navegação da Fase 0.1: componente existe, está montado, e o clique dispara
   chamada real (não placeholder).

**Prioridade explícita:** `evidências` e `histórico`. O usuário já reportou que "evidências"
(destinado a prints de teste manual) não tem função clara, e que "histórico" mostra itens que não
abrem. Para os dois, achar: componente exato, handler do clique, endpoint chamado (se houver), e
se a ausência de comportamento é **dado vazio no banco**, **erro engolido** (catch vazio, erro não
propagado) ou **rota nunca conectada a implementação**. As três causas levam a correções
diferentes — não aceite "não funciona" como diagnóstico.

**Checkpoint fase 1:** `docs/auditoria/fase1-estatica.md`, cada achado com `arquivo:linha`,
classificado como órfão / quebra de contrato / stub / dependência ausente.

---

## Fase 2 — Auditoria funcional (exercitar de verdade)

### ⚠️ Antes de começar: decidir COMO exercitar a UI

**Claude Code não clica em botão.** Playwright **não está instalado** no projeto (a menção a
Playwright na estratégia de teste do `CLAUDE.md` é aspiracional, herdada do plano original). As
opções reais são três — **escolha uma e registre a escolha antes de seguir**:

| opção | custo | limitação |
|---|---|---|
| `jarvis:browse_and_screenshot` via agent | zero, já existe | screenshot, não asserção; exige `rayzen-start.bat` rodando |
| instalar Playwright | dependência nova | dá asserção de verdade; vale se a Fase 3 recomendar E2E |
| o usuário clica e cola o resultado | tempo dele | mais confiável, não escala para 11 rotas + modais |

Se nenhuma for viável na sessão, **diga isso e pule para a Fase 3** — não simule clique nem
descreva comportamento esperado como se fosse observado.

### O que exercitar

1. Com o ambiente real (H81, que é o do dia a dia) e **dados reais do banco**, passar por cada
   item da Fase 0.1:
   - Registrar: o que deveria acontecer vs. o que aconteceu.
   - Tela vazia: é ausência de dado (esperado) ou query/filtro errado (bug)? **Verificar direto no
     banco** se existe dado que deveria aparecer.
   - Erro: capturar o erro completo (console do navegador + log do container), não só "deu erro".
2. **`evidências`** — descobrir e documentar o fluxo pretendido (usuário sobe print → onde salva →
   onde reaparece) e comparar com o que existe. Se nunca foi implementado por completo, dizer
   isso: **não é bug, é feature incompleta**, e a distinção muda o backlog.
3. **`histórico`** — reproduzir o clique que "não abre nada", capturar request/response, e
   determinar se é frontend (dado chega, não renderiza), backend (retorna vazio/erro) ou dado
   (não existe registro).
4. **`catálogo`** — confirmar com dado real: quantos dos projetos têm descrição, quantos têm
   missão associada, e há quanto tempo cada um não recebe atividade real. **Não usar `updatedAt`
   do projeto** como proxy de atividade — cruzar com eventos/commits. Há precedente registrado de
   `updatedAt` não refletir atividade (ver `contentChangedAt` no `CLAUDE.md`).
5. **Dashboard de QA** — confirmar exatamente o que compõe o número exibido: quais suítes, se
   cobrem fluxo de UI ponta a ponta ou só unidade/integração de backend. Determinar
   objetivamente o gap entre "testes passam" e "funciona na tela", com exemplos concretos de
   funcionalidade que o usuário sabe estar quebrada e que a suíte não captura.
6. **`missões`, `grafo`, `guardian`, `dados`, `síntese`, `voz off`, `docs`** — mesmo tratamento,
   sem pular nenhum por parecer "provavelmente ok".
7. **Falha de dependência** — ⚠️ **não desligar serviço no H81.** É o mesmo ambiente que serve o
   hook e o MCP da sessão em curso; derrubá-lo cega a própria auditoria. Fazer localmente, ou
   simular com timeout/mock, ou pular e registrar como não coberto.

**Checkpoint fase 2:** `docs/auditoria/fase2-funcional.md` — uma linha por item do inventário, com
veredito (funciona / quebrado / parcial / não implementado / não testável agora) e evidência.

---

## Fase 3 — Cobertura de teste real vs. percebida

1. Cruzar as suítes automatizadas com o inventário da Fase 0. Para cada unidade funcional:
   coberta por teste automatizado / só por verificação manual / sem cobertura.
2. Estimar **com número, não adjetivo**, que fração das funcionalidades reais (não das linhas de
   código) tem alguma verificação. Se for baixa, isso explica objetivamente por que 100% de pass
   rate convive com funcionalidade quebrada.
   > Medir a contagem de testes com `pnpm test`, não citar de memória — o número muda a cada
   > sessão. Em 19/08 eram 843 (api 396 · api-v2 357 · agent 90), **todos de unidade/integração
   > de backend**: não há E2E de UI no projeto.
3. **Só depois de ter o número**, propor o que precisa de E2E real versus o que segue coberto por
   unidade. Se recomendar E2E, dizer explicitamente que isso implica instalar Playwright.

**Checkpoint fase 3:** `docs/auditoria/fase3-cobertura.md`.

---

## Fase 4 — Consolidação e severidade

1. Juntar os achados das fases 1–3 num inventário único, cada item com o formato de saída abaixo.
2. Ordenar por severidade × esforço, não por ordem de descoberta.
3. Separar claramente:
   - **bug** — deveria funcionar e não funciona
   - **feature incompleta** — nunca foi terminada
   - **decisão de produto pendente** — ex.: catálogo sem critério de ciclo de vida de projeto.
     Isso não é bug, é ausência de regra, e o dono da decisão é o Marcelo.

**Checkpoint fase 4:** `docs/auditoria/inventario-final.md` — **este é o artefato principal.**

---

## Fase 5 — Registro no Rayzen (fechar o loop, sem entupir)

⚠️ **Duas armadilhas conhecidas do Rayzen, as duas ativas.** Ignorá-las apaga trabalho real:

- **`rayzen_update_planning` faz REPLACE**, não merge. Enviar backlog parcial **apaga o resto**.
- **O backlog tem teto de 10** no prompt de síntese e é truncado **na ordem enviada**, sem aviso.
  Medido em 18/08: 16 itens gravados viraram 10 no primeiro refresh.

Portanto:

1. **Achados moram em `docs/auditoria/`**, que é o registro completo. O backlog do Rayzen **não é
   registro** — é a fila do que está em foco.
2. **No máximo 3–5 achados** entram no backlog, os de maior severidade, e enviando **a lista
   inteira** (os que já estavam + os novos).
3. **Um evento consolidado**, não um por achado. Dezenas de eventos com `intent: problem` entram
   na janela do checkpoint e passam a dominar objetivo e foco do projeto — e o filtro de forma do
   `ProjectStateService` não os pega, porque são prosa legítima. Registrar um `rayzen_add_event`
   apontando para `docs/auditoria/inventario-final.md`.
4. Para achado com causa raiz confirmada **e correção aplicada** durante a auditoria, gravar
   `rayzen_capture_learning` (problema, solução, tags).
5. Atualizar `docs/auditoria/estado.md`: quantos itens auditados, quantos quebrados, quantos
   corrigidos, o que fica para o próximo ciclo.

> Se a auditoria consertar algo em `apps/agent/src/mcp/*.mjs`, lembrar: o servidor MCP é processo
> **persistente**, carregado na subida da sessão. A correção só vale ao reabrir o Claude Code.

---

## Critério de parada

Cinco fases sobre 11 rotas, ~300 endpoints, 44 ações de agent e 6 ciclos de background podem
consumir várias sessões. Se o tempo acabar, a ordem de prioridade é:

1. **`evidências` e `histórico`** — já reportados quebrados pelo usuário; são o motivo original
   desta auditoria.
2. **O gap entre 843 testes verdes e funcionalidade quebrada** (Fase 3, item 2) — é o número que
   muda decisão de investimento.
3. **Quebra de contrato frontend↔backend** (Fase 1, item 2) — barato de achar, quebra silenciosa.

O resto pode ficar para o próximo ciclo, **desde que registrado como pendência**, nunca como
"assumido funcionando".

---

## Formato de saída esperado (não aceitar menos que isso)

```
### [severidade] Nome da funcionalidade
- Camada: frontend | api-v1 | api-v2 | agent | ciclo | integração
- Tipo: rota | modal | painel | endpoint | ação | job        (frontend: obrigatório)
- Status: órfão | quebrado | parcial | não implementado | funcionando
- Evidência: <comando rodado / request-response / print / arquivo:linha>
- Causa raiz: <descrição> | "não identificada"
- Classe: bug | feature incompleta | decisão de produto pendente
- Esforço: pequeno | médio | grande
- Recomendação: <ação concreta, não "melhorar isso">
```

Se ao final de qualquer fase a cobertura não foi completa, isso entra explicitamente em
`docs/auditoria/estado.md` como pendência de fase — **nunca como "assumido como funcionando"**.
