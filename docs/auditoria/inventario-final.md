# Auditoria — inventário final

> Medido em **2026-08-19** contra o banco e os containers de produção (H81, `servidor-local`).
> Ordenado por severidade × esforço. Método e pendências em `estado.md`; mapa em `inventario.md`.

**Nada foi corrigido.** Nenhum arquivo de código foi tocado nesta sessão.

---

### [alta] Histórico de conversas — a lista é 100% telemetria interna

- **Camada:** api-v1 (dado) + frontend
- **Tipo:** modal (`SidebarOverlay.tsx`, aberto pelo ícone de menu do `Header.tsx:100`)
- **Status:** **quebrado**
- **Classe:** bug
- **Esforço:** pequeno

**Evidência.** `GET /sessions` ao vivo devolve 20 itens, **todos com `"title":"Conversa"` e
`"messages":1`**:

```
$ curl http://127.0.0.1:3101/sessions -H 'Authorization: Bearer …'
[{"sessionId":"doc-cdac7b63","messages":1,"title":"Conversa"},
 {"sessionId":"ps-a5ceda18","messages":1,"title":"Conversa"},
 {"sessionId":"checkpoint-1787144345443","messages":1,"title":"Conversa"}, …]
```

No banco, a divisão entre conversa e telemetria:

```sql
with s as (select session_id, count(*) filter (where role='user') u, max(created_at) m
           from conversation_messages group by session_id)
select case when u>0 then 'conversa real' else 'telemetria' end, count(*), max(m) from s group by 1;

 conversa real |   210 | 2026-08-12 17:23:20
 telemetria    | 4.459 | 2026-08-19 12:52:08
```

E a posição da primeira conversa real na ordenação que o endpoint usa:

```sql
-- row_number() over (order by max(created_at) desc)
 pos | session_id                           | user_msgs
 661 | ef9fe6e4-3417-4413-9eee-dd5edfbc5a40 |         1
```

**Causa raiz — identificada, e são dois defeitos empilhados.**

**1. `conversation_messages` é tabela de duas coisas.** Ela guarda conversa do usuário *e* a saída
de todo módulo interno que fala com LLM. Distribuição real:

| module | role | linhas |
|---|---|---:|
| `documentation` | assistant | 1.777 |
| `synthesis` | assistant | 1.286 |
| `project-state` | assistant | 1.064 |
| `graph` | assistant | 386 |
| `brain` | user + assistant | 175 + 175 |

**4.513 de 4.982 linhas (90,6%) são telemetria sem contraparte `user`.** `getRecentSessions()`
(`session.service.ts:44`) faz `groupBy(session_id)` sobre a tabela inteira, sem filtro nenhum.

**2. O limite é 20, fixo, e não é alcançável pelo cliente.** `session.controller.ts:16` chama
`this.svc.getRecentSessions()` **sem argumento** → default `limit = 20` (`session.service.ts:44`).
Como a primeira conversa real está na posição **661**, é aritmeticamente impossível uma conversa
aparecer no histórico. Não é "às vezes some" — é sempre.

**Sobre "não abre nada".** O clique **não** é um no-op: `loadSession` busca as mensagens e
`setMessages` renderiza. O que aparece é o payload cru da chamada interna — verificado:

```
GET /sessions/graph-2e0299a5/messages
→ [{"role":"assistant","content":"```json\n{\n  \"gaps\": [{\"area\": \"blocker\", …"}]
```

Ou seja: 20 linhas idênticas chamadas "Conversa" que abrem um blob de JSON. A percepção de "não
abre" é consistente com isso; não precisei de clique para decidir o achado, porque ele se decide
no dado.

**Agravante que vale registrar.** `useChatStream.ts:270` e `:277` engolem erro com
`catch { /* silencioso */ }`, e `setSidebarOpen(false)` está **dentro** do `try` — então qualquer
falha na busca deixa a sidebar aberta e sem reação visível, indistinguível de clique ignorado.
É o multiplicador de silêncio já registrado na auditoria de 05/08.

**Recomendação.** Filtrar na origem, não no limite. Em `getRecentSessions()`, restringir a sessões
que tenham ao menos uma mensagem `role='user'` — é o que separa conversa de telemetria sem depender
de lista de módulos (que envelhece). Prefixo de `session_id` (`doc-`, `ps-`, `graph-`,
`checkpoint-`) é sinal secundário, não use como critério primário: `brain` tem `role='user'` e é
conversa de verdade. Trocar os dois `catch` silenciosos por estado de erro visível. Só depois
discutir se telemetria deveria morar em outra tabela — é a correção certa e a mais cara.

---

### [alta] Goal Graph — 64,7s no caminho frio, sem cache da aplicação

- **Camada:** api-v1
- **Tipo:** modal (`GoalGraphPanel.tsx`, botão `grafo`) → `GET /projects/:id/graph/goal`
- **Status:** **parcial** — responde certo, em tempo inutilizável
- **Classe:** bug
- **Esforço:** médio

**Evidência.** Três chamadas consecutivas ao mesmo endpoint, de dentro do servidor:

```
call1 HTTP=200 time=64.677335
call2 HTTP=200 time=0.034100
call3 HTTP=200 time=0.010431
```

Reproduzido duas vezes: a primeira sonda desta auditoria (timeout de 20s) devolveu `HTTP=000`, o
que li como endpoint quebrado antes de medir — **era latência**.

**Causa raiz — identificada.** `getGoalGraph()` (`graph.service.ts:165`) chama `analyzeGap()`
(`:634`) **em toda requisição**, e `analyzeGap` monta um prompt e faz chamada de LLM. Não há cache
na aplicação: `grep -i cache apps/api/src/modules/graph/graph.service.ts` não retorna nenhuma
estrutura de cache.

Os 10ms da segunda chamada vêm de **fora da aplicação** — `infra/litellm/config.yaml:74-79`:

```yaml
cache: true
cache_params:
  ttl: 300            # 5 min — respostas idênticas reutilizadas
