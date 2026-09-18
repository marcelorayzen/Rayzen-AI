# R2 — o pedido alcança o executor, e continua consultável

Data: 13/09/2026 · base: `da9ec25` (R1 já em `main`) · **preparado localmente**.

Fecha **A03** da [auditoria de 13/09](../../audits/2026-09-13-jarvis/AUDITORIA.md). Depende de R1,
que foi entregue primeiro por decisão explícita: ligar o despacho antes ativaria um caminho onde o
silêncio aprovava e a limpeza destruía trabalho não commitado.

---

## 1. O defeito, e por que era menor do que parecia

`AgentSessionService.create` criava a `AgentSession` e gravava uma linha em `task_logs` com
`module: 'agent'`, `action: 'jarvis:supervised_session'`. **Nunca enfileirava.** O executor
despacha por `${module}:${action}` — `jarvis:supervised_session` — enquanto aquela linha produzia
`agent:jarvis:supervised_session`.

Medido em B0, e foi o que reduziu o tamanho do conserto:

| peça | estado antes |
|---|---|
| `ACTION_ROLE['supervised_session'] = 'desktop'` | ✅ já existia |
| `case 'jarvis:supervised_session'` no executor | ✅ já existia |
| whitelist e `role-policy` do agent | ✅ já existiam |
| **enqueue** | ❌ única peça ausente |

E `task_logs` tinha **um escritor e nenhum leitor** no monorepo inteiro. Não era uma fila
concorrente a conciliar — era um beco sem saída. A correção **remove** código.

## 2. As três mudanças

### 2.1 `enqueue()` separado de `dispatch()`

`apps/api/src/modules/execution/execution.service.ts`

`dispatch()` terminava em `return this.waitForResult(id)`, com `POLL_TIMEOUT_MS = 30_000`. Uma
sessão supervisionada dura minutos a horas — chamá-lo aqui trocaria *"nunca chega ao executor"*
por *"estoura o timeout com a sessão rodando órfã do outro lado"*, que é um defeito diferente,
não um conserto.

`enqueue(action, payload): Promise<string>` devolve o `jobId` sem esperar; `dispatch()` virou
`enqueue()` + `waitForResult()`. **Nenhum consumidor atual muda de comportamento** — é a
"separação entre aceitação rápida e trabalho demorado" que o plano pede, e coube numa extração
de método.

### 2.2 A sessão enfileira, e `task_logs` sai

`apps/api/src/modules/agent-session/agent-session.service.ts` · `agent-session.module.ts`

```
prisma.taskLog.create({ module: 'agent', action: 'jarvis:supervised_session', … })
  →  execution.enqueue('supervised_session', { sessionId, prompt, projectId })
```

**"Recebido" não pode significar "iniciado".** Se o enfileiramento falha — desktop offline,
tipicamente — a sessão é marcada `error` e o erro propaga, em vez de ficar `active` esperando
alguém que nunca virá. Esse era exatamente o estado em produção: **4 sessões `active` paradas
desde junho**, com 5 `task_logs` `pending` do mesmo período.

O anúncio no Telegram e o `setReplyHandler` passaram para **depois** do enqueue: anunciar antes
seria prometer trabalho que ninguém pegou, e deixar o handler de resposta apontando para uma
sessão morta.

### 2.3 O diretório vem do `projectId`, e não resolver é recusa

`apps/agent/src/actions/base-da-sessao.ts` (novo) · `supervised-session.ts` · `executor.ts`

O payload enfileirado carrega `projectId`, não caminho. Antes era
`base = projectPath ?? process.cwd()`: sem caminho, a sessão rodaria contra o diretório de onde o
agent foi iniciado — **sem erro e sem aviso**, com o relatório final falando de um repositório que
ninguém pediu.

Aplicada a regra da Fase 3 do plano de execução tipada: `projectId` que não resolve **recusa a
chamada inteira**. Não cai em `process.cwd()` nem num `projectPath` residual que tenha vindo
junto. `resolverWorkdir()` (reuso, não código novo) nunca lança e devolve `null` para projeto sem
`repoSlug`, sem checkout local ou com a API fora do ar — quem chama decide, e a decisão é recusar.

> Isso importa mais aqui do que num `run_command`: **a sessão escreve código**. Rodar no
> repositório errado não é um comando perdido, é um commit no lugar errado.

## 3. Specs

| arquivo | casos | vermelho antes |
|---|---|---|
| `apps/api/.../agent-session/__tests__/agent-session-enfileira.spec.ts` | 8 | **7 falharam** — `queue.add` com 0 chamadas, `taskLog.create` com 1, e o silêncio nas três falhas de enqueue |
| `apps/agent/src/actions/__tests__/base-da-sessao.spec.ts` | 6 | função não existia |

O spec da API usa o **`ExecutionService` real** com a fila mockada, não um duplo do serviço: o que
precisa ser provado é que o produtor real produz a chave que o consumidor real espera. Com os dois
lados mockados, a asserção passaria mesmo com o par errado — que é como o defeito sobreviveu desde
junho.

A chave esperada é constante no topo do arquivo (`jarvis:supervised_session`, o que `executor.ts`
usa no `switch`), para o teste falhar se alguém mudar o par de qualquer um dos lados.

## 4. Estado

| item | estado |
|---|---|
| typecheck `api` e `agent` | ✅ exit 0 nos dois |
| specs novas | ✅ 14 verdes (8 + 6) |
| `execution.service.spec.ts` pré-existente | ✅ intacto, sem alterar asserção |
| suíte completa do agent | ver §5 |
| C04 | atendido no nível de comportamento testado |

## 5. Limites declarados

- **`TaskLog` continua no schema.** Só a escrita saiu. Dropar a tabela é migration, e migration
  entra em rodada própria — as 5 linhas `pending` desde junho são evidência histórica do defeito
  e não custam nada.
- **Não exercitado ponta a ponta.** Fila mockada nos testes; nenhuma sessão supervisionada real
  foi criada. C04 está atendido no comportamento, não na jornada — a jornada é I1.
- **O agent desktop precisa ser reconstruído para pegar isto.** Ele roda do `dist/` local, e o
  deploy do servidor não o alcança. `supervised_session` tem `targetRole: 'desktop'`, então **o
  caminho só funciona de verdade depois de `rayzen-start.bat`** (que desde 06/09 recompila sempre
  e recusa subir se o build falhar).
- **A05–A08 continuam abertos.** Concorrência, resposta correlacionada por tarefa, recuperação
  após queda. Fechar A03 não torna a delegação confiável — torna-a alcançável.
