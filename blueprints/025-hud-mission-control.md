# 025 — Rayzen HUD (Mission Control)

> **STATUS: IDEIA PARADA.** Nada aqui está aprovado para construção, com **uma exceção**:
> os itens **S1 e S2** da seção 6 são correção de segurança de um problema que já existe em
> produção, valem sozinhos e **não dependem de nenhuma linha de HUD**.
>
> O resto entra em pauta quando o sistema estiver rodando estável e houver motivo além de
> "seria bonito". O modo de falha registrado deste projeto é construir sem alimentar
> (`project_rayzen_audit_2026-08`) — este documento existe para **não** virar uma tempestade
> de 17 tarefas.

---

## 1. Para que serve, de verdade

Não é uma "HUD estilo Jarvis". O caso de uso real é **conferir o sistema pelo celular**: abrir e
ver, em poucos segundos, se algo está rodando, travado ou pedindo aprovação — sem SSH, sem
`docker logs`, sem abrir o notebook.

Isso muda três prioridades em relação a um painel de desktop:

- **Leitura, não operação.** O que importa é responder "está tudo bem?". Ações ficam restritas ao
  que é urgente pelo celular: aprovar/rejeitar gate.
- **Responsivo de verdade e econômico em banda.** Órbita bonita em tela grande não pode virar
  ilegível em 390px, e o payload não pode ser um snapshot inteiro a cada evento em rede móvel.
- **Tolerante a reconexão.** Celular perde conexão o tempo todo. Estado tem que reconciliar
  sozinho, não depender de ter recebido todos os eventos.

O valor secundário — e talvez o maior a longo prazo — é **manutenção**: um lugar onde o
descompasso entre "o sistema diz que está rodando" e "o sistema está rodando" fica visível.

## 2. Auditoria do backend (17/08, código lido, não inferido)

**`EventsGateway`** (`apps/api-v2/src/gateway/events.gateway.ts`, ws na porta **3104**, path
`/ws`, roteado pelo Caddy em `http://api.rayzen.com.br/ws`):

- Emite **4** tipos reais: `mission_update`, `approval_gate`, `mission_created`,
  `clarification_needed`. O union declara um quinto, `ping`, que **nunca é emitido** — o
  `ws.ping()` do gateway é ping de protocolo, outra coisa.
- `mission_update` carrega o snapshot inteiro (`id, title, status, steps`), nunca delta.
- `handleConnection` **não valida token nenhum**.
- O filtro por projeto (`events.gateway.ts:58`) só filtra se o cliente mandar `subscribe`. Sem
  isso, `projectIds.size === 0` e o cliente **recebe eventos de todos os projetos**.

**`mission.service.ts`**: estado em Postgres (`mission`, `missionStep`), consultável a qualquer
momento via `findOne`. **Sem campo de progresso agregado** — deriva-se contando steps por status.
`updateStep()` não emite; só `transition()` emite.

**`approval-gates.service.ts`**: o gate é uma linha `status: 'pending'`, sem Promise pendurada.
Retomada externa via `ApprovalGatesController.approve()` (atômico, `updateMany` com guarda).
`expireStale()` roda **dentro** de `findPending()` — não há cron, então um gate vencido continua
`pending` até alguém consultar. Ao expirar pausando a missão, chama `updateStep()` e emite
`approval_gate`, mas não `mission_update`.

**`specialist.service.ts`**: `EventsService` **não é injetado** — o specialist é mudo em WS. Único
progresso ao vivo é polling em `GET /v2/specialists/:id` ou `/active`, que leem um `Map` em
memória mutado in-place (`inst.iterations++`, `inst.costUsd`). O `Map` **nunca é limpo**
(`instances.delete` não existe) e some inteiro no restart.

`status: 'done'` **não é confiável**: a última iteração e o estouro de orçamento também produzem
`done`. Sinal real de sucesso = ausência de `output.stopReason` + presença de `actionsExecuted`.

`spawn()` devolve `'failed'` para gate pendente **e não põe a instância no Map** (então `GET /:id`
devolve `null`); `spawnAndWait()` devolve `'interrupted'` para o mesmo caso.

**`specialist.controller.ts`**: o registry tem **7** tipos, o `TYPES` do controller tem **6** —
falta `synthesizer`, que o `StepExecutor` usa internamente via `spawnAndWait` sem passar pelo
controller.

**`MissionScheduler`**: rotas registradas, `scheduled_missions` com **0 linhas**, nenhum módulo
fora do próprio importa o service. Não é integração — seria feature nova.

**Baseline para dimensionar payload:** 32 missões, 110 steps (~3,4 steps/missão).

## 3. O que já existe no frontend — inventariar antes de criar

