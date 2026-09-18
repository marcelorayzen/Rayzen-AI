# R3.a — a resposta vai para a pendência certa, e o histórico é o recente

Data: 13/09/2026 · base: R2 · **preparado localmente**.

Fecha **A06** e **A07**. **A05 fica para R3.b**, declarado em §5 — exige contrato de posse com
heartbeat, e qualquer limiar de tempo chutado duplicaria o efeito de uma tarefa longa legítima.

---

## 1. A06 era pior do que "resposta na sessão errada"

`processUpdate` começava assim:

```ts
if (this.replyHandler) { this.replyHandler(text); return }
```

Um campo **único**, consultado **antes de qualquer roteamento**. Quatro consequências, e a
primeira não tem nada a ver com sessões:

| # | efeito |
|---|---|
| 1 | com o handler armado, **toda mensagem de todo chat autorizado** era desviada — conversa normal com o orquestrador incluída, em qualquer projeto ou tópico |
| 2 | `/projeto` e `/autorizar` usam o mesmo campo: escolher um projeto podia virar **a aprovação de uma etapa de código** |
| 3 | duas sessões: a segunda sobrescrevia a primeira, que ficava `waiting` para sempre |
| 4 | callback é memória: restart perdia a pendência |

> Isso era **latente** enquanto a sessão supervisionada não chegava ao executor (A03). Corrigir
> A03 na rodada anterior tornou este caminho vivo — e é por isso que A06 veio logo em seguida, e
> não depois de A05. O custo de errar é assimétrico: do outro lado há um `Bash(git commit:*)`
> liberado, e o que se perde é uma aprovação.

### A correção não inventa estado

A pendência **já era persistida**: `AgentSession.status` vira `waiting` e `pendingQuestion` guarda
a pergunta. Bastou perguntar ao banco em vez de a um callback em memória — o que resolve (3) e (4)
de graça e sobrevive a restart.

**Sem migration, e isso foi decidido por risco medido:** a V1 sobe com
`npx prisma migrate deploy && node main`, então **migration que falha impede o boot**, e o
`migrate diff` automático gera SQL destrutivo por causa de drift do banco (documentado na migration
de 06/09). Como a sessão já envia para o chat padrão, o destino não precisava virar coluna.

| peça | papel |
|---|---|
| `PendingReplyService` (novo) | resolve para qual sessão vai um texto, e grava a resposta. Depende só do Prisma |
| `PendingReplyModule` (novo) | módulo próprio **por causa de ciclo**: `AgentSessionService` precisa do Telegram para perguntar, e o Telegram precisa resolver a resposta. Os dois importam este; nenhum importa o outro |
| `TelegramService.replyHandlers` | `Map` por `chatId:threadId` — as seleções de `/projeto` e `/autorizar` deixam de ser globais |
| `AgentSessionService` | parou de registrar callback; `submitReply` (web) delega ao mesmo serviço, para as duas entradas não divergirem |

### Ordem nova em `processUpdate`

1. seleção pendente **deste** chat/tópico
2. **comando** (`/…`) — precedência sobre resposta de sessão
3. resposta de sessão supervisionada (consulta ao banco)
4. fluxo normal (orquestrador)

> **Com duas pendências, não escolhe.** Devolve `ambigua` e pede desambiguação por prefixo
> (`<id-curto>: resposta`), que funciona também quando há só uma. Escolher "a mais recente"
> mandaria a aprovação de uma etapa para o trabalho errado.
>
> O prefixo só conta se casar com uma sessão pendente de verdade — `"faça assim: use cache"` é
> resposta, não endereçamento.

**Trocas declaradas:** responder literalmente `/algo` a uma sessão deixa de ser possível (comando
ganha); e a correlação assume o chat padrão — se um dia a sessão for pedida de outro chat/tópico,
aí sim é preciso a coluna.

## 2. A07 — o histórico pegava o começo da conversa

`orderBy: { createdAt: 'asc' }, take: 20` em **dois pontos** (chat comum e streaming): as vinte
**primeiras** mensagens da sessão.

Numa conversa curta é indistinguível do correto — é por isso que passou. Acima de vinte, o prompt
congela no começo do papo e ignora tudo o que veio depois: **a instrução que substitui outra nunca
chega ao modelo**, e a correção mais recente é exatamente a que fica de fora.

Extraído para `janelaDeHistorico()` — eram duas cópias idênticas, e consertar uma deixaria a outra
errada em silêncio. Busca `desc`, reverte para ordem cronológica.

## 3. Specs

| arquivo | casos |
|---|---|
| `agent-session/__tests__/pending-reply.service.spec.ts` | 10 |
| `telegram/__tests__/roteamento-de-resposta.spec.ts` | 9 |
| `orchestrator/__tests__/janela-de-historico.spec.ts` | 3 |

O spec do Telegram exercita `processUpdate` de verdade (padrão `Object.create(prototype)` já usado
nos specs do módulo) e cobre os quatro sintomas: conversa normal não sequestrada, comando não
engolido, seleção de um chat não interceptando outro chat **nem outro tópico**, e a mensagem não
sumindo quando a sessão sai de `waiting` entre a consulta e a escrita.

## 4. Estado

