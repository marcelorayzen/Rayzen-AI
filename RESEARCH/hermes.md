> ⚠️ **PESQUISA DE TERCEIRO — NÃO É CONHECIMENTO DO RAYZEN AI.**
> Tudo aqui vem da documentação pública do produto, consultada em **2026-09-05**. Nada foi
> instalado, executado ou verificado contra um Hermes real. Documentação descreve intenção; só a
> execução descreve comportamento. Fonte em cada afirmação; o que não tem fonte não está aqui.

# Hermes Agent (Nous Research)

## O que é

Agente pessoal open-source da Nous Research — o mesmo laboratório dos modelos Hermes, Nomos e
Psyche. Repositório: [`nousresearch/hermes-agent`](https://github.com/nousresearch/hermes-agent),
com o lema *"the agent that grows with you"*.
[[docs](https://hermes-agent.nousresearch.com/docs/)]

Seções da documentação: Getting Started · User Guide · Features · Messaging Platforms ·
Integrations · Guides & Tutorials · Developer Guide · Reference.

---

## Modelo de memória

**É o eixo mais relevante para o nosso caso, e ele é bem definido.**

| propriedade | o que a doc diz |
|---|---|
| onde fica | `~/.hermes/memories/` — dois arquivos: `MEMORY.md` e `USER.md` |
| formato | markdown, entradas separadas por delimitador `§` |
| tamanho citado | `MEMORY.md` ~2.200 caracteres · `USER.md` ~1.375 caracteres |
| como entra no modelo | **injetada no system prompt como snapshot congelado no início da sessão** |
| separação | `memory` = fatos do ambiente, convenções, lições · `user` = preferências, estilo, expectativas |
| escopo | **por *profile*, não por projeto** — "give a second agent its own profile" |

[[memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)]

### O agente escreve sozinho — e dá para exigir aprovação

Por padrão o agente escreve a própria memória. Existe chave de configuração:

```yaml
memory:
  write_approval: false   # true = exige aprovação
```

Com `true`, as escritas ficam **em estágio de revisão**, consultáveis por `/memory pending`.
[[memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)]

> Isso é exatamente o controle que o Marcelo pediu quando falou em "não deixar ele gravar para não
> causar colapso de memória". Não precisa ser construído — é um booleano.

### Provedores externos de memória

A doc cita **8 plugins de provedor externo**: Honcho, OpenViking, Mem0, Hindsight, Holographic,
RetainDB, ByteRover e Supermemory. Eles rodam **ao lado** da memória embutida, não no lugar dela, e
acrescentam coisas como grafo de conhecimento e busca semântica.
[[memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)]

A doc inicial também referencia [Honcho](https://github.com/plastic-labs/honcho) para modelagem de
usuário. [[docs](https://hermes-agent.nousresearch.com/docs/)]

### Recall entre sessões

A página inicial menciona *"FTS5 cross-session recall with LLM summarization"* e descreve a memória
como *"agent-curated"*, com o agente *"nudging itself to persist knowledge"*.
[[docs](https://hermes-agent.nousresearch.com/docs/)]

**Não verificado:** o esquema exato do índice FTS5, se ele indexa além dos dois `.md`, e como a
sumarização por LLM decide o que persistir.

---

## MCP

**Hermes é cliente MCP, não servidor.** *"Connect to any MCP server for extended tool capabilities."*
[[docs](https://hermes-agent.nousresearch.com/docs/)]

| aspecto | suporte |
|---|---|
| transporte | **stdio** (subprocesso local) e **HTTP/SSE** (remoto), misturáveis na mesma config `mcp_servers` |
| filtro de ferramentas | **`include`** (whitelist) e **`exclude`** (blacklist), com glob `*`, `?`, `[...]` |
| autenticação | Bearer (`headers: {Authorization: "Bearer ***"}`), **OAuth 2.1**, mTLS (`client_cert`), headers customizados |
| OAuth | identifica-se com *Client ID Metadata Document*; cai para *Dynamic Client Registration* onde não houver |

[[mcp](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)]

> **Consequência direta para o Rayzen:** o `mcp-http` já é servidor MCP com OAuth, roteado
> publicamente em `rayzen.com.br/mcp*`. Um `include` com as 9 ferramentas de leitura resolveria o
> escopo **sem uma linha de código no Rayzen**.
>
> Ressalva honesta: filtro no cliente é **conveniência, não fronteira de segurança**. Quem detém o
> token pode chamar as 11 ferramentas de escrita por fora do Hermes. Para virar fronteira de
> verdade, o escopo precisa existir no servidor.

---

## Plugins

Estrutura em `~/.hermes/plugins/<nome>/`, registrando ferramentas e hooks **sem alterar o core**.
[[plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)]
[[dev guide](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)]

Todo `hermes plugins install` e `update` roda uma **varredura estática de segurança** na árvore do
plugin antes de ativar, procurando: exfiltração de credencial, reverse shell, comando destrutivo,
mecanismo de persistência, execução ofuscada e prompt injection.
[[plugins](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)]

---

## Skills

Documentos de conhecimento carregados sob demanda, com *progressive disclosure* para economizar
token. Compatíveis com o padrão aberto **agentskills.io**, portáveis entre Hermes, Claude Code,
Cursor e Codex. [[skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)]
[[catálogo](https://hermes-agent.nousresearch.com/docs/reference/optional-skills-catalog)]

Existe skill oficial para delegar tarefas ao **Claude Code**.
[[skill claude-code](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-claude-code)]

---

## Implantação

**6 backends de terminal:** local, Docker, SSH, Daytona, Singularity, Modal.
Plataformas: Linux, macOS, WSL2, Windows nativo, Nix, NixOS, Android.
Modal e Daytona oferecem hibernação com custo desprezível quando ocioso.
Instalação anunciada em 60 segundos. [[docs](https://hermes-agent.nousresearch.com/docs/)]

### Footprint medido no H81 — 2026-09-06 a 07 (spike de 24h)

Nenhum número de footprint aparece na documentação. Estes foram medidos no container
`rayzen-hermes-spike`, com teto de 1,5 CPU e 2 GiB.

| | medido |
|---|---|
| imagem | **3,94 GB** |
| instalação sob `~/.hermes` | **1,20 GB** — `hermes-agent` 991 MB · `node` 230 MB · `bin` 48 MB |
| camada gravável após 24 h | **106 MB** |
| volume de memórias (`hermes-data`) após 24 h | **0 B** |
| RAM em repouso | **14,7 MiB** |
| CPU em repouso | **0,00 %** |
| RAM durante uma sessão | **369 MiB** |
| crescimento por sessão trivial | **8,5 KB** |

Três leituras que os números sozinhos não dão:

- **O "repouso" é de um container que dorme.** O `CMD` é `sleep infinity` e as sessões entram por
  `docker exec` — não há daemon. Os 14,7 MiB são o `sleep`, não o Hermes. Reportar isso como
  "consumo em repouso do Hermes" seria medir a coisa errada com precisão.
- **Os 106 MB da camada gravável não são crescimento por uso**: `docker diff` mostra que são
  `__pycache__` compilado no primeiro boot. O crescimento real por sessão é de **8,5 KB**.
- **O volume de memórias ficou em 0 B**, com `memory.write_approval: true`. É a garantia do j4
  segurando por 24 h: ele lê o Rayzen e não escreve nada, nem na memória dele.

### O "provider não é honrado" era falso — investigado em 2026-09-07

Em 06/09 registrei que o `provider: lmstudio` do `config.yaml` **não** era honrado: `hermes status`
dizia `Provider: OpenRouter`, e a chamada saía com `HTTP 401: Missing Authentication header`. **A
conclusão estava errada.** Investigado sob pedido, e nesta ordem:

| verificação | resultado |
|---|---|
| `HERMES_HOME` / profile | não definido; `HOME=/home/hermes`, sem profile concorrente |
| volume de config no container | `/home/hermes/.hermes/config.yaml`, montado `:ro` do repositório |
| `hermes config get model` | `default: gpt-4o-mini-gemini` · **`provider: lmstudio`** |
| `hermes config get model.provider` | **`lmstudio`** |
| `hermes config get provider` | *Config key not set* — a chave canônica é **`model.provider`**; o `provider:` de topo é **mapeado** para lá |
| `hermes status` | `Model: gpt-4o-mini-gemini` · **`Provider: LM Studio`** |
| `hermes -z "…"` **sem flag** | **`ok`** — roteou pelo LiteLLM |
| entrypoint | `sleep infinity`, não participa da resolução |

**A causa era estado persistido, não configuração.** O `state.db` guarda duas sessões de
**06/09 16:26/16:27** com o modelo gravado na forma concatenada `lmstudio/gpt-4o-mini-gemini` — a
forma que eu mesmo passei durante o spike do j4, e que o próprio `config.yaml` já documentava como
não-roteável. O processo estava de pé havia 24 h e servia aquele estado; `status` lia dali, o
"provider" saía do valor colado, não casava provedor conhecido, e caía no padrão (OpenRouter), cuja
chave não existe — daí o 401.

A queda de energia de 07/09 derrubou o container (`restart: "no"`, por desenho). Ao subir de novo,
processo novo releu o `config.yaml` e tudo passou a responder certo.

> **Mesma família do `dist/` congelado e do container mais velho que a imagem**: processo de longa
> duração servindo estado de antes, com toda a evidência de superfície apontando para configuração.
> A regra que vale: **antes de acusar o arquivo de config, reinicie o processo e releia**. E o
> `--provider` na linha de comando não era conserto — era um sintoma mascarado.

Fica um alerta real, menor: passar `-m <provider>/<modelo>` **grava** a forma colada no `state.db`,
e ela sobrevive à sessão. Use `--provider` e `-m` separados.

---

## Autenticação do próprio Hermes

OAuth via **Nous Portal** para acesso a modelos e ferramentas. A seção de Security cita
*"command approval, authorization, container isolation"*.
[[docs](https://hermes-agent.nousresearch.com/docs/)]

**Não verificado:** o modelo de escopos/permissões em detalhe; a página inicial não o descreve.

---

## Outros recursos citados

Messaging gateway · cron · ACP · API server · CLI · configuração · temas.
[[docs](https://hermes-agent.nousresearch.com/docs/)]

Diretório comunitário independente de skills, plugins e provedores de memória:
[`0xNyk/awesome-hermes-agent`](https://github.com/0xNyk/awesome-hermes-agent).

---

## Lacunas para fechar antes de decidir

1. Footprint real (CPU/RAM/disco) rodando em container.
2. Licença do projeto.
3. Se o `write_approval` cobre também os provedores externos de memória ou só a embutida.
4. Se o filtro `include`/`exclude` é aplicado antes de o modelo ver a lista de ferramentas
   (importante: se ele *vê* mas não pode chamar, ainda tenta e falha).
5. Como o Nous Portal se relaciona com uso de modelo próprio via LiteLLM.
6. Se a memória por *profile* consegue representar "por projeto" sem virar N agentes.
