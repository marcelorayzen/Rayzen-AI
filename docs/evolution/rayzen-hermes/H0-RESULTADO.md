# H0 — o Hermes conversa e usa o Rayzen: **aprovado**

Data: 13/09/2026 · executado no servidor H81 (`servidor-local`) com autorização explícita do dono.
Revisão do checkout no servidor: `ae7dc0b` (igual ao local).

**Pergunta de H0:** o Hermes, com o MCP do Rayzen conectado, sustenta um turno em que *decide
sozinho* chamar uma ferramenta de contexto e usa a resposta? **Sim, com dados reais e corretos.**

---

## 1. Resultado

Pergunta enviada (não-interativa, `hermes -z`):

> *"Liste os projetos registrados no Rayzen e diga em que stage está o projeto Rayzen AI. Use as
> ferramentas do servidor MCP rayzen para responder com dados reais, não invente."*

Resposta: os **10 projetos reais** (Alfa soluções, rayzen-job-hunter, Urna Trust Boundary,
marcelorayzen-site, Rayzen Commerce Platform, VB Ferragens, Banco Imobiliário Online Caótico,
Ray coach, Rayzen AI, Rayzen-PDV) e o stage do Rayzen AI: **`building`**.

**Verificação cruzada:** `building` é exatamente o stage que o `rayzen-context-hook` injeta na
sessão do Claude Code nesta mesma data. Duas fontes independentes, mesmo valor — a resposta não é
plausível, é conferível.

**Prova do caminho, não só da resposta:** o log do `mcp-http` registra
`9 × [MCP] acesso de "hermes" (escopo: leitura)` na janela do teste. As chamadas saíram do Hermes,
chegaram ao servidor MCP, foram autenticadas pelo token próprio e identificadas nominalmente.

## 2. O que foi executado, em ordem

| # | ação | resultado |
|---|---|---|
| 0.a | `.env` do servidor: backup `cp -p` → `.env.bak-20260913-160005`; `MCP_TOKEN_HERMES` gerado com `openssl rand -hex 32` e acrescentado | 64 chars, permissões `600 rayzen:rayzen` preservadas. **Valor nunca impresso** em output, log ou documento |
| 0.b | `docker compose up -d --force-recreate --no-deps mcp-http` | recriado; passa a enxergar **os dois** consumidores com valor |
| 0.c | `tools/list` com o token novo **e** com um token inválido | token novo: autentica (400 do protocolo MCP, falta `initialize` — não é 401). Token inválido: **401 `unauthorized`**. Controle negativo confirma que o teste positivo mede algo |
| 1 | `ps aux \| grep rayzen-deploy.sh` antes de cada `up` | zero nas duas vezes |
| 2 | `docker compose -f infra/hermes/docker-compose.hermes.yml --env-file .env up -d --force-recreate --build` | build frio de **~5,5 min**; container `Up`, token presente no ambiente |
| 3 | `hermes --version` · `config check` · `doctor` | v0.21.2 (2026.9.11); `LM_API_KEY`/`LM_BASE_URL` ✓; 5 issues (§4) |
| 4 | `hermes mcp list` | `rayzen \| http://mcp-http:3102/mcp \| 9 selected \| ✓ enabled` |
| 5 | `hermes -z "<pergunta>"` | §1 |
| 6 | log do `mcp-http` | 9 acessos nomeados `hermes` |

Nenhum outro serviço foi tocado. `mcp-http` ficou fora por segundos no passo 0.b — efeito
declarado antes de executar.

## 3. Decisão que isto habilita

A premissa central do plano — *Hermes como camada agêntica sobre as capacidades do Rayzen* — **se
sustenta**. H1 e H2 seguem como o pacote propõe, e a ordem `H0 → H1/H2 → I1` deixa de ser aposta.

Fecha também um mistério do inventário: o spike **nunca poderia** ter funcionado. `MCP_TOKEN_HERMES`
nunca tinha sido gerado (a linha não existia no `.env`), então o consumidor `hermes` não existia do
lado do servidor. O `exit 137` observado pela auditoria não precisa de explicação exótica: o spike
nunca teve acesso ao Rayzen para começar.

## 4. Ressalvas — o que **não** foi provado, e a dívida encontrada

**Não provado:** retomada de sessão entre reinícios (C08), continuidade de conversa longa,
isolamento entre projetos (C09), qualquer escrita, e o comportamento sob concorrência. H0 mediu
**um** turno.

> **A dívida abaixo foi CORRIGIDA no mesmo dia — ver §6.** O registro fica porque o diagnóstico
> é o que justifica a correção.

**Dívida de configuração, encontrada pelo `doctor`:**

