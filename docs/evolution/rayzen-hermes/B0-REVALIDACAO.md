# B0 — revalidação do retrato auditado

Data: 13/09/2026 · HEAD medido: `ae7dc0bfe526a039a930f9d40b276fd61ab02d4b` · branch `main`, working tree limpo.
Natureza: leitura e medição local. Nenhum código de produto alterado, nenhum processo iniciado,
nenhuma chamada de escrita a produção.

Complementa — não substitui — [a auditoria de 13/09](../../audits/2026-09-13-jarvis/AUDITORIA.md)
e [VALIDACOES.md](../../audits/2026-09-13-jarvis/VALIDACOES.md).

---

## 1. Delta desde a revisão auditada

`git diff --stat 8293ab7..HEAD` — **sete arquivos, todos documentação**:

| arquivo | natureza |
|---|---|
| `CLAUDE.md` (+89) | sincronização documental |
| `docs/audits/2026-09-13-jarvis/*` (4 arquivos, +836) | a própria auditoria |
| `docs/agent-actions.md`, `docs/security/data-inventory.md` (±1 linha cada) | regenerados |

**Zero arquivos de código.** Os achados A01–A17 valem literalmente contra o HEAD atual: não há
"revalidar se ainda se aplica", só conferir que a leitura estava certa — e estava, com uma
correção para pior em A02 (§3).

O pacote de continuidade (`README`, `DIRECAO-E-DECISOES`, `PLANO-DE-TRABALHO`,
`CRITERIOS-DE-ACEITE`, `CONTINUIDADE`, `PROMPTS-VSCODE`) **não estava no repositório** quando esta
revalidação começou; existia apenas fora dele. Referências a esses caminhos não devem ser tratadas
como leitura confirmada até que sejam copiados.

## 2. Reconferência dos P0 no código de hoje

