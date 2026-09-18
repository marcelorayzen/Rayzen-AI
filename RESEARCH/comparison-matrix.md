> **Confiança das colunas é desigual, e isso muda como se lê a tabela.**
> `rayzen-current` foi **medido** contra o código e a produção em 2026-09-05.
> `hermes` vem da documentação oficial. `openclaw` vem majoritariamente de **fontes de terceiros**.
> `superharness` vem essencialmente da página do produto.
> Marcado `?` = não verificado. **`?` não significa "não tem" — significa "não sei".**

# Matriz de comparação

Os eixos foram escolhidos a partir do objetivo declarado — *um agente que conversa comigo, usa a
memória e os recursos do Rayzen, entende ao vivo o que está acontecendo e não corrompe a memória* —
e não a partir da lista de features de ninguém.

---

## 1. Memória

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| onde | Postgres 16 + pgvector | `~/.hermes/memories/*.md` | `~/.openclaw/memory/main.sqlite` + `.md` | ? (aparentemente nenhuma) |
| volume medido | **1.890 docs, 46 MB** | ~3.575 chars nos dois arquivos | ? | — |
| busca | vetorial (Jina 1024), piso 0.52 | FTS5 + sumarização por LLM | vetorial / keyword / híbrida, `sqlite-vec` | — |
| como entra no prompt | 4 trechos de 400 chars, por consulta | **snapshot congelado no início da sessão** | chunks ~400 tokens, 80 de overlap | — |
| escopo | **por projeto** (`project_id`) | **por profile** | ? | — |
| ciclo de vida | `inbox → working → consolidated` (só **2,9%** dos docs) | dois arquivos, sem classes | `MEMORY.md` + log diário | — |
| provedor externo | não | **8 plugins** (Mem0, Honcho, Supermemory…) | plugins e MCP comunitários | — |

**Leitura:** o Rayzen tem, de longe, o acervo maior e a única segmentação **por projeto**. Hermes e
OpenClaw têm memória **pessoal e pequena** — de assistente, não de base de conhecimento. São
complementares, não concorrentes.

---

## 2. Caminho de escrita e quem aprova

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| o agente escreve sozinho? | n/a (quem escreve são 7 serviços) | **sim, por padrão** | sim | — |
| existe aprovação? | **não, no caminho da memória** | **sim: `memory.write_approval: true`** → `/memory pending` | ? | auto-aprova "seguro", enfileira incerto |
| gates existentes | `approval_gates` + PolicyEngine (5 regras) — só para operações, não para memória | ? | ? | ? |

**Leitura:** o receio de colapso de memória tem **resposta pronta no Hermes** — é um booleano de
configuração. No OpenClaw, é a lacuna mais importante a fechar.

---

## 3. Acesso a evento ao vivo

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| mecanismo | **WebSocket `:3104/ws`** | ? | **heartbeat** (polling agendado) | debrief ao retornar |
| autenticado | **sim, desde 18/08** (token no `subscribe` ou Bearer) | ? | ? | — |
| limites | 50 conexões, 20 msg/10 s, prazo de 10 s | ? | ? | — |
| exposição | LAN `0.0.0.0` + `wss://api.rayzen.com.br/ws` | ? | ? | — |

**Leitura:** o Rayzen **já tem stream autenticado, com filtro por projeto e rate limit**. O
heartbeat do OpenClaw resolve o mesmo problema por polling, que é mais caro e menos imediato.
Este é o ativo do Rayzen que mais se aproxima do "entender ao vivo" — e ele já existe.

---

## 4. Integração por MCP

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| papel | **servidor** (21 ferramentas) | **cliente** | provavelmente cliente (`?`) | ? |
| transporte | stdio + HTTP | stdio + HTTP/SSE | ? | ? |
| filtro de ferramentas | **não existe** | **`include`/`exclude` com glob** | ? | ? |
| auth | OAuth + Bearer | Bearer, OAuth 2.1, mTLS, headers | ? | ? |

**Leitura — o encaixe mais limpo de toda a matriz:** Rayzen é servidor MCP; Hermes é cliente MCP
com filtro e OAuth. As duas pontas já existem e são compatíveis. O escopo read-only sairia de
configuração do cliente, **sem código novo no Rayzen**.

> Ressalva que não pode se perder: **filtro no cliente não é fronteira de segurança.** Quem tem o
> token alcança as 11 ferramentas de escrita por fora do Hermes. Vira fronteira só com escopo no
> servidor.