| item | o que é |
|---|---|
| `Config version: 0 → 44` | o `config.yaml` versionado está num schema muito anterior ao que o v0.21.2 espera |
| *"Stale root-level provider/base_url in config.yaml"* | `provider:`/`model:` na raiz são a forma **antiga**. Os comentários do arquivo documentam uma investigação de 06/09 contra uma versão anterior do Hermes — a conclusão continua registrada, mas o formato mudou |
| `doctor --fix` não pode rodar | o `config.yaml` é montado `:ro` por decisão de desenho. O fix precisaria ser feito **no repositório** e o container recriado |
| 2 + 6 vulnerabilidades npm | em `agent-browser` e `web workspace`, ferramentas que o piloto não usa |

**Funcionou apesar da dívida** — o roteamento do modelo pegou via `LM_BASE_URL`/`LM_API_KEY`, que é
o caminho por variável de ambiente que os próprios comentários do arquivo identificaram como o que
funciona. Corrigir o schema é trabalho de H1, não bloqueio.

> **O risco que o Dockerfile declarou se concretizou, desta vez a favor.** O comentário da linha 36
> registra: *"o `install.sh` não expõe pin — rebuild pode trazer versão diferente sem aviso"*. O
> build de hoje trouxe **v0.21.2 (2026.9.11)**, mais nova que a do spike de 08/09. Foi sorte, não
> desenho: a mesma mecânica poderia ter trazido uma versão que não sobe. **Fixar a versão é item de
> H1**, agora com evidência de que o drift é real e não teórico.

## 5. Achado que muda o planejamento: o Hermes traz canais e capacidades próprias

`hermes --help` lista subcomandos que o inventário X0 não previa:

| subcomando | relevância |
|---|---|
| **`whatsapp`, `whatsapp-cloud`** | integração **nativa** com WhatsApp Business Cloud API |
| `gateway` | *messaging gateway management* — o "gateway pessoal persistente" que a auditoria registrou como ausente |
| `slack`, `send`, `webhook`, `cron` | canais e disparo programado |
| `sessions`, `memory`, `memory-graph`, `learning`, `journey`, `checkpoints` | persistência e continuidade próprias |
| `approvals`, `security`, `egress`, `vault`, `secrets` | autorização e fronteira de credencial próprias |
| `kanban`, `project`, `worktree` | trabalho e isolamento por worktree |
| `homeassistant` (tool, ⚠ dep. não atendida) | o item "casa", adiado por decisão, existe como ferramenta |
| `computer-use`, `browser`, `browser-cdp` | navegador — relevante para C11 |