| item | estado |
|---|---|
| typecheck `api` | ✅ exit 0 |
| suíte `api` | ✅ 49 suites / 539 testes |
| specs pré-existentes do Telegram e do Orchestrator | ✅ intactos |
| migration | ❌ **nenhuma** — decisão de risco (§1) |
| C05 (parte de correlação) | atendido no comportamento testado |

---

# R3.b — posse da execução e recuperação de órfã (A05) ✅

Entregue na sequência, mesma data. O diagnóstico de §5 continua válido: é ele que explica por que
a correção tem a forma que tem.

## 6. O lock era um teto; virou sinal de vida

```
const CLAIM_LOCK_TTL_MS = 30_000  // 30s — cobre o tempo máximo de processamento
```

O comentário **nunca foi verdade**. Uma sessão supervisionada dura horas; um `screenshot` dura
segundos. Não existe número que sirva de teto para as duas pontas do catálogo — e era por tentar
ser um teto que ele não servia para nada.

| antes | depois |
|---|---|
| lock com TTL fixo, nunca renovado | **lease** com TTL de 60s, **renovado a cada 20s** por quem executa (folga de 3×, para uma renovação perdida por rede não matar a tarefa) |
| valor `'1'` — lock anônimo | valor = `hostname` do dono. `renovarPosse` compara antes de renovar: **posse não se rouba renovando** |
| `claimTask` só olhava `pending` | poda órfãs a cada pedido de trabalho |

`SET ... XX` na renovação é o outro lado da mesma regra: posse que já expirou **não volta** por
renovação — quem a perdeu passa pelo claim de novo, onde a poda acontece.

## 7. Órfã não é re-executada, e isso é a decisão central

Tarefa `processing` sem lease = o executor sumiu. A tentação é devolvê-la à fila. **Repetir
cegamente é o único desfecho pior que ficar preso:** o efeito pode ter ocorrido antes da morte, e
boa parte das 43 ações não é idempotente — um `git push`, um e-mail enviado, um arquivo apagado.

Então ela vira `failed` com o motivo dizendo exatamente o que se sabe e o que não se sabe:

> *"Posse perdida: o executor parou de renovar a posse e a tarefa não foi concluída. Não se sabe
> se o efeito chegou a ocorrer — verifique antes de repetir."*

É o `estado incerto explícito` que C07 pede. A decisão de repetir fica com quem pode verificar.

**A poda é oportunista, sem ciclo novo:** acontece dentro de `claimTask`, que o poller chama a
cada 3s. Um ciclo agendado exigiria declaração no catálogo de batimentos e seria mais máquina do
que o problema pede. E roda **sem filtro de role** de propósito — órfã não pertence mais a
executor nenhum, e exigir que o mesmo role volte para podá-la deixaria presa justamente a tarefa
do agent que não voltou.

## 8. Specs de R3.b

| arquivo | casos |
|---|---|
| `agent-bridge/__tests__/posse-e-recuperacao.spec.ts` | 9 — com Redis falso de **expiração controlada**, porque morte de agent não se simula esperando |
| `agent/src/__tests__/poller-posse.spec.ts` | 4 — fake timers |

Cobrem os dois lados e os dois modos de errar: execução viva **não** é podada; órfã **não** é
re-executada; não-dono **não** renova; e o intervalo de renovação é limpo no `finally` — um
timer sobrevivente renovaria a posse de uma tarefa encerrada, e a próxima tarefa presa nesse mesmo
agent nunca seria reconhecida como órfã.

## 9. Estado de R3.b

| item | estado |
|---|---|
| typecheck `api` e `agent` | ✅ exit 0 |
| suíte `api` | ✅ 50 suites / 548 testes |
| suíte `agent` | ✅ 50 suites / 639 testes |
| `docs/exec-paths.md` | ✅ em dia, sem mudança |
| migration | ❌ nenhuma |

> **Efeito esperado no primeiro deploy:** os **3 jobs presos desde 17/06/2026** serão podados para
> `failed` na primeira vez que um agent pedir trabalho, com o motivo acima. É o comportamento
> desejado — eles estão parados há três meses —, mas é uma mudança de estado em produção que
> acontece sozinha, então fica registrada aqui em vez de surpreender alguém no painel.

**Continua aberto:** A08 (contrato uniforme de autorização entre entradas) e limite de
concorrência por recurso — dois jobs distintos ainda podem disputar o mesmo workspace ou o mesmo
navegador. A posse é por tarefa, não por recurso.

---

## 5. A05 ficou para R3.b — o diagnóstico que levou ao desenho acima

`claimTask` busca `['waiting','delayed']` e filtra `status === 'pending'`. Um job que virou
`processing` e cujo agent morreu **nunca mais é reclamado** — daí os 3 jobs presos desde
17/06/2026.

Consertar parece simples (aceitar `processing` antigo), e não é: **sem heartbeat da execução, não
há como distinguir "agent morreu" de "tarefa longa em andamento"**. Uma sessão supervisionada dura
horas; qualquer limiar de tempo chutado reclamaria uma execução viva e produziria **efeito
duplicado** — pior do que o defeito atual, que ao menos falha parado.

O que R3.b precisa: posse temporária com renovação periódica, limite de concorrência por recurso, e
reconciliação no boot que distinga "não começou" de "começou e não sabemos se terminou". É a
recomendação da própria auditoria, e não cabe como remendo.

**Também continuam abertos:** A08 (contrato uniforme de autorização entre entradas) e a parte de
recuperação de C06/C07.