Isto **não é greenfield**. Já em `apps/web/app/`:

| arquivo | linhas | o que já faz |
|---|---:|---|
| `mission/[id]/page.tsx` | 514 | página de missão, consome WS |
| `hooks/useRayzenEvents.ts` | — | conexão WS, resolve URL, **reconexão com backoff até 30s**, manda `subscribe` |
| `hooks/useMissions.ts` | 294 | listagem/estado de missões |
| `components/MissionsModal.tsx` | 268 | modal de missões |
| `hooks/usePendingGates.ts` · `components/ClarificationCard.tsx` · `components/DocsPanel.tsx` | — | gates e clarificação |

**Convenção de caminho:** `apps/web/app/components/` e `apps/web/app/hooks/`. Não existem
`components/` nem `hooks/` na raiz de `apps/web`.

> **Não criar `useWebSocket.ts`.** `useRayzenEvents` já faz o trabalho, incluindo reconexão. O que
> falta nele é autenticação (ver S1) — estender, não duplicar.

### O padrão de sino, que já está em uso e deve ser mantido

```ts
// mission/[id]/page.tsx:154
useRayzenEvents(mission?.projectId ?? null, (e) => {
  if (e.type === 'mission_update' || e.type === 'approval_gate') void load()
})
```

O evento é tratado como **notificação**, não como dado: chega, refetcha. É imune a evento perdido
ou fora de ordem e reconcilia sozinho na reconexão — exatamente o que o caso "celular em rede
ruim" exige. **Diffar snapshot é mais código, mais bug e perde isso de graça.** Só considerar diff
se medir que o refetch pesa.

## 4. Riscos

- **P0 ativo em produção, independente da HUD:** gateway sem autenticação, em `0.0.0.0:3104` e
  publicado pelo Caddy através do túnel, entregando eventos de **todos** os projetos a qualquer
  cliente que não mande `subscribe`. Existe agora, mesmo que a HUD nunca seja construída.
- **P0 junto com o anterior:** sem limite de conexões nem rate limit, é DoS trivial.
- Specialist "parece congelado" durante tool-use — nenhum campo observável muda enquanto skills
  executam.
- `Map` de instâncias nunca limpo: vazamento lento, e após restart `listActive()` devolve `[]`
  mesmo com steps `running` no banco — a HUD mostraria "nenhum specialist" numa missão ativa.

## 5. A bifurcação que decide o desenho da autenticação

**O widget já manda o token; o servidor é que ignora:**

```ts
// apps/widget/src/main/ws-client.ts:21
this.ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.token}` } })
```

**Mas navegador não consegue mandar header em WebSocket.** `useRayzenEvents` usa
`new WebSocket(url)` puro, e não há como contornar pela API do browser.

Três caminhos:

| opção | serve aos dois clientes? | custo |
|---|---|---|
| query string `?token=` | sim | token vaza em log de proxy/acesso |
| `Sec-WebSocket-Protocol` | sim | uso torto do header, mas padrão |
| **autenticação pós-conexão** | sim | conexão aberta por alguns segundos sem identidade |

> **Recomendação: a terceira, fundida com o `subscribe` obrigatório.** A primeira mensagem passa a
> ser obrigatória e carrega o token; conexão que não se identifica em N segundos é derrubada. Um
> mecanismo resolve autenticação **e** vazamento entre projetos.
>
> `JwtAuthGuard` **não serve** como está: usa `ctx.switchToHttp()`. A validação teria que chamar
> `jwt.verify` direto.

**Custo de migração: baixo.** Os dois clientes existentes já mandam `subscribe` — web
(`useRayzenEvents`, no `onopen`) e widget (`ws-client.ts:29`). Tornar obrigatório não quebra
ninguém hoje.

**São duas portas de entrada, não uma.** O widget vai **direto ao IP do servidor na LAN**
(`ws://servidor-local:3104/ws`, configurável por `RAYZEN_WS_URL` — `widget/src/main/index.ts:14`),
sem passar pelo Caddy; a web entra pelo túnel em `api.rayzen.com.br/ws`. Isso importa duas vezes:

- **Para S1**, a autenticação precisa valer nas duas — o que a proposta de token no `subscribe`
  resolve, por ser no protocolo e não no transporte.
- **Para o tamanho do P0**, o gateway está exposto *tanto* na LAN quanto publicamente pelo túnel.
  Não é só "alguém na rede local".

## 6. Backend — o que vale, em ordem

### Vale sozinho, sem HUD (correção de segurança)

- **S1** — autenticação no WS via `subscribe` obrigatório com token (ver seção 5).
- **S2** — limite de conexões + rate limit no gateway.

