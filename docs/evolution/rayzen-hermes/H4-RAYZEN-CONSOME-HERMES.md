# H4 — `hermes mcp serve`: o Rayzen consumindo o Hermes (17/09)

Item 4 da ordem combinada, e a **direção inversa** de tudo o que existia até aqui. Até hoje o
Hermes consome o Rayzen: `MCP_TOKEN_HERMES` → `ESCOPO_LEITURA` → 9 ferramentas de consulta
(Fase 8 do plano de execução tipada). Esta é a pergunta oposta.

Medido no container `rayzen-hermes-spike`, v0.21.2. Nada configurado, nada persistido.

---

## 1. Funciona — e não expõe o que o nome sugere

`hermes mcp serve` é MCP por **stdio** (não tem `--port`). O `initialize` responde, e a própria
descrição do servidor diz o que ele é:

```json
"instructions": "Hermes Agent messaging bridge. Use these tools to interact with conversations
                 across Telegram, Discord, Slack, WhatsApp, Signal, Matrix, and other
                 connected platforms."
"serverInfo": {"name": "hermes", "version": ""}
```

As 10 ferramentas:

| ferramenta | |
|---|---|
| `conversations_list` · `conversation_get` · `messages_read` | ler conversa |
| `attachments_fetch` | anexos de uma mensagem |
| `events_poll` · `events_wait` | acompanhar evento novo (o segundo é long-poll) |
| **`messages_send`** | **enviar mensagem** |
| `channels_list` | canais e alvos disponíveis |
| `permissions_list_open` · `permissions_respond` | fila de aprovação pendente, e responder |

> **O que isto NÃO é, e o subcomando engana:** `mcp serve` não expõe *o agente* Hermes como
> ferramenta. Não há "peça ao Hermes que faça X". O que atravessa é **acesso à mensageria e à fila
> de aprovações** dele. Consumir isso não dá ao Rayzen nenhuma capacidade de execução nova.

Chamadas reais, com o gateway de mensageria desconectado (`platforms.configured: 0`):

```
conversations_list → {"count": 0, "conversations": []}
channels_list      → {"count": 0, "channels": []}
```

Correto: a ponte funciona e não tem o que ligar. Sem plataforma conectada, o valor é zero — não
por defeito, por ausência de ponta do outro lado.

---

## 2. A fronteira é assimétrica, e essa é a conclusão que importa

| direção | como está protegida |
|---|---|
| Hermes → Rayzen | `MCP_TOKEN_HERMES` próprio, escopo de **leitura** (9 de 20 ferramentas), nomeado no log de acesso do `mcp-http`, revogável sozinho |
| Rayzen → Hermes | **stdio: não existe camada de autenticação.** Quem consegue `docker exec` tem as 10, `messages_send` incluído |

A direção nova é a de **escrita**, e é a que não tem token. Não é defeito do Hermes — stdio herda a
autorização de quem lança o processo, e é assim que o `rayzen-mcp.mjs` desta casa também funciona.
É consequência de desenho, e precisa ser dita antes de alguém ligar os dois.

> **E há um detalhe de topologia que fecha a questão por ora:** para a api consumir isso ela
> precisaria de `docker exec` — ou seja, do socket do Docker. O `api-v2` **não tem socket de
> propósito**, e a razão está escrita no `CLAUDE.md`: dar-lhe o socket *"trocaria um sensor por
> escalada de privilégio — socket do Docker é root no host"*. O sensor de `deploy-drift` mora no
> `agent-server` exatamente por isso.
>
> Então "o Rayzen consome o Hermes" não é uma configuração — é uma decisão de conceder ao processo
> da api um acesso que foi negado a ele por escrito, para ganhar ferramentas de mensageria de um
> canal que o Rayzen já tem (`telegram_responde` verde).

**Recomendação medida: não ligar agora.** O consumo que faz sentido é do **Claude Code na máquina
de trabalho** (`docker exec -i` por ssh como transporte de um servidor MCP), onde a autorização já
é a do dono e não há privilégio novo sendo concedido a um serviço. E mesmo esse só ganha valor
depois de haver plataforma conectada — hoje devolveria `count: 0`.

---

## 3. A armadilha do probe, que quase virou um achado falso

Meu primeiro probe mandou `initialize`, `notifications/initialized` e dois `tools/call` de um
arquivo, com `hermes mcp serve < arquivo`. Resultado: o `initialize` respondeu e **os `tools/call`
nunca responderam** — 90s, depois 120s, `-v` ligado, **stderr vazio**.

Eu estava a um passo de registrar *"`tools/call` trava"*. Estaria errado.

A causa é o probe: ao terminar o arquivo, o stdin fecha, e o servidor derruba as chamadas
**assíncronas** ainda em voo. `tools/list` é síncrono e responde antes; `tools/call` não. Mantendo
o stdin aberto:

```bash
{ cat /tmp/mcp-call.jsonl; sleep 45; } | hermes mcp serve
```

as duas responderam — e **fora de ordem** (`id 4` antes do `id 3`), que é o comportamento normal de
MCP assíncrono.

> Um cliente MCP de verdade nunca fecha o stdin no meio. O probe que fecha produz exatamente a
> assinatura desta casa: **nada dá erro, nada aparece no stderr, e a conclusão está errada.** Vale
> como regra para sondar qualquer servidor MCP stdio — segure o stdin, e desconfie de silêncio
> como se fosse resultado.

---

## 4. Balanço

| pergunta | resposta medida |
|---|---|
| `hermes mcp serve` funciona? | **sim** — `initialize`, `tools/list` e `tools/call` respondem |
| expõe o agente Hermes? | **não** — expõe mensageria e a fila de aprovações |
| daria capacidade nova ao Rayzen? | **não** de execução; daria envio de mensagem e resposta a aprovação |
| tem autenticação? | **não** — stdio; quem executa tem tudo, `messages_send` incluído |
| a api pode consumir? | só com socket do Docker, que lhe foi negado por escrito |
| vale ligar agora? | **não.** Zero plataformas conectadas → `count: 0`, e o canal já existe no Rayzen |