---

## 5. Delegação de execução de código

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| lança agente de código | **sim** — `supervised_session`, 269 linhas | sim, via skill oficial de Claude Code | ? | **é a razão de existir** |
| paralelismo | 1 sessão, `MAX_ITERATIONS = 20` | ? | ? | **N workers** |
| isolamento | mesmo diretório | ? | ? | **git worktree por worker** |
| permissões | **`--dangerously-skip-permissions`** | varredura estática em plugin; "command approval" | ? | auto-aprova só o "seguro" |
| checkpoint | protocolo `[[RAYZEN:*]]` | ? | ? | debrief |

**Leitura:** o Rayzen já delega execução. O que falta não é a capacidade — é **permissão granular**
e **isolamento**. Nesses dois pontos, tanto o superharness quanto o Hermes descrevem algo melhor
que o bypass total de hoje.

---

## 6. Canais com o usuário

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| interfaces | web própria, widget Electron, MCP, Telegram (não medido nesta rodada) | messaging gateway (não detalhado) | **WhatsApp, Telegram, Slack, Discord, Signal, iMessage, WebChat** | tmux/terminal |

**Leitura:** OpenClaw é o mais forte aqui, e por larga margem. "Falar comigo pelo celular" sai de
graça.

---

## 7. Custo de rodar no servidor

| | rayzen-current | hermes | openclaw | superharness |
|---|---|---|---|---|
| footprint medido | 12 containers; **11 GiB RAM (8,6 livres)**, i5-4590 4 núcleos | **imagem 3,94 GB** · RAM **30–86 MiB** em execução · CPU ~0% ocioso | **?** | **?** |
| implantação | Docker Compose | 6 backends (local, Docker, SSH, Daytona, Singularity, Modal) | self-hosted | exige **tmux** (POSIX) |

**Leitura:** RAM e CPU sobram. Nenhum dos três publica footprint — então o do Hermes foi **medido**
em 2026-09-06, subindo o container no próprio H81:

| | medido |
|---|---|
| imagem | **3,94 GB** — Python 3.11 + Node v24 + ffmpeg + `build-essential` |
| RAM em execução | **30–86 MiB** (556 KiB parado, mas parado é só `sleep`) |
| CPU ocioso | ~0% |
| disco do host | 52% → 59% no build, com o cache incluído |
| **não medido** | crescimento em 24h — exige o container rodando um dia |

> **3,94 GB é o número que a doc não dá**, e ele muda a conversa: não é um binário leve. A maior
> parte vem do `build-essential`, exigido para compilar `node-pty` — requisito que a documentação
> lista como sendo **só do app desktop**, e que na prática derruba o build do CLI sem ele.

E um detalhe operacional que só apareceu medindo: superharness depende de `tmux`, enquanto o
Claude Code do Marcelo roda em **Windows**.

E um detalhe prático: superharness depende de `tmux`, enquanto o Claude Code do Marcelo roda em
**Windows**.

---

## Onde cada um se encaixa, se algum

Sem recomendar ainda — só organizando o que a matriz mostra:

- **Rayzen** já é a memória por projeto, o stream ao vivo autenticado, o servidor MCP e o
  delegador de execução. Falta escopo de leitura, aprovação na memória e permissão granular.
- **Hermes** é o que mais se encaixa como *consumidor*: cliente MCP com filtro e OAuth, memória
  própria pequena com aprovação opcional, plugins com varredura de segurança.
- **OpenClaw** ganha em canais e tem a memória mais parecida com a do Rayzen (SQLite + vetor) — o
  que o torna **redundante** onde o Hermes seria complementar. E carrega uma literatura de
  segurança que precisa ser lida antes.
- **superharness** não disputa este espaço; ele disputa o do `supervised_session`, e nos dois
  pontos em que o Rayzen é fraco: isolamento e permissão.

---

## As cinco perguntas que decidem, e que ainda não têm resposta

1. **Footprint real** de cada candidato num container — o disco está em 82%.
2. **OpenClaw tem equivalente ao `write_approval`?** Sem isso, o receio de colapso volta.
3. O filtro `include`/`exclude` do Hermes é aplicado **antes** de o modelo enxergar a lista de
   ferramentas, ou só na hora de chamar?
4. Alguma coisa vai **escrever** no Rayzen, ou o consumo é 100% leitura? Isso decide se o escopo
   pode ficar no cliente ou precisa existir no servidor.
5. Licença de cada um.