```

Isso tem duas consequências que a leitura ingênua ("tem cache, então tá rápido") esconde:

1. **A cada 5 minutos alguém paga 64,7s.** Não é custo de primeira carga do dia; é recorrente.
2. **A chave do cache é o prompt, e o prompt embute o ProjectState** (objective, stage, milestones,
   blockers, riscos, nextSteps — `graph.service.ts:661-667`). O ciclo de síntese reescreve esse
   estado com frequência, então o cache erra sempre que o estado muda — que é exatamente quando
   alguém está trabalhando e vai abrir o grafo.

**Recomendação.** Persistir e servir o `lastGapAnalysis` que o próprio código **já grava** em
`projectGoal` (`graph.service.ts:197-200`, hoje gravado e nunca lido na leitura). Servir o valor
gravado imediatamente e recalcular em background. Não depender do cache do LiteLLM para latência de
UI — ele existe para economizar token, e o TTL de 300s foi calibrado para isso, não para tela.

---

### [alta] 843 testes verdes não tocam uma linha de frontend

- **Camada:** todas
- **Tipo:** cobertura
- **Status:** **funcionando conforme construído** — o problema é o que ele não cobre
- **Classe:** decisão de produto pendente
- **Esforço:** grande

**Evidência.** `pnpm test`, rodado hoje, completo:

```
apps/agent  test: Test Suites: 12 passed, 12 total | Tests:  90 passed
apps/api-v2 test: Test Suites: 30 passed, 30 total | Tests: 357 passed
apps/api    test: Test Suites: 32 passed, 32 total | Tests: 396 passed
```

843 testes, 74 suítes, 100% verde. E:

- `find apps/web -name "*.spec.*" -o -name "*.test.*"` → **vazio**
- `apps/web/package.json` scripts: `dev · build · lint · typecheck` — **não existe `test`**
- `grep -rn "playwright\|cypress\|@testing-library" package.json apps/*/package.json` → **vazio**

**O número.** Das ~19 unidades funcionais de frontend inventariadas (11 rotas + ~19 modais/painéis),
**zero** têm verificação automatizada. A cobertura de funcionalidade *alcançável pelo usuário* é
**0%**. Os 843 testes cobrem serviços de backend.

**Causa raiz — identificada, e não é "faltam testes".** É que **todo teste mocka a camada de dado**.
`session.service.spec.ts` existe, passa, e alimenta o service com um `mockPrisma` cujo fixture tem
sessões com mensagens de usuário:

```ts
const mockPrisma = { conversationMessage: { aggregate: jest.fn(), groupBy: jest.fn(), … } }
```

O defeito F-001 **não é um bug de código** — `getRecentSessions()` faz exatamente o que o spec diz.
O defeito está na forma do dado real, que nenhum fixture representa. **Nenhuma quantidade de teste
de unidade com prisma mockado poderia pegá-lo.** É a explicação objetiva de por que 100% de pass
rate convive com funcionalidade quebrada, e ela é mais específica que "falta E2E".

**Recomendação — nesta ordem, e a primeira não é Playwright.**

1. **Invariante de dado, não teste.** F-001 é exatamente o critério de entrada do catálogo de
   invariantes do `CLAUDE.md`: *já quebrou em silêncio e custou tempo para achar*. Um check do tipo
   "a lista de sessões contém ao menos uma sessão com mensagem de usuário" pega essa família inteira
   e roda contra produção, onde o defeito mora. Barato, e usa máquina que já existe.
2. **Só então E2E.** Vale para os fluxos que se decidem na renderização, não no dado — e implica
   **instalar Playwright**, hoje ausente. Antes de pagar essa dependência, note que 3 dos 4 achados
   desta auditoria foram encontrados com `curl` e `psql`, não com clique.

---

### [média] Evidências — nunca teve caminho de upload, e a única evidência aponta para arquivo inexistente

- **Camada:** frontend + api-v1 + agent
- **Tipo:** modal (`EvidenceModal.tsx`, botão `evidências`)
- **Status:** **não implementado** (o fluxo pretendido) + **quebrado** (o registro que existe)
- **Classe:** feature incompleta
- **Esforço:** médio

**Evidência.** No banco, o acervo inteiro:

```sql
select count(*) from events where metadata->>'kind'='evidence';
→ 1        -- de 2026-05-18, projeto Rayzen-PDV, zero com testRunId
```

O arquivo por trás dela não existe:

```
GET /evidence/file/369ee02f-…/9b4134a8-….png   →  HTTP=404
$ ls /home/rayzen/projects/rayzen-ai/storage/evidence/   →  vazio
```

E não há caminho de upload na interface:

```
$ grep -rn "evidence/upload" apps/web/app   →  (nada)
```

**Causa raiz — identificada, e são duas coisas separadas.**

**1. O fluxo pretendido nunca foi construído.** O backend está completo — `POST /evidence/upload/:id`,
`GET /evidence/projects/:id`, `DELETE /:id`, `GET /evidence/file/…` (`evidence.controller.ts`). O
`EvidenceModal` sabe listar, filtrar e deletar. **Ninguém sabe enviar.** O único produtor no sistema
inteiro é `maybeUploadEvidence()` (`apps/agent/src/poller.ts:100`), que só dispara em
`task.module === 'jarvis' && task.action === 'screenshot'`. A expectativa de "print de teste manual"
não tem implementação em lugar nenhum — **não é bug, é feature incompleta**, e isso muda o backlog.

**2. O arquivo se perdeu.** A resolução do diretório está correta — `EVIDENCE_DIR` não está definida,
o fallback é `path.join(process.cwd(),'storage','evidence')`, o `WorkingDir` do container é `/app`, e
`/app/storage/evidence` **é** o bind mount de `~/projects/rayzen-ai/storage/evidence`. (Cheguei a
suspeitar de descasamento de caminho; medi e não é.) O diretório montado simplesmente está vazio,
com data de `Jun 10`, enquanto a evidência é de `18/05`. O arquivo sumiu entre as duas datas — não
determinei quando; candidato natural é a migração de servidor de 09/08, mas isso é **suspeita, não
achado**.

**Consequência hoje:** abrir `evidências` no Rayzen AI mostra "Nenhuma evidencia registrada ainda"
(correto — `GET /evidence/projects/<rayzen-ai>` devolve `[]`). Abrir no Rayzen-PDV renderiza um
`<img>` quebrado, porque a lista traz o registro e o arquivo dá 404.

**Recomendação.** Decidir primeiro **se a feature é desejada**, porque o esforço é de construção, não
de conserto: um `<input type="file">` no `EvidenceModal` chamando o `POST /evidence/upload/:projectId`
que já existe fecha o ciclo. Independente dessa decisão, tratar o `<img>` que 404 — a lista não deve
oferecer imagem cujo arquivo sumiu. E `EVIDENCE_DIR` não está no `.env.example`; explicitá-la remove
a dependência de `process.cwd()` coincidir com o mount.

---

## Resumo

| id | achado | classe | severidade | esforço |
|---|---|---|---|---|
| F-001 | histórico é 100% telemetria; conversa real na posição 661 de um `limit 20` | bug | alta | pequeno |
| F-003 | Goal Graph 64,7s a frio, LLM síncrono sem cache de aplicação | bug | alta | médio |
| F-004 | 0% das funcionalidades de frontend têm verificação; todo teste mocka o dado | decisão pendente | alta | grande |
| F-002 | evidências sem upload; único registro com arquivo 404 | feature incompleta | média | médio |

**Três dos quatro achados falham no mesmo estágio do eixo de 05/08: existe · **recebe dado** ·
é alcançável.** F-001 recebe dado errado, F-002 não recebe dado, F-004 é a razão de ninguém ter
percebido. O padrão registrado há duas semanas continua valendo, e nenhum dos quatro é "código com
bug" no sentido clássico — F-003 é o mais próximo disso, e ainda assim o código faz o que diz.
