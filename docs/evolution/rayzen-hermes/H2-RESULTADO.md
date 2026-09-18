# H2 — o Hermes consulta a plataforma: o que ele acerta e o que ele recebe errado

Data: 13-14/09/2026 · medido contra o spike em execução, com o MCP de leitura conectado.

**Critério C09:** fonte e projeto corretos, decisão vigente considerada, erro de consulta não vira
ausência de conhecimento, nada do projeto B dentro do A.

---

## 1. O que já funciona — e foi medido, não presumido

| teste | resultado |
|---|---|
| pergunta sobre projeto **que não é o default** do ambiente | ✅ resolveu `9ad98c5a` (VB Ferragens) via `list_projects`, **não** caiu no default `7690370b` |
| dois projetos na **mesma** conversa | ✅ ids corretos e conteúdos distintos — nada de B em A |

O desenho de escopo do MCP é sólido e não precisou de mudança: leitura cai no default com
`_warning` explícito, escrita **nunca** cai (`requireProjectId`), e o comentário do código já
registra o incidente de 03/08 que originou a regra.

## 2. Fonte errada: o objetivo veio do cadastro, não do estado

Perguntado *"qual o objetivo do projeto Rayzen AI"*, o Hermes respondeu:

> *"plataforma pessoal de IA … execução assistida **entre VPS e máquina local**"*

Isso é o campo `description` de `rayzen_list_projects` — texto de **cadastro**, escrito uma vez na
criação. O objetivo **vigente**, em `rayzen_get_state`, é *"Quem conversa com o Rayzen sabe onde
está, e o que decide fica registrado"*.

E a descrição está **desatualizada desde 09/08**: o servidor deixou de ser VPS quando virou a placa
H81. Ou seja — projeto certo, fonte errada, **informação obsoleta servida como estado atual**. É o
modo de falha que esta casa inteira existe para evitar, chegando pela porta da frente.

> **O modelo não errou por burrice.** A descrição da tool dizia apenas *"Lista os projetos
> existentes (id, nome, repoSlug, status)"* — não mencionava `description`, não dizia que é
> cadastro, e o payload trazia o campo. **Contrato incompleto é ambiguidade, e ambiguidade o
> modelo resolve sozinho.**

**Corrigido no contrato**, que é onde a decisão acontece: `list_projects` agora declara que
`description` é cadastro frequentemente desatualizado, proíbe usá-lo para objetivo/foco/estado, e
aponta `rayzen_get_state` (vigente) e `rayzen_get_resume` (o que mudou).

## 3. `200 null` — erro de consulta virando ausência de conhecimento

Pedido o estado de um id inexistente, o Hermes respondeu com o estado do **projeto default**, sem
avisar que o id não existia.

A causa é do lado do Rayzen: `GET /projects/<uuid inexistente>/state` devolvia **`HTTP 200` com
`null`**.

> `200 + null` é a pior resposta possível: **não é erro**, então ninguém trata; e **não é dado**,
> então quem consome preenche a lacuna. "Não encontrei" e "não consegui consultar" colapsam no
> mesmo silêncio — exatamente o que C09 proíbe.

**A correção precisou ser fina**, porque `null` tem significado legítimo: projeto real que ainda
não teve estado sintetizado. Quatro consumidores dependem disso — `rayzen-context-hook` (fallback),
as duas pontas do MCP (`get_state` e a leitura do `update_planning`) e a página da web.
Transformar tudo em 404 consertaria um caso e quebraria quatro.

| situação | antes | agora |
|---|---|---|
| projeto **não existe** | `200 null` | **404**, nomeando o id |
| projeto existe, sem estado ainda | `200 null` | `200 null` — intacto |

A query extra de existência só roda no caminho em que já não havia estado.

## 4. Vazamento de escopo na V2 — e uma correção ao meu próprio diagnóstico

`GET /events` filtra por `@Query('project_id')` — **snake_case**. Um chamador que envie `projectId`
não recebe erro: o filtro simplesmente some, e a query devolve os eventos **globais** mais
recentes, que são os do projeto mais ativo.

Medido lado a lado:

| chamada | projetos retornados |
|---|---|
| `project_id=<VB Ferragens>` | ✅ 10 do VB Ferragens |
| `projectId=<VB Ferragens>&type=decision` | ❌ **10 do Rayzen AI** |