**Correção ao [PLANO-REFINADO §8](PLANO-REFINADO.md#8-fora-do-primeiro-marco-com-motivo):** a
avaliação *"X1 é construção do zero"* valia para o Rayzen isolado e **está incompleta**. O caminho
para WhatsApp pode passar por avaliar a integração nativa do Hermes em vez de construir um conector
no Rayzen.

Isso **não** promove X1 a pronto. Subcomando existir não é integração comprovada — é exatamente o
erro que este pacote existe para evitar, e `whatsapp-cloud` exige conta WhatsApp Business, número
verificado e provedor, que continuam não existindo. O que muda é o **caminho a investigar**, não o
estado.

Vale a mesma disciplina para `approvals` e `sessions`: descobrir que o Hermes tem aprovação própria
levanta a pergunta de **quem é a autoridade** — e a resposta já está em D05 do pacote e na
observação da auditoria sobre duas fontes decidindo o mesmo estado. Fato canônico de projeto
permanece no Rayzen.

## 6. Correção da dívida de configuração (13/09/2026)

"Funcionou apesar da dívida" não é estado aceitável: configuração cujo caminho declarado não é o
caminho usado é o modo de falha desta casa. Corrigido e validado em container descartável.

### 6.1 Schema da configuração: 0 → 44

`hermes config migrate` **não pode rodar no spike** — `config.yaml` é montado `:ro` por decisão de
desenho (o que o Hermes lê fica no repositório e é revisável). A migração rodou num container
descartável da mesma imagem, com o arquivo copiado para dentro, e o resultado voltou para
`infra/hermes/config.yaml`.

| antes (schema 0) | depois (schema 44) |
|---|---|
| `provider:` e `model:` na **raiz** — a forma que o `doctor` acusa como *stale* | bloco `model: { default, provider }` |
| — | `plugins.enabled: []` (opt-in desde o 44), `agent: {}`, `_config_version: 44` |
| `memory.write_approval`, `mcp_servers.rayzen` com as 9 ferramentas | **preservados integralmente** |

A ferramenta **não preserva comentários** — toda a documentação de decisão do arquivo (as medições
de 06/09 sobre `lmstudio`, `providers:` e a escolha do grupo de modelo) foi reescrita à mão por
cima do resultado, acrescida do que se aprendeu hoje.

`fallback_model:` ficou **deliberadamente vazio**, com o motivo no arquivo: o fallback já existe
uma camada abaixo, no LiteLLM, onde é sondado por invariante e visível no Langfuse. Um segundo
fallback aqui rotearia para fora desse rastro.

### 6.2 Versão fixada — e o pin provou o drift na hora

O comentário do `Dockerfile` afirmava que *"o `install.sh` não expõe pin"*. **Estava errado**: o
script aceita `--commit SHA`, conferido lendo o próprio instalador. Agora:

```dockerfile
ARG HERMES_COMMIT=422bc9bde9d212ab3741fbc45a871a3938436d59
RUN curl -fsSL .../install.sh | bash -s -- --commit "${HERMES_COMMIT}"
```

A saída da imagem pinada é a demonstração de que o risco era real, não teórico:

```
Hermes Agent v0.21.2 (2026.9.11) · upstream 5dea46d1 · local 422bc9bd
```

**`upstream` já tinha andado.** Sem o pin, este rebuild — feito no mesmo dia do anterior — teria
trazido outro commit.

### 6.3 Validação

| verificação | resultado |
|---|---|
| build com `--commit` | ✅ (a primeira tentativa falhou por **rede** — `RPC failed; curl 56` no clone, com 33% de perda de pacotes medida no ping; não pela flag) |
| pin efetivo | ✅ `git rev-parse HEAD` = `422bc9bd...` |
| `hermes config check` | ✅ `Config version: 44 ✓`, `LM_API_KEY` ✓, `LM_BASE_URL` ✓ |
| issue *stale root-level provider/base_url* | ✅ desapareceu |
| `hermes mcp list` | ✅ `rayzen \| 9 selected \| ✓ enabled` |
| conversa de regressão | ✅ respondeu `building` **e** o foco atual do ProjectState |

Containers e imagem de teste removidos; `/tmp/hermes-cfg-test` apagado. Disco do servidor em 68%.

### 6.4 Aplicado no spike real — 13/09, 19:22 UTC

Commitado e enviado a `main` (`da9ec25`); o deploy automático levou os arquivos ao servidor, e o
Hermes foi recriado **à parte**, porque o compose dele é separado e não entra na lista do webhook
(`web api api-v2 agent-server`). Conferido `ps aux | grep rayzen-deploy.sh` antes de subir.

| verificação no container em execução | resultado |
|---|---|
| pin efetivo | ✅ `git rev-parse HEAD` = `422bc9bd...` |
| `hermes config check` | ✅ `Config version: 44 ✓`, `LM_API_KEY` ✓, `LM_BASE_URL` ✓ |
| issues do `doctor` | **5 → 3**; sumiram *"migrate config"* e *"stale root-level provider/base_url"*. As 3 restantes são vulnerabilidades npm de `agent-browser`/`web workspace` e chaves opcionais — ferramentas fora do piloto |
| `hermes mcp list` | ✅ `rayzen \| 9 selected \| ✓ enabled` |
| conversa de regressão | ✅ devolveu o stage **e** o objetivo atual, idênticos ao que o hook injeta |
| log do `mcp-http` | ✅ 8 acessos nomeados `hermes` |

> **O pin se justificou três vezes no mesmo dia.** O campo `upstream` reportado pelo binário foi
> `422bc9bd` no primeiro build, `5dea46d1` duas horas depois e `b9271bcb` no rebuild final —
> enquanto `local` permaneceu em `422bc9bd` nos dois últimos. Três versões diferentes teriam
> entrado em produção num intervalo de horas, e a primeira delas já trouxe um schema de
> configuração incompatível que não acusou nada em runtime.

## 7. Próximo passo

Os itens 2 e 3 do H1 original (**fixar a versão**, **migrar o schema**) foram feitos em §6. Resta:

1. **Aplicar no spike em execução** — os arquivos corrigidos estão no repositório local, sem
   commit. O container ainda roda a imagem sem pin e o config schema 0.
2. **Conferir o que sobrevive à recriação.** O volume monta **apenas** `~/.hermes/memories`; a
   documentação upstream situa sessões em `state.db` **fora** desse diretório. Agora dá para
   verificar empiricamente com `hermes sessions`, em vez de inferir do compose.
3. Só então C08 (retomada após restart) e C09 (contexto correto, sem misturar projetos).

R1 está fechado — ver [R1-RESULTADO.md](R1-RESULTADO.md).