| Achado | Local no HEAD atual | Estado |
|---|---|---|
| A01 | [`workspace-isolado.ts:75`](../../../apps/agent/src/exec/workspace-isolado.ts#L75) — `git worktree remove --force` | Confirmado |
| A02 | [`supervised-session.ts:511`](../../../apps/agent/src/actions/supervised-session.ts#L511) — `if (!reply \|\| /…/.test(reply))` | Confirmado, e **pior** (§3) |
| A03 | [`agent-session.service.ts:19-30`](../../../apps/api/src/modules/agent-session/agent-session.service.ts#L19) — `taskLog.create`, sem enqueue | Confirmado, e **menor do que parece** (§4) |
| A04 | [`poller.ts:65`](../../../apps/agent/src/poller.ts#L65) `status:'done'` incondicional · [`supervised-session.ts:560`](../../../apps/agent/src/actions/supervised-session.ts#L560) ruído >50 chars vira `complete` | Confirmado |

> **A01 tem uma ironia documental que vale registrar.** O comentário imediatamente acima da
> linha defeituosa explica corretamente por que a limpeza é segura: *"`git worktree remove` só
> libera o CHECKOUT em disco — os commits continuam alcançáveis pelo branch"*. Isso é verdade —
> e `--force` é exatamente o que desfaz a premissa, porque sem ele o git **recusa** remover um
> worktree sujo. A trava que tornaria o comentário verdadeiro foi desligada na mesma linha que
> ele descreve. Mesma família do `isNoise` e do `Invariante 1`: enunciado correto, sensor
> desligado.

## 3. A02 é pior do que a auditoria registrou — achado novo

A auditoria registra dois vetores: silêncio aprova, e `"não pode"` aprova (`\bpode\b` casa dentro
da negação). Ambos confirmados. Falta o terceiro, que inverte o diagnóstico:

As alternativas da regex usam **prefixos com `\b` no fim** — `aprovad`, `continu`, `rejeit`,
`corrig`. `\b` nunca fecha entre `d` e `o`, porque os dois são word chars. Medido:

| resposta | ramo aprovação | ramo rejeição | destino real |
|---|---|---|---|
| `Aprovado, continue` | ❌ | ❌ | *instrução modificada* |
| `Rejeitar e corrigir` | ❌ | ❌ | *instrução modificada* |
| `não pode` | ✅ | ❌ | **APROVOU** |
| `ok` / `sim` / `pode` | ✅ | ❌ | APROVOU |
| *(silêncio)* | ✅ | — | **APROVOU** |

As duas primeiras linhas são **as opções que o próprio sistema oferece** ao usuário no Telegram
([`agent-session.service.ts:61`](../../../apps/api/src/modules/agent-session/agent-session.service.ts#L61)).

Conclusão corrigida: não é "o silêncio pode aprovar". É que **o ramo de rejeição é inalcançável
pelas opções apresentadas**, e as únicas respostas que aprovam de fato são o silêncio e três
palavras soltas — uma delas dentro de uma negação. O card de aprovação oferece três botões de
texto e ignora os três.

Reprodução: `node -e` com as duas regexes literais do arquivo contra as três opções literais do
service. Sem dependências, sem rede.

## 4. A03 é menor do que parece — quase tudo já existe

O caminho normal já sabe receber esta ação. Medido no HEAD:

| peça | estado |
|---|---|
| `ACTION_ROLE['supervised_session'] = 'desktop'` | ✅ [`execution.service.ts:54`](../../../apps/api/src/modules/execution/execution.service.ts#L54) |
| `case 'jarvis:supervised_session'` no executor | ✅ [`executor.ts:117`](../../../apps/agent/src/executor.ts#L117) |
| entrada na whitelist | ✅ `security/whitelist.ts:70` |
| escopo de role | ✅ `role-policy.ts:32` |
| enqueue de verdade | ❌ **única peça ausente** |

`ExecutionService.dispatch()` produz `module:'jarvis'` + `action:'supervised_session'` → chave
`jarvis:supervised_session`, que é exatamente o que o executor espera. `AgentSessionService.create`
grava `module:'agent'` + `action:'jarvis:supervised_session'` → `agent:jarvis:supervised_session`.

**Dois achados novos que mudam o tamanho da correção:**

**(a) `TaskLog` tem um escritor e nenhum leitor.** Busca por `taskLog` em `apps/` devolve
exatamente duas ocorrências: a escrita em `agent-session.service.ts:19` e a declaração do model em
`schema.prisma:236`. Nenhum consumidor, nenhuma query, nenhuma rota. As cinco linhas `pending`
desde junho (R2 da auditoria) nunca seriam consumidas por ninguém — não é uma fila divergente, é
um beco sem saída. A correção **remove** código em vez de conciliar dois caminhos.

**(b) `dispatch()` sempre espera o resultado.** Ele termina em `return this.waitForResult(id)`, com
`POLL_TIMEOUT_MS = 30_000`. Sessão supervisionada dura minutos a horas. Portanto A03 **não** se
corrige chamando `dispatch()` — isso trocaria "nunca chega" por "chega e estoura timeout em 30s",
com a sessão rodando órfã do outro lado. A menor adaptação é extrair as linhas 82–96 num
`enqueue()` que devolve o `id` sem esperar, e redefinir `dispatch() = enqueue() + waitForResult()`.
Nenhum consumidor atual muda de comportamento.

Isto é a "separação entre aceitação rápida e trabalho demorado" que o PLANO-DE-TRABALHO pede em R2,
já localizada em duas linhas de um arquivo.

## 5. Decisões que o pacote deixou "a decidir por evidência"

`DIRECAO-E-DECISOES.md §5` lista seis. Quatro têm resposta medida:

| pergunta aberta | resposta com evidência |
|---|---|
| Qual entidade representa o trabalho canônico? | **`AgentSession` para trabalho conversacional longo; `Task` (Bull) para ação pontual.** `AgentSession` (`schema.prisma:353`) já tem id, projectId, status `active\|waiting\|completed\|error`, prompt, pergunta/resposta pendente, summary, liveLog e FK para Project — é o contrato "Trabalho" do plano, já persistido e já consultável por `GET /agent/session/:id`. Não há terceira entidade a criar. `TaskLog` sai de cena (§4a) |
| Qual caminho de entrada conecta Hermes a uma tarefa rastreável? | A decidir **depois de H0** — mas o MCP do Hermes hoje é `include` de 9 ferramentas **só de leitura** (`infra/hermes/config.yaml:64-74`), nenhuma cria tarefa. Conectar exige uma ferramenta nova + escopo novo no token, o que é mudança de fronteira de segurança, não configuração |
| Como validar identidade/escopo em toda entrada? | O mecanismo correto **já existe e não deve ser reconstruído**: aprovação V1 vinculada a argumento/ator/recurso com consumo único (`execution/approval.service.ts`), mais `MCP_TOKEN_<NOME>` por consumidor. O que falta é o caminho supervisionado *usá-lo* em vez da regex de §3 |
| Quais integrações n8n/WhatsApp/agenda existem? | **Nenhuma.** Ver §6 |

As duas restantes (armazenamento efetivo do perfil Hermes; o que Hermes gerencia na própria sessão)
dependem de H0 e continuam abertas de propósito.

## 6. X0 — inventário de integrações: o resultado é vazio

Busca por `n8n|whatsapp|evolution-api|baileys|twilio|googleapis|google.calendar|crm` no monorepo.
Todos os hits classificados:

| onde | o que é | é integração? |
|---|---|---|
| `apps/web/app/deck/page.tsx` | copy de marketing do Rayzen Commerce ("Catálogo, CRM, estoque…") | ❌ outro produto |
| `apps/web/app/discovery/page.tsx` | texto de prompt sobre multi-tenant | ❌ |
| `schema.prisma:443`, migration e spec do Telegram | comentário *"o grupo do WhatsApp entra depois pelo mesmo contrato"* | ❌ intenção declarada |
| `core/services/automation.service.md`, `core/tools/tool-registry.md` | documentos de design do template JARVIS | ❌ sem runtime |
| `RESEARCH/*.md` | pesquisa comparativa | ❌ |

**Nenhuma linha de código de conector.** As 29 ações do agent (`apps/agent/src/actions/`) não
incluem nada de n8n, WhatsApp ou CRM. A única integração de agenda real é
`outlook-calendar.ts` — helper PowerShell contra o Outlook **local**, dependente da sessão Windows
do dono; não é agenda de servidor nem Google Calendar.

O único ativo reaproveitável é o contrato `TelegramSession` (`chatId` + `threadId` → `projectId`,
com `@@unique` e `threadId` não-nullable por decisão registrada): o schema foi desenhado para
receber WhatsApp sem integração separada.

**Consequência para o planejamento:** X1 não é "integrar o que existe", é **construção do zero**,
com dependência de infraestrutura externa (instância n8n, provedor WhatsApp Business, agenda de
servidor) que hoje não existe em lugar nenhum do inventário. O `PLANO-DE-TRABALHO` trata X0 como
descoberta e X1 como implementação posterior — isso continua correto, mas o custo de X1 deve ser
lido como um produto novo, não como conexão de peças prontas.

## 7. Estado do Hermes — o que muda o procedimento

Da auditoria (R7): container `rayzen-hermes-spike` parado, exit 137, `restart: "no"`,
comando `sleep infinity`, e **`MCP_TOKEN_HERMES` ausente do ambiente do container**, embora o
compose o declare.

**Medido no servidor em 13/09 (leitura apenas, nenhum valor de credencial impresso):**

| verificação | resultado |
|---|---|
| checkout do servidor | `/home/rayzen/projects/rayzen-ai`, HEAD `ae7dc0b` — igual ao local |
| deploy em andamento (`rayzen-deploy.sh`) | nenhum — janela livre para operação manual |
| container `rayzen-hermes-spike` | `Exited (137)`, **criado em 2026-09-08 00:45 UTC** |
| `MCP_TOKEN_HERMES` no ambiente do container parado | **ausente** |
| `MCP_TOKEN_HERMES` no `.env` do servidor | **a linha não existe** — nem vazia |
| `MCP_TOKEN_RAYZEN_AI` no `.env` | presente, com valor |
| `mcp-http` | recriado em 13/09 04:07 UTC — **tem o código da Fase 8** |
| consumidores que o `mcp-http` declara | `MCP_TOKEN_HERMES`, `MCP_TOKEN_RAYZEN_AI` |
| ...quais chegam **com valor** ao processo | **só `MCP_TOKEN_RAYZEN_AI`** |

A cadeia fecha, e é mais específica do que a auditoria pôde afirmar: o token do Hermes **nunca foi
gerado**. O compose resolve `${MCP_TOKEN_HERMES}` para vazio, e
[`rayzen-mcp-http.mjs:164`](../../../apps/agent/src/mcp/rayzen-mcp-http.mjs#L164) filtra por
`/^MCP_TOKEN_[A-Z0-9_]+$/.test(chave) && valor` — **token vazio é descartado**, então o consumidor
`hermes` simplesmente não existe do lado do servidor. O Hermes receberia `unauthorized` mesmo com
tudo declarado corretamente no YAML.

A data do container explica a observação R7 da auditoria sem precisar de hipótese: criado em
**08/09**, antes de a Fase 8 existir no código. Por isso a variável não está no ambiente dele — e
por isso `docker start` devolveria o mesmo ambiente vazio. Só `up -d --force-recreate` a injeta.

**Consequência para H0: há um pré-requisito de credencial antes do primeiro passo técnico.** Gerar
`MCP_TOKEN_HERMES`, declará-lo no `.env` do servidor e **recriar o `mcp-http`** (o processo lê
`process.env` na subida; sem recriar, o consumidor novo não é descoberto). Isso é mutação de
configuração de produção — decisão do dono, não escolha técnica de rotina.

E a advertência do CLAUDE.md vale para cada `up` manual: conferir `ps aux | grep rayzen-deploy.sh`
antes — o `flock` do deploy automático não protege contra um `up` manual concorrente. Conferido
nesta medição (nenhum em andamento); precisa ser reconferido no momento da execução.

## 8. Correções a fazer no próprio pacote

| documento | ajuste |
|---|---|
| `CONTINUIDADE.md` | "HEAD/branch atual: não verificado" → `ae7dc0b` / `main`, limpo. "Alterações locais preexistentes" → nenhuma |
| `DIRECAO-E-DECISOES.md §5` | quatro das seis perguntas têm resposta (§5 acima) |
| `PLANO-DE-TRABALHO.md §9` | X0 descrito como inventário de conectores existentes; o resultado é vazio (§6) |
| `CRITERIOS-DE-ACEITE.md` C02 | o cenário cobre silêncio e negação; falta o caso oposto — a resposta afirmativa oferecida pelo sistema **não** sendo reconhecida (§3) |
| todos | as referências a `docs/evolution/rayzen-hermes/*` só passam a ser válidas depois de o pacote ser copiado para o repositório |

## 9. O que esta rodada **não** fez

Nenhuma conversa real, nenhuma tarefa enfileirada, nenhuma mensagem de Telegram, nenhum container
iniciado ou recriado, nenhum teste de produto adicionado, nenhuma permissão alterada, nenhum
commit. As reproduções P1–P7 da auditoria **não** foram reexecutadas: o delta de §1 prova que os
arquivos que elas exercitam não mudaram, e reexecutar sem mudança não é evidência nova.

A regex de §3 foi medida com `node -e` sobre as duas expressões literais do arquivo — sem carregar
o módulo, sem spawn, sem rede.