> S1 e S2 são a única parte deste documento que deveria ser feita independente da HUD. São
> *shippable* isoladamente e fecham um P0 que existe agora.

### Só faz sentido se a HUD for construída

- **H1** — `updateStep()` emite evento **e remove os `emitUpdate` redundantes do
  `StepExecutorService`** (linhas 87-88, 102-104, 126-127, 177-185). Sem remover, todo step passa a
  emitir 2×.
  > Isto **absorve** o conserto do gate expirado: `expireStale()` chama `updateStep()`
  > (`approval-gates.service.ts:305` e `:307`), então o `mission_update` que faltava vem de graça.
- **H2** — injetar `EventsService` em `specialist.service.ts`, emitindo após `inst.iterations++` e
  em volta de cada `skillEngine.run()`. **Com throttle e payload leve**
  (`{specialistId, iterations, costUsd, currentSkill}`), nunca snapshot: um debugger com 10
  iterações × várias tool calls geraria dezenas de broadcasts, e no padrão de sino cada um vira um
  refetch.
- **H3** — unificar `spawn()`/`spawnAndWait()` no caso de gate pendente (mesmo desfecho, instância
  no Map nos dois).
- **H4** — `synthesizer` no `TYPES` do controller. Trivial e **cortável**: só importa se alguém for
  invocar synthesizer por fora. Nota: ele tem `allowedSkills: []`, então rodaria sem ferramenta —
  "0 ações" é o correto para ele, não falha.

## 7. Frontend — se e quando

Estender o que existe, dentro de `apps/web/app/`:

- Rota nova (`app/hud/page.tsx`), reusando `useRayzenEvents` (autenticado após S1) e
  `useMissions`/`usePendingGates`.
- Anel de progresso derivado de contagem de steps por status — não existe campo de progresso.
- Badge de sucesso do specialist **não** confia em `status: 'done'`: checa ausência de
  `stopReason` + presença de `actionsExecuted`.
- Enquanto H2 não existir, progresso de specialist é polling em `GET /v2/specialists/active`
  (nunca `/:id` por instância), e **só** quando há specialist running conhecido por evento de
  missão.
- `prefers-reduced-motion` respeitado.

**Design:** fundo quase-preto, accent teal, **âmbar reservado exclusivamente a approval gates**.
JetBrains Mono. A mecânica de "módulo orbital vira painel" com FLIP layout animation
(`framer-motion`, que precisaria ser adicionado ao `apps/web`) é a parte mais cara e a primeira a
cortar se o objetivo for utilidade no celular.

> A regra `deployment_requires_review` continua valendo: a HUD **mostra** o gate, nunca o contorna
> nem o simplifica visualmente.

## 8. Em aberto

- Biblioteca de estado no frontend — **em aberto**, e não é específico da HUD (já consta como
  pendência no ADR-008).
- Layout do painel expandido: centralizado ou ao lado da órbita — **em aberto**.
- Se a HUD justifica `framer-motion` como dependência nova — **em aberto**.

> Redação proposital: estas linhas evitam a palavra "decidido", mesmo negada. O parser de import
> do Rayzen detecta decisão por regex (`/\bdecidi(do|mos|u)\b/i`) e **não enxerga negação** — então
> "não decidido" viraria um evento `type: 'decision'` afirmando o oposto do texto. Ver o item de
> backlog sobre o defeito.

## 9. Checklist de validação

- [ ] Cliente sem token não conecta (S1).
- [ ] Cliente sem `subscribe` não recebe evento nenhum (S1).
- [ ] Excesso de conexões é recusado (S2).
- [ ] Gate expirado reflete a **missão pausada**, não só o gate (H1).
- [ ] Step não emite evento duplicado depois de H1.
- [ ] Specialist rodando skills não aparece congelado (H2).
- [ ] Specialist com orçamento estourado **não** aparece com badge de sucesso.
- [ ] Após restart da api-v2, a HUD não afirma que há specialist rodando.
- [ ] Em 390px de largura o painel continua legível.

---

## Procedência deste documento

Conceito discutido com o usuário; auditoria de backend feita lendo o código em 17/08.

> **Uma versão anterior foi gerada por `rayzen_blueprint_create_feature_plan` e continha invenção
> factual**: URL `wss://api.rayzen.io/events` (o correto é `api.rayzen.com.br/ws`), tipos de evento
> inexistentes (`SPECIALIST_STATE`, `GATE_STATUS`), decisões nunca tomadas registradas como
> *"Decidimos usar Redux Toolkit/JWT/Aceternity porque…"*, e números de rate limit e teste de carga
> nunca discutidos. **Nada daquele output foi aproveitado aqui.** Ver o item de backlog sobre o
> defeito da ferramenta.