> **Correção ao diagnóstico intermediário desta sessão:** cheguei a concluir que o MCP vazava
> escopo. Estava errado — **o MCP envia `project_id` e está correto**; foi o meu `curl` de teste
> que usou camelCase. O registro fica porque a conclusão apressada chegou a entrar no raciocínio,
> e porque ela ilustra o mesmo defeito que o parâmetro tem: nome errado não dá erro, dá resposta
> plausível.

Mas a busca por outros consumidores achou um **real**:
`apps/api-v2/src/core/v1-api.service.ts` → `getDecisionEvents()` usava `projectId`. Ou seja,
buscar as **decisões** de qualquer projeto devolveria as decisões do Rayzen AI.

**Estava sem chamador** quando foi encontrado — defeito latente, não ativo. Corrigido assim mesmo,
antes que alguém ligue o consumidor e herde o vazamento pronto.

## 5. "Readonly" não é "sem efeito"

`rayzen_get_context` está no token de leitura e não grava fato nenhum — mas a cadeia é:

```
POST /v2/context/build → ContextEngine:350 → MemoryService.search → trackAccess
```

e `trackAccess` incrementa `accessCount` e **promove `inbox → working` a partir de 3 acessos**.
Consultar muda o **ranking das consultas futuras**. Pior: a promoção mede **uso**, não verdade —
um agente perguntando em laço reordena a memória do projeto.

Não foi removido: é comportamento desenhado da memória V2, e mexer nele é decisão de produto, não
conserto. Foi **declarado no contrato da ferramenta**, com a alternativa nomeada:
`rayzen_search_memory` bate no **Brain V1** (`/brain/search`), fora do `trackAccess`.

E há um teste segurando essa promessa: se alguém migrar `search_memory` para a V2, a recomendação
viraria mentira sem nada acusar.

## 6. Mudanças

| arquivo | mudança |
|---|---|
| `apps/api/.../project-state.service.ts` | 404 quando o **projeto** não existe; `null` preservado para estado ausente |
| `apps/api-v2/src/core/v1-api.service.ts` | `projectId` → `project_id` em `getDecisionEvents` |
| `apps/agent/src/mcp/rayzen-mcp-http.mjs` · `rayzen-mcp.mjs` | contrato de `list_projects` (fonte) e `get_context` (efeito) |

Os dois `.mjs` porque as definições de tool são **duplicadas** entre o MCP stdio (que a sessão do
Claude Code usa) e o HTTP (que o Hermes usa) — o erro de fonte afetava os dois. Duas cópias
divergem em silêncio, então há teste anti-drift lendo os arquivos como texto, mesma família de
`memory-ranking.const.ts`.

**Specs:** `project-state/__tests__/projeto-inexistente.spec.ts` (4) ·
`mcp/__tests__/contrato-de-fontes.spec.ts` (10).

## 7. Estado

| item | estado |
|---|---|
| suíte `api` | ✅ 51 suites / 552 testes |
| suíte `agent` | ✅ 51 suites / 649 testes |
| suíte `api-v2` | ✅ 36 suites / 482 testes · typecheck limpo |
| C09 — escopo e isolamento | ✅ medido contra o Hermes real |
| C09 — fonte vigente | ⏳ corrigido no contrato, **reteste pendente** |
| C09 — erro ≠ ausência | ⏳ corrigido na API, **reteste pendente** |

> **Por que o reteste está pendente:** as correções de contrato vivem nos `.mjs` do MCP e a de
> `/state` na API. O `mcp-http` **não entra no webhook de deploy** (a lista é
> `web api api-v2 agent-server`), então nada disso chega ao Hermes até um push seguido de
> `docker compose up -d --build mcp-http` manual. Enquanto isso, o comportamento medido em §2 e §3
> continua sendo o que o Hermes faz.

## 8. Aberto

- **`/graph/goal` com id inexistente devolve `200`** com um grafo vazio "válido"
  (`{goal:null, state:null, mermaid:"…Nenhum…"}`). Mesma família do §3, não corrigido nesta
  rodada — `rayzen_get_goal` é uma das 9 ferramentas do Hermes.
- **Identidade (a outra metade de H2).** O `SOUL.md` que o Hermes carrega é o prompt padrão da
  Nous Research, **sem relação** com `core/identity/SOUL.md` do repositório — confirmado em H1. De
  onde deve vir a identidade efetiva do assistente continua sem resposta, e é decisão de produto,
  não de código.
- **C12** (corrigir um fato e ver a versão vigente prevalecer) não foi exercitado.
