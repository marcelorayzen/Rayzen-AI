> ⚠️ **PESQUISA DE TERCEIRO — NÃO É CONHECIMENTO DO RAYZEN AI.**
> Consultado em **2026-09-05**. Nada instalado nem executado. Esta é a mais rasa das três
> pesquisas: as informações vêm essencialmente da página do produto.

# superharness — e a categoria "agent harness"

## Primeiro, a categoria

O termo **agent harness** surgiu entre o fim de 2025 e o começo de 2026 para nomear a camada de
runtime que embrulha um LLM e o transforma de completador de texto sem estado em **agente com
estado e objetivo**: laço de despacho de ferramentas, permissões, contexto e ciclo de vida.
[[Databricks](https://www.databricks.com/blog/ai-harness)] [[Parallel](https://parallel.ai/articles/what-is-an-agent-harness)]

Outros projetos na mesma categoria, para referência:

- [`HKUDS/OpenHarness`](https://github.com/HKUDS/OpenHarness) — harness aberto com agente pessoal embutido
- [`SuperagenticAI/superqode`](https://github.com/SuperagenticAI/superqode) — framework de engenharia de harness para agentes de código
- [`danielrosehill/AI-Harnesses`](https://github.com/danielrosehill/AI-Harnesses) — inventário de projetos que se descrevem como harness (abril/2026)
- [best-of Agent Harnesses](https://ryanalberts.github.io/best-of-Agent-Harnesses/) — lista curada e ranqueada

> **Isso importa para o desenho:** o Rayzen já é, em parte, um harness — ele tem whitelist de 44
> ações, role policy, PolicyEngine com gates e `supervised_session` com protocolo de checkpoint.
> A pergunta não é "preciso de um harness?", é "o que o meu já faz e o que falta".

---

## superharness especificamente

Site: [superharness.dev](https://superharness.dev/) — *"give your AI coding agent a team"*.

| propriedade | o que a página diz |
|---|---|
| o que embrulha | **tmux** em volta de um agente de código: **Claude Code, OpenCode ou Codex** |
| paralelismo | o agente gera quantos *workers* a tarefa exigir, cada um num fluxo independente |
| isolamento | **cada worker recebe seu próprio `git worktree`** — sem conflito de arquivo |
| integração | workers commitam nos próprios branches; o orquestrador **mescla e limpa automaticamente** |
| aprovação | **auto-aprova operações seguras, enfileira decisões incertas** e faz *debrief* quando você volta |
| ganho alegado | *"o que leva 4 horas com um agente leva ~1 hora com um time de 4"* — número do fornecedor, não medido |

---

## Por que ele é de outra categoria

superharness **não é assistente conversacional com memória**. É orquestrador de agente de código.
Não compete com Hermes/OpenClaw no eixo que interessa aqui — ele compete com o
`supervised_session` que o Rayzen já tem.

Comparação direta com o que existe no Rayzen hoje:

| | superharness | Rayzen `supervised_session` |
|---|---|---|
| lança | Claude Code / OpenCode / Codex | Claude Code (`spawn('claude', ['-p', …])`) |
| paralelismo | N workers | **1 sessão por vez**, `MAX_ITERATIONS = 20` |
| isolamento | git worktree por worker | mesmo diretório de trabalho |
| aprovação | auto-aprova seguro, enfileira incerto | protocolo `[[RAYZEN:STEP_DONE]]` / `QUESTION` e espera resposta |
| permissões | não verificado | **`--dangerously-skip-permissions`** |
| debrief | sim | eventos e log ao vivo para a API |

> O contraste mais útil é o de **permissões**: o superharness anuncia auto-aprovação **seletiva**
> ("safe operations"), enquanto o Rayzen hoje desliga a checagem inteira. Independente de adotar ou
> não o superharness, isso é um alvo de melhoria claro no que já existe.
>
> O segundo é o **git worktree por worker**, que resolve conflito de arquivo por construção.

---

## Lacunas para fechar antes de decidir

1. Licença e se é open-source ou produto comercial.
2. Se tem qualquer noção de memória persistente (aparentemente não, mas não confirmei).
3. Se fala MCP.
4. Se roda em Windows ou exige ambiente POSIX — **depende de `tmux`**, o que sugere Linux/macOS ou
   WSL. Isso é relevante: o Claude Code do Marcelo roda no **PC Windows**.
5. Como o orquestrador decide o que é "operação segura".
6. Se o número "4h → 1h" tem alguma medição pública por trás.

---

## Fontes

- [superharness.dev](https://superharness.dev/)
- [What is an AI Agent Harness? — Databricks](https://www.databricks.com/blog/ai-harness)
- [What is an AI harness? — Parallel](https://parallel.ai/articles/what-is-an-agent-harness)
- [OpenHarness — HKUDS](https://github.com/HKUDS/OpenHarness)
- [superqode — SuperagenticAI](https://github.com/SuperagenticAI/superqode)
- [AI-Harnesses (inventário, abril/2026)](https://github.com/danielrosehill/AI-Harnesses)
- [best-of Agent Harnesses](https://ryanalberts.github.io/best-of-Agent-Harnesses/)
