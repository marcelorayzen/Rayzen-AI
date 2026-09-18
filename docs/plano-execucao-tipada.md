# Plano — eliminar a execução baseada em texto

> **Prioridade crítica**, declarada em 2026-09-07. Pré-requisito para ampliar a autonomia do
> Hermes — ver `RESEARCH/hermes.md`.
>
> **Autorizado para execução: Fase 0 e Fase 7, só**, na aprovação original de 07/09. Desde então,
> aprovadas e entregues em sessão contínua com o usuário, fase a fase: **Fase 1** (11/09),
> **Fase 2** (11/09, primeiro lote), **Fase 3** (11/09), **Fase 4** (11/09), **Fase 5** (11/09,
> parcial — ver a seção dela), **Fase 6** (11/09, escopo reduzido a `run_command` — ver a seção
> dela), **Fase 7** (11/09, 7/8 fechados, 1 parcial), **Fase 8** (11/09, token MCP por
> consumidor). **Plano original completo** — o que resta são itens adiados dentro de cada
> fase, declarados sem data (ver o fechamento na seção da Fase 8).

---

## Decisões obrigatórias (2026-09-07)

Condições impostas na aprovação. Elas **mudam o plano original**, não o comentam.

| # | decisão | onde entra |
|---|---|---|
| 1 | **✅ ENTREGUE 08/09** — `run_command` vira **RED agora** — aprovação humana obrigatória, indisponível para o Hermes e para origens externas. **Não espera a Fase 5.** | nova **Fase 5-A**, imediata |
| 2 | A contenção atual e seus 13 testes **permanecem** até a substituição completa | Fase 5, critério de saída |
| 3 | **✅ ENTREGUE 08/09** — `clipboard_write` e `notify` **não podem interpolar payload em PowerShell** — helper fixo, payload por **stdin** ou outro canal de dados | nova **Fase 1-A** |
| 4 | **✅ 15 payloads × 2 ações** — testes adversariais: aspas, `;`, pipeline, substituição, quebra de linha, **Unicode**, payloads PowerShell | Fase 7 e Fase 1-A |
| 5 | `supervised-session` **não** usa `env: {...process.env}` — allowlist mínima | **✅ Fase 4, entregue 08/09** |
| 6 | **⏳ parcial 08/09** — limpeza de env não é isolamento: planejar usuário/perfil dedicado, workspace restrito, tokens temporários de escopo mínimo | nova **Fase 4-B** |
| 7 | `WindowsExecutionAdapter` com estratégia **explícita por capability** | Fase 1 |
| 8 | **Proibido** `shell: true` como fallback genérico para `pnpm`, `npx`, `code`, `.cmd`, `.bat` | Fase 1, com teste anti-drift |
| 9 | Preferir executável real · entrypoint JS chamado por `node.exe` · helper fixo · tarefa agendada pré-cadastrada | Fase 1 |
| 10 | **✅ 22/22 em 08/09** — testes no **Windows real** | `scripts/validar-fase-1a-windows.mjs` |
| 11 | **Rollback de segurança falha fechado**: desabilita a capability, **nunca** restaura o executor vulnerável | seção *Rollback global*, reescrita |
| 12 | Token exposto em teste real é **rotacionado** | **✅ rotacionado 08/09** — seção *Exposição de segredos* |

> **A decisão 11 inverte o rollback do plano original.** Ele dizia "rebaixar `red` para `high`
> restaura o comportamento atual" — isso é restaurar o executor vulnerável, e está **revogado**.
> Rollback de correção de segurança desliga a capacidade e deixa o trabalho manual; nunca reabre a
> porta. O custo é indisponibilidade, que é o lado certo para errar.

---

## Exposição de segredos nesta investigação — decisão 12

**Dois segredos foram impressos em claro no transcript da sessão, por erro meu**, em 2026-09-07,
ao checar se as variáveis estavam definidas dentro do container do Hermes:

```sh
echo "LM_API_KEY vazio? [${LM_API_KEY:+nao}${LM_API_KEY:-SIM}]"
```

`${VAR:+nao}` devolve `nao` quando definida — e `${VAR:-SIM}` devolve **o valor**. A intenção era
imprimir só "nao"; a expansão imprimiu o segredo colado nele.

| segredo | exposto | onde |
|---|---|---|
| `LITELLM_MASTER_KEY` | **sim** | transcript da sessão (`.jsonl` local) |
| `MCP_READONLY_TOKEN` | **sim** | idem |
| `AGENT_TOKEN` | **não** | usado só como `$TOKEN` em shell remoto, nunca ecoado |

**Contenção verificada, não presumida:** `documents`, `events` e `conversation_messages` têm
**zero** ocorrências dos dois valores — o filtro de sinal do hook (que troca o `command` do Bash
pelo `description` e não indexa saída) segurou. Não há vazamento no Brain nem no repositório.

**Nenhum payload adversarial foi executado.** Provado com `child_process.execSync` mockado para
lançar se chamado: os 6 payloads de encadeamento e os 2 de interpretador passam pelos testes sem
uma única chamada. Os testes usam `dryRun` ou param no gate de risco `high`.

**Rotação: preparada, não executada** — derruba serviço em uso e é decisão sua.

```bash
# 1. LITELLM_MASTER_KEY — consumido por api, api-v2, hermes e pelas sondas
#    Trocar no .env E na lista `environment:` de CADA serviço no compose
#    (o litellm declara variável a variável, não usa env_file)
# 2. MCP_READONLY_TOKEN — consumido por mcp-http e pelo container do Hermes
# 3. Recriar SEM --deps, e o mcp-http e o litellm ficam FORA do webhook:
#      docker compose up -d --build --no-deps litellm mcp-http api api-v2
# 4. Conferir imagem × container depois — `ps` não serve
```

> Quando a **Fase 8** existir (token MCP por consumidor), esta rotação fica barata: revoga-se um
> consumidor sem derrubar os outros. Hoje é tudo ou nada — o que é, por si, argumento para a fase.

---

## Correlato: restauração de sessão do Hermes — issue separada

O `provider` "não honrado" de 06/09 **não era bug do Hermes** (ver `RESEARCH/hermes.md`): era
estado persistido no `state.db` com o modelo na forma colada `lmstudio/gpt-4o-mini-gemini`, servido
por um processo de 24 h. Fica como **issue própria**, fora deste plano:

- validar `provider`/`model` **ao restaurar** sessão, não só ao criar
- registrar a **origem efetiva** da configuração (arquivo, env, flag, estado persistido)
- identificar no `status` **qual processo, qual config e qual imagem** estão em execução

É a mesma família de `dist/` congelado e container mais velho que a imagem: **superfície saudável,
estado de antes**.

---

## Por que a contenção de 07/09 não encerra o assunto

O conserto que já está no ar (`6b0c88c`) recusa metacaracteres de encadeamento e sobe
interpretadores para `high`. Ele **fica**, com os testes de regressão que já existem
(`encadeamento-de-comando.spec.ts`, 13 casos).

Mas ele é contenção, não solução, e a razão é a mesma que o [arXiv 2603.27517](https://arxiv.org/abs/2603.27517)
dá para o OpenClaw: **enquanto a autorização olhar para uma string, a decisão depende de prever
como um shell vai interpretá-la.** Cada bypass encontrado gera mais uma regra; a premissa não muda.
O paper enumera três variantes (continuação de linha, multiplexador, abreviação de opção longa) e
nós encontramos uma quarta (sufixo após prefixo autorizado). Não há motivo para acreditar que a
lista acabou.

A saída é tirar a string do caminho: **o que se autoriza passa a ser uma capacidade tipada com
argumentos validados, e o que se executa é um programa com `shell: false`.** Aí não existe
"interpretação" para prever.

---

## Fase 0 — Inventário (parcialmente executado em 07/09)

### O que já foi medido

**26 pontos de execução no agent.** Os que interpolam valor vindo de payload:

| arquivo | forma | veredito |
|---|---|---|
| `actions/terminal.ts` | `execSync(command)` — comando livre | **o alvo principal** |
| `actions/clipboard.ts:14` | `Set-Clipboard -Value '${text}'` | **injetável pela aspa DUPLA** — ver correção abaixo |
| `actions/notify.ts:18` | `-Command "${script}"` com `${title}`/`${message}` | **injetável** — sanitizador só troca `"` por `'` |
| `actions/docker.ts:20,28,36` | `docker start ${name}` | **seguro** — allowlist `[^a-zA-Z0-9_\-]` + `tail` clampado |
| `actions/create-project-folder.ts:847,917` | `git commit -m "… ${name}"` | a verificar |
| `actions/open-vscode.ts:22` · `create-project-folder.ts:859,884,885` | `code "${path}"` / `rd /s /q "${path}"` | path-guarded — a verificar se o guard cobre aspas |
| `actions/outlook*.ts`, `screenshot.ts` | `-Command "${script}"` | a verificar a origem do `script` |
| `actions/supervised-session.ts:245` | `env: { ...process.env }` | **vaza `AGENT_TOKEN` para o processo-filho** |

Prova, montada **sem executar nada** (só a construção da string):

```
notify, payload  $(Write-Output PWNED)
  → sobrevive ao sanitizador (ele só troca " por ') e cai dentro de string
    de aspas duplas do PowerShell, onde $( ) é subexpressão
```

> **Correção de 08/09 — a prova do `clipboard_write` estava errada.** Eu demonstrei com um
> payload de aspa **simples**, mas o código já dobrava `'` (`replace(/'/g, "''")`), e dentro de
> string de aspas simples do PowerShell isso é o escape correto: aquele payload **não injetava**.
>
> O vetor real é a aspa **dupla**, que fecha o `-Command` do lado de fora:
>
> ```
> payload  x"; Write-Output PWNED; "
>   → powershell -NoProfile -Command "Set-Clipboard -Value 'x"; Write-Output PWNED; "'"
> ```
>
> A conclusão sobrevive e fica mais forte: o escape cuidava do delimitador **de dentro** e
> ignorava o **de fora**. Há mais de uma camada de citação, e acertar todas exige prever o
> parser — que é a premissa que o paper mostra falhando. Mas a prova anterior não sustentava a
> conclusão, e isso precisa constar.

> **`docker.ts` é o contraexemplo e vale como referência do alvo**: allowlist de caracteres no
> nome, número clampado, nenhum texto livre. É o que as capabilities tipadas devem ser.

### O que falta inventariar

- `hooks/*.mjs` (5 `execSync`), `repo-slug.mjs` (3), `mcp/*.mjs` (3) — rodam **do `src`**, sem build
- V1 e V2: qualquer `exec`/`spawn` fora do agent (a varredura de 07/09 cobriu só `apps/agent`)
- Origem real do `script` em `outlook*`, `screenshot`, `graphify-sync`

**Entregável:** `scripts/scan-exec-paths.mjs` + `docs/exec-paths.md` gerado, no molde de
`pnpm gen:catalog` e `pnpm scan:secrets`. **Com teste anti-drift**: ponto de execução novo que não
esteja declarado quebra a suíte. Sem isso o inventário envelhece como toda tabela mantida à mão —
é a mesma lição de `whitelist.ts` ↔ `ExecutionService`.

**Risco:** nenhum, é somente leitura. **Rollback:** apagar dois arquivos.

---

## Fase 1 — `executarPrograma()`: um único ponto, `shell: false` — ✅ ENTREGUE 2026-09-11

Substituir os 26 pontos por um helper:

```ts
executarPrograma(programa: string, args: string[], opts: { cwd: WorkdirResolvido; env: EnvExplicito; timeoutMs: number })
```

- `execFile`/`spawn` com **`shell: false`** — argumentos vão como vetor, o SO não reinterpreta
- **sem `cwd` string livre** (Fase 3) e **sem `env` herdado** (Fase 4)
- proíbe `programa` conter espaço, `/`, `\` ou metacaractere: nome de programa não é caminho

**Arquivos:** novo `apps/agent/src/exec/executar-programa.ts`; migração de `actions/*.ts` um a um.

### `WindowsExecutionAdapter` — estratégia explícita por capability (decisões 7, 8, 9)

No Windows, `execFile` **não** resolve `.cmd`/`.bat` como o shell resolve, e `pnpm`, `npx` e `code`
são `.cmd`. **`shell: true` está proibido como saída** — ele devolve exatamente o problema que este
plano existe para eliminar, e devolveria de forma pior, porque pareceria resolvido.

Cada capability **declara** sua estratégia; não há default nem heurística:

| estratégia | quando | exemplo |
|---|---|---|
| `executavel` | binário real no PATH | `git`, `docker`, `node` |
| `entrypointJs` | o `.cmd` é wrapper de um `.js` — chamar o `.js` **pelo `node.exe`** | `pnpm` → `pnpm.cjs` · `npx` → `npx-cli.js` |
| `helperFixo` | script nosso, versionado, sem interpolação | notificação, clipboard (Fase 1-A) |
| `tarefaAgendada` | tarefa pré-cadastrada, disparada por nome | operações que exigem sessão interativa |

`entrypointJs` é o que resolve `pnpm`/`npx` **sem shell**: o caminho do `.js` é resolvido uma vez na
subida (via `where` + `PATHEXT`, lendo o wrapper), guardado, e a partir daí é `node.exe <js> <args>`
com `shell: false`. Capability cuja estratégia não resolver **falha na subida**, alto — não em
runtime, silenciosa.

**Teste anti-drift:** um teste lê `executar-programa.ts` e falha se aparecer `shell: true` ou
`shell:` com valor que não seja `false`. Sem isso, a proibição vira comentário.

**Teste (decisão 10):** os casos dessas capabilities rodam **no Windows real** — é onde `.cmd`,
`PATHEXT` e o wrapper existem. Rodar só em Linux testaria um caminho que não é o de produção.
Marcados para pular fora de `win32`, com o *skip* **contado e reportado**, nunca silencioso.

**Teste:** cada ação migrada ganha um caso que passa um argumento com `;`, `&&`, aspas e espaço, e
exige que ele chegue **literal** ao programa (não interpretado). É a inversão exata do defeito.

### O que entrou em 2026-09-11

**O primitivo existe e está provado contra o Windows real**, com as duas estratégias que hoje
têm capability de verdade usando-as:

| entregue | onde |
|---|---|
| `executarPrograma(estrategia, programa, args, opts)`, `shell: false` sempre | `apps/agent/src/exec/executar-programa.ts` |
| `executavel` — spawn direto, argv como vetor | idem |
| `entrypointJs` — **lê o wrapper `.cmd` de verdade** (não presume `node_modules/corepack/dist/pnpm.js`), extrai o caminho do `.js`, chama por `process.execPath` — cacheado após a primeira resolução | idem |
| `ambientePadrao()` — piso de variáveis de sistema, allowlist fechada, nunca `process.env` espalhado | idem |
| anti-drift: fonte não pode conter `shell: true` nem `shell:` com valor que não seja `false` | `exec/__tests__/executar-programa.spec.ts` |
| adversariais contra o Windows real: `;` `&&` `\|` `\`whoami\`` `$(whoami)` quebra de linha aspas — todos chegam **literais** | idem, `decisão 10`, skip contado fora do `win32` |
| primeira migração: `docker.ts` (`dockerStart`/`dockerStop`/`dockerLogs`) — `execSync` de string montada → `executarPrograma('executavel', ...)` | `apps/agent/src/actions/docker.ts` |

**`helperFixo`** não foi reimplementado — delega para `rodarHelper()` de `exec/executar-helper.ts`
(Fase 1-A), que já cobre o caso com a forma certa (payload por stdin, não argv). Reimplementar
seria duplicar código já testado. **`tarefaAgendada`** está no tipo, sem implementação — nenhuma
capability a usa ainda, e recusar alto é melhor que fingir suporte.

**Dois defeitos que a própria bateria de testes encontrou, e o `resolverEntrypointJs` corrigido
com os dois em mente:**

- `where.exe` sai com **código 1** (não string vazia) quando não acha nada — sem `try/catch`, o
  erro que atravessa é o bruto do `execFileSync` ("Command failed…", na codepage do console), não
  a mensagem clara que o módulo promete.
- Medido nesta máquina: `pnpm` e `npx` resolvem para `.ps1` via `Get-Command` do PowerShell, mas
  `PATHEXT` **não declara `.ps1`** — `execFile`/`spawn` do Node nunca o alcançariam mesmo sem
  filtro. `where.exe` lista `.ps1` e o arquivo sem extensão (script POSIX, inútil aqui) junto com
  o `.cmd`; só o `.cmd`/`.bat` é o que uma invocação real usa.

**O que NÃO entrou, e por quê — a fronteira é o `runCommand`.** `actions/terminal.ts` continua
recebendo uma STRING de comando livre. Rotear isso por `executarPrograma()` exigiria um
tokenizador de shell (separar programa+argv de `'git commit -m "corrige a; b"'` com segurança) —
exatamente o "parser que precisa prever como um interpretador lê o texto" que este plano existe
para eliminar, só que uma camada acima. Esse caminho é a **Fase 2** (capability tipada, argv
montado por código nosso a partir de parâmetros validados, nunca por tokenização de string). O
teste `composicao-de-camadas.spec.ts` documenta isso explicitamente — o caso adversarial do
`runCommand` continua recusando, não passando literal, e só inverte quando a Fase 2 substituir o
despacho.

### Fechada em 2026-09-11 — os 14 pontos "montada" restantes, e um achado real

Continuação na mesma data: os 14 pontos que ficaram abertos (`create-project-folder.ts` 7,
`outlook-calendar.ts`/`outlook.ts`/`screenshot.ts`/`open-vscode.ts` 4, `repo-slug.mjs`/
`scan-secrets.mjs` 2, mais `supervised-session.ts:criarWorktree` 1) foram todos migrados.
**`docs/exec-paths.md` chegou a 0 pontos "montada" no monorepo inteiro.**

**`entrypointJs` precisou generalizar.** `code.cmd` (VS Code) não chama `node.exe` como
`pnpm`/`npx` — chama `Code.exe` (Electron) com `ELECTRON_RUN_AS_NODE=1`. Medido em 11/09 ao migrar
`create-project-folder.ts`/`open-vscode.ts`. `resolverEntrypointJs()` passou a devolver
`{ runner, js, envExtra }` em vez de só o caminho do `.js` — extrai o runner de dentro do wrapper
(`"%~dp0...exe"`) e qualquer `set VARNAME=valor` literal que ele declare, em vez de presumir
`node.exe` sempre. Testado contra o VS Code real: `code --version` via `Code.exe cli.js --version`.

**O achado mais sério da Fase 1 estava em `outlook.ts sendEmail`, nunca auditado pela Fase 0.**
O código gerava um `.ps1` por template com `$mail.To = "${to}"` — `to` é endereço de destinatário,
validado só com `.includes('@')`. Dentro de aspas DUPLAS do PowerShell, `$( )` é subexpressão: um
payload `to: 'x$(calc.exe)@evil.com'` produzia um script contendo literalmente
`.To = "x$(calc.exe)@evil.com"`, e o PowerShell **executaria `calc.exe` ao simplesmente atribuir a
propriedade** — antes de qualquer `.Send()`. `subject`/`body` usavam here-string (`@'...'@`), mais
resistente, mas quebrável por uma linha igual a `'@` no início. Provado por construção de string,
sem executar nada (mesmo método da Fase 0 para `clipboard_write`/`notify`).

Migrado para `helperFixo`: `scripts/outlook-send.ps1`, `outlook-read.ps1`, `outlook-calendar.ps1`,
`screenshot.ps1` — payload por stdin como JSON, `ConvertFrom-Json`, atribuição DIRETA à
propriedade do objeto COM (nunca dentro de string entre aspas). `outlook-calendar.ps1` foi além:
parou de receber datas do TypeScript — calcula com `Get-Date` internamente, então não há mais
valor externo nenhum para desconfiar além de um inteiro clampado.

`create-project-folder.ts`'s `rd /s /q` + `rm -rf` (removiam `.git` copiado) viraram uma chamada a
`fs.rm(path, {recursive:true, force:true})` — nenhum processo-filho, porque `rd`/`rm` nem são
executáveis de verdade no Windows (comandos internos do `cmd.exe`, fora do escopo de
`executarPrograma()`).

**35 testes adversariais novos** provam que os payloads do achado real (subexpressão, aspa dupla,
crase, here-string breakout) chegam literais e nada executa — incluindo um teste que reproduz o
padrão perigoso reintroduzido de propósito para confirmar que o source-scan pegaria de volta.

505 testes na V1 não foram afetados (Fase 1 é só `apps/agent`). **372 no agent** (era 294 antes
desta rodada). **1359 no monorepo.**

### Achado emergencial em 11/09 — `git.ts` inteiro nunca tinha sido migrado

Descoberto ao desenhar a Fase 2, não pela varredura da Fase 0: `docs/exec-paths.md` nunca viu
`apps/agent/src/actions/git.ts` como risco porque o scanner só olha a **mesma linha** da chamada
`execSync`. Aqui a interpolação acontecia numa template string montada pelo **chamador** e
passada como parâmetro para `safeExec(cmd, cwd)`, uma linha de distância — o mesmo ponto cego que
já tinha aparecido em `outlook.ts sendEmail`.

Três vetores confirmados **ao vivo** contra um repositório de teste isolado (`cmd.exe`, não
bash/PowerShell — é o shell que `execSync` invoca por padrão no Windows):

| função | campo | vetor | prova |
|---|---|---|---|
| `gitDiff` | `file` | sem sanitização, fecha a aspa com `"` e encadeia com `&` | `file: 'x.txt" & echo INJETADO & echo "'` imprimiu `INJETADO` de verdade |
| `gitPush` | `branch` | sem aspa NENHUMA — `&`/`\|` funcionam direto | mesma classe, mais simples ainda |
| `gitCommit` | `message` | `%VAR%` do `cmd.exe` expande DENTRO de aspas duplas | `message: 'fix: %SEGREDO%'` gravou o **valor real** no commit |

O terceiro é o mais grave: não é execução, é **exfiltração de segredo para o histórico do git**
— `%AGENT_TOKEN%` numa mensagem de commit grava o token em claro, permanente, e um `git push` na
sequência publica. `git.ts` nunca restringia `env` (herdava `process.env` inteiro), então
qualquer segredo do processo do agent era alcançável assim.

`shell: false` mata os três de uma vez — sem shell, não há `&` para separar comando nem `%VAR%`
para expandir. Isso **não** fecha sozinho um vetor diferente: injeção de **opção** (`branch:
'--upload-pack=/tmp/evil'` continua argv válido, só que o `git` o lê como flag, não como ref).
Por isso `--` antes de pathspec em `gitDiff`/`gitAdd` (convenção do próprio git) e
`rejeitarFlag()` para valores sem essa convenção (`gitPush`, `gitBranch`).

`git.ts` tinha **zero teste** antes desta migração — nenhum arquivo `git.spec.ts` existia. 12
testes novos, contra repositórios git reais e descartáveis, provam os três vetores fechados;
validados vermelho→verde revertendo o arquivo e confirmando 9 de 12 falhando contra o código
antigo.

### Varredura completa em 11/09 — os outros dois arquivos com o mesmo defeito

`git.ts` não era isolado. Uma varredura manual de todo `apps/agent/src/actions/*.ts` (28
arquivos, cruzando com quem tinha teste e quem tocava `child_process`) achou o MESMO padrão —
string montada num wrapper ou `switch`, invisível ao scanner — em mais dois arquivos:

| arquivo | ação | campo(s) | vetor |
|---|---|---|---|
| `prisma.ts` | `jarvis:prisma_generate`/`jarvis:prisma_migrate` | `schema` (payload cru), `mode` (sem validação de runtime) | fecha aspa com `"`, encadeia com `&` — mesma classe de `gitDiff` |
| `run-tests.ts` | `jarvis:run_tests` | `filter`/`collectionPath`/`environment`, em **6 dos 7 runners** | mesmo padrão, ação de uso diário disponível ao `desktop` |

`run-tests.ts` era o pior dos três: seis pontos de injeção (jest, vitest, playwright, pytest,
maven, gradle, newman), todos pela mesma forma.

**Migração exigiu resolver um problema que `git.ts`/`outlook.ts` não tinham: `npx.cmd` tem
lógica CONDICIONAL** (chama `node npm-prefix.js` e troca de `npx-cli.js` se achar um prefixo
alternativo) que `resolverEntrypointJs()` — desenhado para o padrão simples de `pnpm`/`code` —
não replica. Contra `prisma generate` de verdade, isso resolveu o `.js` ERRADO e devolveu um
caminho de `.npm-global` em vez de rodar o prisma, **sem erro, silenciosamente incorreto**.

A saída, para os dois arquivos: **resolver o pacote local via `require.resolve()`** (Node
entende a estrutura de symlinks do pnpm sozinho) em vez de passar pelo `npx`. Onde isso não dá
(`playwright`/`newman`, que ficam em `node_modules/.bin/*.cmd`), uma função generalizada
(`localBinCmd` + o mesmo parser de wrapper) anda para cima no diretório e resolve. Onde nem
isso serve (`mvn`/`gradle`, wrappers que invocam Java com classpath, sem forma simples de
extrair um `.js`), a saída é `cmd.exe /c <script> <argv...>` com os argumentos como ELEMENTOS
SEPARADOS — medido que o Node cota cada elemento ao montar a linha do Win32, então o `cmd.exe`
nunca vê metacaractere solto, mesmo invocando um `.bat` de forma totalmente opaca.

**`require.resolve` com `paths` explícito é confiável fora do Jest, não dentro dele** — medido
tentando testar "prisma não instalado": rodando puro (`node -e`), isola corretamente; dentro do
sandbox de `require` do Jest, sempre encontra o prisma do PRÓPRIO monorepo de teste,
independente do `paths` passado. Um teste que dependia disso foi trocado por cobertura de
forma, documentando a limitação em vez de fingir que não existe.

`playwright`/`newman`/`mvn`/`gradle` de verdade **não estão instalados neste monorepo** — mesma
honestidade que `RESEARCH/hermes.md` já pratica. O que foi provado sem eles: a técnica
`cmd.exe /c` com argv separado, ponta a ponta, através de um `gradlew.bat` de MENTIRA que ecoa
o que recebeu; e que a ausência do pacote falha limpo (mensagem clara), nunca com o valor
adversarial encadeado.

Dois achados menores, sem exploração ativa (valor vinha de env var do operador ou argv era
constante) mas migrados por consistência: `run-graphify.ts` tinha `shell: true` explícito +
`...process.env` espalhado; `restart-api.ts` interpolava `SERVER_API_CONTAINER`. Os 25 arquivos
restantes de `actions/*.ts` não tocam processo nenhum.

408 testes no agent (era 372). **1395 no monorepo.**

---

## Fase 1-A — `clipboard_write` e `notify` param de interpolar (decisões 3, 4) — ✅ ENTREGUE 08/09

Os dois montam PowerShell por template com valor de payload dentro, e os dois foram provados
injetáveis na Fase 0. **Não** ganham sanitizador melhor — sanitizador é a mesma aposta que falhou.

- **helper fixo versionado** (`.ps1` no repositório, sem interpolação nenhuma)
- payload viaja por **stdin** (ou arquivo temporário de escopo restrito), lido pelo script como
  **dado**, nunca como parte do comando
- o argv contém apenas o caminho do helper — que é constante

**Arquivos:** `apps/agent/scripts/clipboard-write.ps1`, `apps/agent/scripts/notify.ps1`;
`actions/clipboard.ts`, `actions/notify.ts`.

**Testes adversariais (decisão 4)** — cada payload deve chegar **literal** ao destino e nada deve
executar: aspas simples e duplas · `;` · `|` e pipeline · `$(...)` e `` `...` `` · `&&`/`||` ·
quebra de linha (`\n`, `\r`, e a continuação `\`+newline do paper) · **Unicode** (aspa curva
`“`, que o PowerShell 5.1 trata como delimitador — já nos custou um parser quebrado em 06/09) ·
payloads PowerShell (`$ExecutionContext`, `iex`, `Invoke-Expression`, `&{...}`).

**Risco:** o `.ps1` precisa estar acessível ao agent e sobreviver ao build. Mitigação: teste que
falha se o arquivo não existir no caminho esperado.

**Rollback:** falha fechado — capability desabilitada, sem restaurar a versão que interpola.

**Rollback:** o helper é aditivo; cada ação migra em commit próprio e volta sozinha.

---

## Fase 2 — Capabilities tipadas no lugar de comandos — ✅ ENTREGUE 2026-09-11 (primeiro lote)

Hoje `ALLOW_RULES` é uma lista de **regex sobre texto**. Passa a ser uma lista de **capacidades**:

```ts
{ id: 'git.status', programa: 'git', argv: () => ['status', '--porcelain'],
  params: {}, risco: 'none', requerAprovacao: false }

{ id: 'pnpm.test', programa: 'pnpm', argv: (p) => ['--filter', p.pacote, 'test'],
  params: { pacote: { tipo: 'enum', valores: PACOTES_DO_MONOREPO } }, risco: 'medium' }
```

O chamador manda `{ capability: 'pnpm.test', params: { pacote: 'api' } }` — **nunca uma linha de
comando**. O argv é montado por código nosso, a partir de valores validados.

**Sem `zod` no agent** (não é dependência hoje): validador próprio, pequeno, com os tipos que
realmente aparecem — `enum`, `inteiro(min,max)`, `slug`, `projectId`. Adicionar uma dependência de
runtime para isso é troca ruim num processo que já roda com o token da casa.

**Arquivos:** novo `apps/agent/src/exec/capabilities.const.ts` + `validador.ts`;
`actions/terminal.ts` passa a despachar por capability; `security/whitelist.ts` e
`role-policy.ts` ganham as novas entradas; `docs/agent-actions.md` regenerado.

**Risco:** cobertura incompleta — uma capability que falta vira trabalho manual até alguém
declará-la. **Aceito de propósito**: é a diferença entre "não consigo agora" e "executei o que não
devia". A migração começa pelas capacidades com uso medido em `agent_audit_logs`, não pelas
imaginadas.

**Teste:** para cada capability, um caso de parâmetro inválido (rejeita) e um de argv esperado
(compara o vetor, não a string).

**Rollback:** capability nova é aditiva; o `run_command` genérico continua existindo até a Fase 6.

### O que entrou em 2026-09-11

**Decisões de arquitetura, confirmadas antes de escrever código** (a diferença entre elas
mudava o resultado, por isso foram perguntadas em vez de assumidas):

| decisão | escolha |
|---|---|
| onde o despacho tipado entra | payload alternativo da MESMA ação `jarvis:run_command` (`{capability, params}` em vez de `{command}`) — sem ação nova em `ALLOWED_ACTIONS` |
| escopo de capability | POR ROLE desde o início — `CAPABILITY_ROLES` em `role-policy.ts`, mesmo padrão AND de `isActionAllowedForRole` |
| primeiro lote | só as `risk: 'none'` do `ALLOW_RULES` antigo |

**O critério de priorização mudou antes de escolher o lote.** `agent_audit_logs` está morto
há 3 meses — `jarvis:run_command` foi invocado 25 vezes, todas numa única semana de junho, e
nunca mais desde então (10 `docker compose up -d`, 9 `curl` de depuração com `dev-token`
hardcoded). Não há uso real para ranquear por frequência. O critério que sobra: começar pelo
mais seguro para validar o mecanismo, não pelo mais usado.

**Metade das `risk: 'none'` antigas era ficção nesta máquina.** Medido com `Get-Command` (a
mesma resolução de PATH que `executarPrograma` usa): `grep`, `wc`, `env`, `printenv` **não
existem** aqui, e `find` resolve para `C:\Windows\system32\find.exe` — que busca TEXTO dentro
de arquivo, o oposto do `find` do Unix que a regra original presumia. A família `fs-read`/
`shell-read` do `ALLOW_RULES` sempre falhava com "não reconhecido" nesta máquina — capability
para isso seria a mesma imaginação que o plano pede para evitar, travestida de tipo.
`git-read` também ficou de fora, por ser REDUNDANTE com as ações tipadas já migradas na Fase 1
(`jarvis:git_status`/`git_log`/`git_diff`/`git_branch`).

**O que sobrou, medido e real:** `docker.exe` existe. Seis capabilities, todas `risk: 'none'`,
cobrindo o que `jarvis:docker_ps`/`docker_logs` (Fase 1) não cobrem — `images`, `stats`,
`inspect`, `compose ps/logs/config`:

```
docker.images · docker.stats · docker.inspect
docker.compose_ps · docker.compose_logs · docker.compose_config
```

**Entregue:** `exec/validador.ts` (6 tipos: `enum`, `inteiro`, `slug`, `projectId`,
`caminhoSeguro`, `textoCurto` — os dois últimos entraram porque as capabilities reais
precisaram, nunca antecipados) · `exec/capabilities.const.ts` · `actions/terminal.ts` com o
novo branch de despacho · `security/whitelist.ts` (`ALLOWED_CAPABILITIES`) ·
`role-policy.ts` (`isCapabilityAllowedForRole`).

**A LACUNA de `composicao-de-camadas.spec.ts` fecha pela metade.** O teste que documentava
"argumento com metacaractere só pode ser recusado, não passado" ganhou um par: o despacho por
capability entrega literal (`docker.inspect` com `container: 'x; rm -rf /'` é recusado pelo
VALIDADOR, nunca chega a virar argv) — mas o `{command}` de texto livre continua existindo e
continua recusando, sem inverter. A outra metade (texto livre deixar de existir) é Fase 6.

**Achado ao escrever o teste real contra `docker.exe`:** o binário existe nesta máquina, mas
o DAEMON não está rodando — os containers deste projeto vivem no servidor H81, por SSH, não
localmente. `docker.images` chegou ao `docker.exe` de verdade e recebeu
`"failed to connect to the docker API — dockerDesktopLinuxEngine"`, uma resposta real do
programa, não uma falha da migração. Os testes aceitam os dois estados (daemon de pé ou não)
e são explícitos sobre qual mediram — não fingem que só um deles é possível.

**58 testes novos** (26 validador + 20 capabilities + 9 despacho em terminal.ts + 3 de
composição). **466 no agent** (era 408). **1453 no monorepo.**

---

## Fase 3 — `workdir` por `project_id`, nunca por caminho livre — ✅ ENTREGUE 2026-09-11

Hoje `payload.path` é resolvido e checado contra `SAFE_ROOTS` (`path-guard`). Funciona, mas o
contrato ainda é "me diga um caminho".

Passa a ser: o chamador manda **`projectId`**, e o agent resolve o diretório num **registro local**
(`projectId → caminho`), preenchido a partir do `repoSlug` já cadastrado. Caminho que não estiver no
registro não existe para o executor.

**Arquivos:** novo `apps/agent/src/exec/workdir.ts`; `utils/path-guard.ts` continua como segunda
barreira (não substituído — ver Fase 7); `actions/*` que aceitam `path`.

**Risco:** trabalho fora de projeto registrado deixa de funcionar. Isso **já é** o que o invariante
`registro_sem_projeto` acusa hoje, então o plano alinha executor e telemetria em vez de criar um
caso novo.

**Teste:** `projectId` desconhecido → recusa; caminho livre no payload → **ignorado**, não
"validado"; travessia (`../`) irrelevante por construção.

**Rollback:** flag de ambiente que reativa o caminho livre por uma versão, com log alto.

### O que entrou em 2026-09-11

**Decisões de arquitetura, confirmadas antes de escrever código:**

| decisão | escolha |
|---|---|
| onde `projectId` entra | só no despacho por CAPABILITY (`terminal.ts`'s `runCapability()`) — `path` livre continua existindo nas ações legadas, migração incremental |
| duplicar ou importar a resolução de `repoSlug` | **duplicar**, com teste anti-drift — `.ts` CommonJS não `require()` `.mjs` ESM de forma síncrona (mesma família de `event-derived-text.const.ts`/`memory-ranking.const.ts`) |
| onde procurar o checkout local | `RAIZES_DE_PROJETO` (`~/Projects` + `AGENT_PROJECT_ROOT`), não `SAFE_ROOTS` inteiro — `SAFE_ROOTS` inclui Downloads/Documents/Desktop, lugares seguros para ESCREVER, não onde projeto costuma estar |
| TTL do registro | 1h, arquivo em `tmpdir()` — projeto não muda de pasta com frequência, e cache errado nunca é pior que "não achou": só acelera uma resolução que a rede confirmaria de qualquer forma |

**Por que a duplicação é segura aqui.** `repo-slug.mjs` é a fonte única para hook/context-hook/MCP
(ver `CLAUDE.md`), mas os três são ESM sem build. `workdir.ts` compila como parte do agent
(`"module": "CommonJS"`). Em vez de reescrever a cadeia de import ou introduzir `import()`
dinâmico dentro de um caminho síncrono, `workdir.ts` duplica as três funções pequenas
(`paraSlug`, `nomeDoRepositorio`, `candidatosDeSlug`) e o teste (`workdir.spec.ts`) roda o
`.mjs` REAL num subprocesso Node contra um repositório git temporário, comparando o resultado
com o que `resolverWorkdir` encontra — anti-drift **comportamental**, não textual: se a cópia
divergir da original, o sintoma é "não achou o diretório", não uma comparação de string de
função que poderia ficar desatualizada sem ninguém notar.

**Validado com o caso que já quebrou a casa antes.** `Rayzen-PDV` tem maiúsculas literais no
`repoSlug` — slugificar sempre já quebrou esse projeto uma vez (ver `CLAUDE.md`, "Devolve duas
grafias em ordem"). O teste cobre exatamente esse nome, e foi confirmado vermelho de propósito:
quebrando `candidatosDeSlug` para perder a grafia crua, só esse caso (1 de 8) falhou — prova de
que o teste pega o defeito específico que ele afirma pegar.

**Entregue:** `exec/workdir.ts` (`resolverWorkdir(projectId): Promise<string | null>` — única
função exportada, nunca lança) · `exec/__tests__/workdir.spec.ts` (8 testes) ·
`actions/terminal.ts` — `runCapability()` aceita `projectId`, resolve via `resolverWorkdir()` e
usa como `cwd`; `projectId` tem prioridade sobre `path` quando os dois vêm no payload; sem
`projectId`, comportamento por `path` livre inalterado (compatibilidade) ·
`terminal-capability-fase3-workdir.spec.ts` (4 testes, com `resolverWorkdir` mockado — testa o
CONTRATO de integração, não a resolução em si) · caso 2 da lista de Fase 7 fechado em
`composicao-de-camadas.spec.ts` ("capability válida + `projectId` que não resolve → recusada,
nunca cai para `process.cwd()`").

**Falha fechada por construção.** `resolverWorkdir` nunca lança e nunca inventa um caminho:
sem `AGENT_TOKEN`, API inalcançável, projeto sem `repoSlug` cadastrado ou `repoSlug` sem
checkout local — todos os casos devolvem `null`, e `runCapability()` transforma `null` em
recusa (`"Projeto \"X\" não tem checkout local conhecido nesta máquina."`), nunca em fallback
para `process.cwd()` ou para um `path` residual do payload.

**Deliberadamente fora do escopo desta entrega:** migrar as ações legadas de `path` para
`projectId` (só o despacho por capability adotou) e a Fase 5/6 (aposentar o `{command}` de
texto livre) continuam como estavam.

**13 testes novos** (8 em `workdir.spec.ts`, incluindo 2 de source-scan contra o próprio
código-fonte + 4 de integração em `terminal.ts` + 1 de composição). **479 no agent** (era 466).
**1466 no monorepo.**

---

## Fase 4 — processo-filho não herda segredo — ✅ ENTREGUE 2026-09-11

`supervised-session.ts:245` fazia `env: { ...process.env }`. O `AGENT_TOKEN`, o
`LITELLM_MASTER_KEY` e o `MCP_READONLY_TOKEN` iam junto para a sessão do Claude Code — que roda
código de terceiros por definição.

Passa a `env` **explícito**: `PATH`, `HOME`/`USERPROFILE`, `SystemRoot`, `TEMP`, mais o que a
capability declarar. Segredo entra só onde é necessário e declarado.

**Arquivos:** `exec/executar-programa.ts` (default), `actions/supervised-session.ts`,
`actions/run-tests.ts`, `actions/prisma.ts`, `actions/run-graphify.ts`.

**Risco:** ferramenta que dependia silenciosamente de uma variável quebra. É o objetivo — mas o
sintoma pode ser obscuro. Mitigação: durante uma versão, logar (sem valor) toda variável que o filho
tentou ler e não achou. Sem telemetria, isso vira caça a fantasma.

**Teste:** spawn de um programa que imprime `process.env`, e a asserção é que `AGENT_TOKEN`
**não** está lá. Falha se alguém reintroduzir o spread.

**Rollback:** falha fechado — a capability que dependia do segredo é desabilitada até declarar
explicitamente do que precisa. Nunca reintroduzir o spread.

### O que entrou em 2026-09-11

**A fase estava substancialmente entregue como EFEITO da Fase 1, não construída do zero
aqui.** `OpcoesDeExecucao` (`exec/executar-programa.ts`) declara `env` como campo
**obrigatório**, sem default para `process.env` — quem chama `executarPrograma()` é forçado a
decidir o ambiente, e todo caminho migrado (`git.ts`, `docker.ts`, `prisma.ts`,
`run-tests.ts`, `run-graphify.ts`, `restart-api.ts`, `create-project-folder.ts`,
`open-vscode.ts`, `supervised-session.ts`, `actions/terminal.ts`) já passa `ambientePadrao()` —
uma allowlist fechada (`PATH`, `SystemRoot`, `SystemDrive`, `windir`, `COMSPEC`, `PATHEXT`,
`TEMP`, `TMP`, `USERPROFILE`) em vez de espalhar `process.env`. Confirmado por varredura:
**zero** ocorrência viva de `...process.env` em código de `apps/agent/src` fora de comentário —
as únicas 4 são texto explicando por que o padrão foi abandonado.

**O que faltava para fechar formalmente:** o teste PONTA A PONTA que o próprio plano pede —
"spawn de um programa que imprime `process.env`, e a asserção é que `AGENT_TOKEN` não está
lá" — nunca tinha sido escrito contra um `spawn` REAL. O teste unitário existente
(`ambientePadrao — piso, não teto`) prova a função isolada com uma `fonte` sintética; não prova
que o caminho inteiro (`executarPrograma` → `ambientePadrao()` → `spawn`) se comporta assim
com um segredo de verdade no `process.env` do processo de teste — a condição real de produção.

**Entregue:** dois testes novos em `executar-programa.spec.ts` — um popula `AGENT_TOKEN`,
`LITELLM_MASTER_KEY` e `MCP_READONLY_TOKEN` no `process.env` real, spawna `node -e` de verdade
via `executarPrograma()` com `ambientePadrao()`, e confirma que os três **não** aparecem no
`process.env` do filho (com `PATH` presente, provando que o piso da Fase 1 continua passando —
uma ausência sozinha provaria pouco). O segundo teste é a prova de que o primeiro pega
regressão: chama o mesmo `executarPrograma()` mas com `env: { ...process.env }` no lugar de
`ambientePadrao()` — a forma exata do defeito que existia em `supervised-session.ts` até
08/09 — e confirma que o segredo **vaza** nesse caminho, provando que o teste positivo não
passaria verde por acidente.

**2 testes novos. 481 no agent** (era 479). **1468 no monorepo** (era 1466).

---

## Fase 4-B — isolamento de verdade da sessão supervisionada (decisão 6) — ✅ ENTREGUE 2026-09-11

**Limpeza de `env` não é isolamento.** Ela impede o filho de *ler* o segredo; não impede nada do
resto — o processo continua rodando como o dono, com acesso ao disco inteiro, à rede e às
credenciais que existem em arquivo (`.env`, `~/.ssh`, `hook.config.mjs`).

**Feito em 08/09, e é redução de superfície — não isolamento:** a negação passou a incluir os
caminhos onde o segredo mora em **arquivo** — `Read(**/.env)`, `**/*.pem`, `**/id_ed25519*`,
`hook.config.mjs`, `.ssh/`, `.aws/`, `.claude/` — mais `Bash(cat:*)`, `type` e `more`, porque ler
por outro caminho é o mesmo que ler. Isso fecha o par com a allowlist de ambiente, que só cobria a
variável.

**Credenciais indispensáveis: nenhuma** (`CREDENCIAIS_INDISPENSAVEIS`, lista vazia com teste). O
CLI do Claude autentica por `~/.claude`, alcançado via `HOME`/`USERPROFILE`; a sessão não fala com
a API do Rayzen (quem reporta é o processo pai) nem com o LiteLLM. Se alguma passar a ser
indispensável, entra **nomeada**, e a sessão fica desabilitada até a decisão.

### O que falta para ser isolamento de verdade — proposta

| camada | proposta | por que não foi feito agora |
|---|---|---|
| **usuário** | conta local dedicada (`rayzen-sessao`), sem privilégio, fora do grupo Administradores | criar conta exige elevação; é decisão sua |
| **perfil** | `HOME`/`USERPROFILE` próprios, com `~/.claude` **exclusivo** da sessão | hoje a sessão usa o perfil do dono — é como ela autentica |
| **workspace** | a worktree da Fase 3 e só ela; ACL negando o resto do disco à conta dedicada | depende da conta existir |
| **credencial** | token efêmero por execução, escopo mínimo, minutos de validade | depende da Fase 8 (token por consumidor) |

> **O ponto que decide a fase:** a sessão precisa do `~/.claude` do dono para autenticar com a
> Anthropic. Uma conta dedicada exige **login próprio do Claude Code** nela — ou o isolamento
> quebra a sessão. Isso é decisão de produto, não detalhe técnico.
>
> As quatro opções estão comparadas em
> [`decisions/supervised-session-auth-options.md`](decisions/supervised-session-auth-options.md),
> **aguardando decisão**. Nenhuma conta foi criada, nenhum `~/.claude` copiado, nenhuma sessão
> movida.
>
> O que decide entre "mesma conta Claude" e "conta separada" é se a assinatura permite duas
> contas de SO logadas ao mesmo tempo — **termo de uso, a confirmar com a Anthropic**, não algo
> que se deduza. E há uma contradição a evitar: com `ANTHROPIC_API_KEY` presente, o modo `-p`
> **ignora a assinatura**, então API key + assinatura junto significa pagar as duas e usar uma.

**Risco:** é a fase mais cara e a que mais atrita com o uso diário. Fica declarada e sem data —
declarar sem fazer é honesto; **fazer a limpeza de env e chamar de isolamento não é.**

### Entregue em 2026-09-11 — as quatro camadas, três fechadas

A fase saiu **fora da ordem** do plano (era a última) porque os pré-requisitos dela foram
construídos antes, entre 08 e 09/09: a conta existe, o isolamento de arquivo fechou 12/12, e o
risco dominante — se a assinatura permite duas contas de SO ao mesmo tempo — foi medido e **não
se materializou**.

| camada | estado |
|---|---|
| **usuário** | ✅ `RayzenExec`, fora de `Administradores` |
| **perfil** | ✅ `~/.claude` próprio, criado por login interativo da conta. Nada copiado |
| **workspace** | ✅ clone próprio em `C:\RayzenExec\workspaces`, semeado por `git bundle`, reposto na base do dono a cada sessão |
| **credencial** | ⬜ continua dependendo da Fase 8 (token por consumidor). A sessão não recebe nenhuma — `CREDENCIAIS_INDISPENSAVEIS` segue vazia |

Ligado por `AGENT_SESSAO_ISOLADA=true`; o padrão é o regime local. Com o modo ligado e a conta
indisponível a sessão **para** — sem queda para o usuário do dono, que seria desfazer o
isolamento exatamente quando ninguém está olhando.

O registro completo, com o que foi medido antes de implementar e os três defeitos que a medição
encontrou, está em [`decisions/rayzenexec-preparacao.md`](decisions/rayzenexec-preparacao.md).
Dois pontos que interessam a este plano em particular:

- **o prompt deixou de poder virar linha de comando.** Ele viaja por arquivo e chega ao `claude`
  como um elemento de array, entregue por splat. Medido com `; && | $(whoami)` e crase dentro:
  voltou literal. É a Fase 1 aplicada ao maior texto de terceiro que o sistema manipula;
- **os três pontos de execução novos entram como não-montados** em `docs/exec-paths.md`
  (`execFile`/`execFileSync` com argv), e o conserto do diff do card ainda **removeu** um
  `execSync` com string montada. O contador de comandos montados não subiu.

---

## Fase 5-A — `run_command` vira RED **agora** (decisão 1) — ✅ ENTREGUE 2026-09-08

**Validado contra produção, não só em teste:**

| | |
|---|---|
| criar aprovação com o token do **agent** | **401** |
| criar sem token | **401** |
| criar com `APPROVAL_TOKEN` | **201** |
| consumir | `{"ok":true}` |
| **replay** (consumir de novo) | recusado |
| **argumento alterado** depois do aceite | recusado |

> **A primeira rodada desta validação provou menos do que parecia.** O 401 da tentativa de
> autoaprovação vinha do `JwtAuthGuard` **global**, não do `ApprovalTokenGuard` — a rota inteira
> estava fechada, inclusive para quem tinha o token certo. Só depois do `@Public()` (que desliga o
> guard global e deixa o guard de rota ser a autoridade) o teste passou a medir a defesa que
> importa. Fechado para todos não é o mesmo que fechado para o agent.

**Imediata, não espera a Fase 5.** O privilégio é reduzido antes de existir substituto, e o custo
(trabalho manual) é aceito conscientemente.

- risco **`red`**, aprovação humana obrigatória via `ApprovalGate`
- **indisponível para o Hermes** e para qualquer origem externa
- **não despachável por LLM** — o specialist loop não pode escolhê-lo

A diferença para a Fase 5 é o que vem antes: a Fase 5 fecha a porta *depois* de existirem as
capabilities. A 5-A fecha agora e aceita o buraco no meio.

---

## Fase 5 — `run_command` genérico permanece RED, com substituto pronto — ✅ ENTREGUE 2026-09-11 (parcial)

Sobrevive como escotilha, com regime próprio:

- risco **`red`** — acima de `high`, categoria nova
- **aprovação humana obrigatória** via `ApprovalGate` (o gate já existe, é o mesmo do
  `deployment_requires_review`), nunca `dryRun+force` automático
- **isolamento**: worktree própria e `env` mínimo, como a Fase 4
- **nunca despachável por LLM** — o specialist loop não pode escolhê-lo; só um humano

**Arquivos:** `security/whitelist.ts`, `role-policy.ts`, `actions/terminal.ts`,
`apps/api-v2/src/approval-gates/*`, `docs/agent-actions.md`.

**Risco:** perda de conveniência real. É o ponto do plano — e o número que justifica sai de
`agent_audit_logs`: se `run_command` responde por pouco do uso, o custo é baixo; se responde por
muito, a Fase 2 está incompleta e isso **precisa** aparecer antes de fechar a porta.

**Critério de saída (decisão 2):** a contenção de 07/09 e seus **13 testes permanecem** até a
substituição estar completa. Só saem quando as capabilities cobrirem o uso medido em
`agent_audit_logs`.

**Rollback:** falha fechado. `red` **não** é rebaixado para `high` — a capability é desabilitada.

### O que entrou em 2026-09-11

**Achado antes de mexer em código: a Fase 5-A tinha um buraco não medido.** O código só exigia
aprovação humana quando `rule.risk === 'high'` — um `git status` (risco `none`) ou `pnpm test`
(risco `medium`) via `{command}` executavam **direto**, sem gate nenhum, apesar da Fase 5-A
declarar "risco `red`, aprovação obrigatória" para o run_command genérico como um todo. O
segundo achado: o caminho `execSync` deste arquivo nunca tinha `env` explícito — sem chave
`env` nas opções, o Node herda `process.env` **inteiro** por omissão, o mesmo efeito de
`{ ...process.env }` só sem o spread visível — a Fase 4 nunca cobriu este ponto porque ele
nunca passou por `executarPrograma()`.

**Decisão confirmada com o usuário antes de mexer no specialist loop:** `debugger`
(`apps/api-v2/src/specialists/specialist-registry.ts`) tem `jarvis:run_command` em
`allowedSkills`, com um teste explícito e deliberado ("só o debugger tem run_command") — o
oposto textual de "nunca despachável por LLM". Duas leituras válidas (remover a skill do
debugger vs. manter e confiar no gate); a decisão foi **manter**: o gate de aprovação que este
fechamento constrói já impede qualquer execução vinda do specialist loop, porque o agent nunca
tem `APPROVAL_TOKEN` para conceder a própria aprovação — o debugger pode pedir, nunca executa
sozinho. `apps/api-v2` não foi tocado nesta entrega.

**Entregue, só em `apps/agent`:**
- o gate de aprovação deixou de depender de `rule.risk === 'high'` — toda execução não-`dryRun`
  do `{command}` de texto livre passa por `consumirAprovacao()`, independente do que
  `ALLOW_RULES` classificou. O `risk` retornado nesse caminho é sempre `'red'`; o `dryRun`
  continua mostrando o sub-risco da regra (`rule.risk`) no preview, informativo;
- a validação de `path` foi movida para ANTES do gate de aprovação — checagem local, sem custo
  de rede, falha rápido, e não gasta uma aprovação com um pedido cujo caminho já é inválido;
  confirmado que `fetch` nunca é chamado quando o `path` falha primeiro;
- `execSync` do caminho de texto livre passou a receber `env: ambientePadrao()` — fechando a
  lacuna real de Fase 4 que sobrava neste único ponto.

**Validado vermelho antes de verde:** revertendo o gate para a condição antiga
(`rule.risk === 'high'`), 6 dos 8 testes novos falham — inclusive o que prova que `git status`
(risco `none`) hoje também exige aprovação, o comportamento que esta fase existe para mudar.

**Deliberadamente fora desta entrega:** isolamento por **worktree própria** para o
`run_command` genérico (a Fase 4 cobriu `env`; workspace isolado por invocação é uma
sub-estrutura nova, do tamanho da que a Fase 4-B construiu para a sessão supervisionada —
declarado, sem data, mesma honestidade que a Fase 4-B usou enquanto parcial); o específialist
loop do `debugger` mantém `run_command` (decisão acima); a metadata `risk: 'medium'` de
`jarvis:run_command` em `skill-registry.ts`/`docs/agent-actions.md` não foi atualizada — fica
como inconsistência conhecida e de baixo risco (documentação, não enforcement) até uma
próxima passada que toque `apps/api-v2`.

**9 testes novos** (8 em `terminal-fase5-red.spec.ts` + 1 em `run-command-safety.spec.ts`,
mais o ajuste de `risk` em 3 testes pré-existentes que passaram a esperar `'red'` em vez de
`'high'`, sem alterar a contagem). **490 no agent** (era 481). **1477 no monorepo** (era 1468).

---

## Fase 6 — uma decisão só — ✅ ENTREGUE 2026-09-11 (escopo: `run_command`)

Hoje a autorização acontece em cinco lugares: `whitelist.ts` → `role-policy.ts` → `path-guard` →
`BLOCKED_PATTERNS` → `ALLOW_RULES` (+ o gate de `dryRun`). Cada um decide localmente e nenhum vê o
conjunto. É literalmente o *"per-layer, per-call-site trust enforcement rather than unified policy
boundaries"* do paper — a propriedade que torna ataque composto imune a correção local.

Passa a existir **um** ponto:

```ts
decidir(req: PedidoDeExecucao): Decisao
// { permitido, risco, requerAprovacao, workdir, envPermitido, motivo, registroDeAuditoria }
```

As camadas atuais viram **entradas** dessa função, não decisores. A auditoria passa a gravar a
decisão inteira, não o resultado da execução.

**Arquivos:** novo `apps/agent/src/exec/decidir.ts`; `executor.ts`; `poller.ts`;
`apps/api/src/modules/agent-bridge/*` (auditoria).

**Risco:** é a fase mais invasiva e a mais fácil de fazer errado — uma refatoração que "preserva o
comportamento" e silenciosamente afrouxa alguma checagem. Mitigação: entra **depois** das fases
1–5, e com os testes da Fase 7 escritos **antes**.

**Rollback:** manter os decisores antigos como *shadow mode* por uma versão — eles rodam, não
decidem, e discordância entre eles e a `decidir()` vira log alto. Sem isso não há como saber que a
refatoração afrouxou algo.

### O que entrou em 2026-09-11

**Escopo reduzido de propósito, declarado antes de escrever código.** O plano descreve
`decidir()` como o ponto único para as 44 ações de `executor.ts`; esta entrega cobre só
`jarvis:run_command` (capability + texto livre) — onde as cinco camadas já convergiam de fato,
porque as Fases 1–5 inteiras foram construídas em cima deste único despacho. Generalizar para
as outras 43 ações (cada uma com sua própria checagem espalhada em `actions/*.ts`) é trabalho
do tamanho desta fase inteira de novo, e fazer às pressas é EXATAMENTE o risco que a própria
Fase 6 nomeia: *"uma refatoração que preserva o comportamento e silenciosamente afrouxa alguma
checagem"*. Fica declarado, sem data — mesma honestidade da Fase 4-B e da Fase 5 para o que
ficou fora delas.

Por essa razão, o "shadow mode" que o plano pede como mitigação (decisores antigos rodando sem
decidir, log de discordância) não foi construído do jeito que o plano descreve para um cutover
total: confirmado por grep que `runCommand` é o ÚNICO ponto que `executor.ts` importa de
`actions/terminal.ts` — nenhum outro arquivo do repositório usava as constantes internas
(`ALLOW_RULES`, `BLOCKED_PATTERNS`, etc.) que viraram entrada de `decidir()`. A rede de
segurança real usada aqui foi mais direta: a suíte de testes PRÉ-EXISTENTE inteira (490 testes)
passando **sem alterar uma única asserção de comportamento**, rodada duas vezes para descartar
flake, antes de declarar a refatoração terminada.

**Entregue:** `exec/decidir.ts` — `decidir(req: PedidoDeExecucao): Promise<Decisao>`, com
`Decisao = { permitido, risco, requerAprovacao, workdir, envPermitido, motivo,
registroDeAuditoria, execucao }` (`execucao` é o acréscimo sobre o esboço do plano: carrega
`programa`/`argv`/`timeoutMs` já resolvidos, para quem chama nunca precisar reconstruir nada).
`actions/terminal.ts` foi reescrito para SÓ executar o que `decidir()` decidiu — nenhuma
checagem de autorização sobrou lá. `whitelist.ts`, `role-policy.ts`, `path-guard.ts`,
`capabilities.const.ts` e `workdir.ts` viraram entradas de `decidir()`, exatamente como o plano
pede; `BLOCKED_PATTERNS`/`ALLOW_RULES` (que só terminal.ts usava) foram movidos para dentro do
próprio `decidir.ts`.

**Generalização que o plano não pedia, mas a unificação tornou natural:** o gate de aprovação
(`exigeAprovacao()`) agora trata `risco: 'red'` como tier de aprovação também para
CAPABILITY, não só para texto livre — antes só `cap.risco === 'high'` disparava o gate.
Nenhuma capability real tem `red` ainda, mas fecha o caso 3 da Fase 7 (abaixo) e evita que uma
futura capability `red` precise de outro degrau de código.

**Validado com o teste, não só lido:** a prioridade `projectId` > `path` (Fase 3) foi
deliberadamente quebrada (checando `path` primeiro) para confirmar que o novo teste de
composição (Fase 7, caso 5, abaixo) pega a regressão — pegou: a chamada que devia recusar
executou `docker compose ps` de verdade contra o cwd real. Revertido e reconfirmado verde.

**Deliberadamente fora desta entrega:** as outras 43 ações de `executor.ts`/`poller.ts`;
`apps/api/src/modules/agent-bridge/*` (a auditoria do SERVIDOR continua gravando o resultado da
execução, não a `Decisao` inteira — fecha junto com a Fase 7, caso 4, que tem a mesma raiz:
`apps/api` fora do escopo desta rodada).

**5 testes novos** (2 em `decidir-capability-red.spec.ts`, mais os 3 da Fase 7 abaixo).
**495 no agent** (era 490). **1482 no monorepo** (era 1477), estável em duas rodadas
consecutivas.

---

## Fase 7 — testes de composição, escritos antes da Fase 6 — ✅ 8/8 fechados (2026-09-12)

Hoje cada camada tem teste próprio e **nenhum teste cruza duas**. O achado do paper é exatamente
sobre o que vive entre elas.

Casos que o conjunto precisa ter:

1. ✅ ação na `whitelist` mas fora do `role` → recusada e auditada (`composicao-de-camadas.spec.ts`)
2. ✅ capability válida + `projectId` de outro projeto → workdir recusado (Fase 3, 11/09)
3. ✅ capability válida + workdir válido + risco `red` sem aprovação → recusada
   (`decidir-capability-red.spec.ts`, 11/09 — capability sintética, nenhuma real é `red` ainda)
4. ✅ gate aprovado → executa **e** a auditoria registra quem aprovou — fechado em 12/09
   (Item C.1+C.2 do plano de pendências): `POST /execution/approvals/consume` passou a
   devolver `{ ok, id, createdBy }` (dado já buscado em memória em `consumir()`, sem query
   extra); `approval-client.ts` repassa com a mesma disciplina do `ok === true` explícito
   (corpo inesperado não vira identidade forjada); `decidir()` inclui `aprovadoPor` em
   `registroDeAuditoria`. Testado nos dois sentidos: aprovação concedida popula o campo,
   aprovação recusada nunca popula mesmo que o corpo tente forçar um `createdBy`.
   **Fechado de ponta a ponta em 12/09 (Item C.3):** `agent_audit_logs.approved_by` agora é
   coluna real, populada via `RunCommandResult.aprovadoPor` → `poller.ts` → `PATCH /tasks/:id`
   — antes disso o dado existia só dentro de `decidir()`, sem lugar persistido para onde ir
5. ✅ path-guard permitiria, mas o registro de workdir não conhece o projeto → recusa
   (`composicao-de-camadas.spec.ts`, 11/09 — validado quebrando a prioridade de propósito)
6. ✅ argumento com metacaractere chega literal ao programa (Fase 1/2)
7. ✅ processo-filho não enxerga `AGENT_TOKEN` (Fase 4)
8. ✅ duas operações individualmente válidas em sequência não compõem privilégio
   (`composicao-de-camadas.spec.ts`, 11/09 — duas chamadas de `runCommand` em sequência, a
   segunda com aprovação negada, provando que não há aprovação "de sessão" compartilhada)

**Arquivos:** os 8 casos vivem em `apps/agent/src/__tests__/composicao-de-camadas.spec.ts` e
`apps/agent/src/exec/__tests__/decidir-capability-red.spec.ts` — não num `composicao.spec.ts`
único como o plano original previa; `composicao-de-camadas.spec.ts` já existia como o lar
natural destes casos desde a Fase 0/1 e ganhou os que faltavam em vez de duplicar em arquivo novo.

**Risco:** nenhum. **Este é o único item que eu recomendaria fazer mesmo que o resto fosse
adiado** — ele mede o estado atual e viraria a rede de segurança de qualquer refatoração futura.

---

## Fase 8 — token MCP por consumidor — ✅ ENTREGUE 2026-09-11

Hoje `MCP_READONLY_TOKEN` é **um** token compartilhado: quem o tem é "somente-leitura", e ponto.
Não há como dizer *qual* consumidor leu o quê, nem revogar um sem derrubar os outros.

Passa a haver token por consumidor (`hermes`, `widget`, …), com identidade no log de acesso e
revogação individual.

**Arquivos:** `apps/agent/src/mcp/rayzen-mcp-http.mjs`, `infra/hermes/*`, `.env`, compose.

**Risco:** baixo; é aditivo. O token compartilhado continua válido durante a transição.

**Rollback:** remover o registro do consumidor.

### O que entrou em 2026-09-11

**Medido antes de desenhar a solução:** `MCP_READONLY_TOKEN` tem hoje só UM consumidor real —
`infra/hermes/` (marcado como *spike*, não produção, per `RESEARCH/hermes.md`). Nenhum widget
ou outro cliente usa o token de leitura. Isso não mudou a urgência (a Fase 8 é aditiva e barata
de qualquer forma), mas confirmou que dava para migrar o consumidor real de ponta a ponta na
mesma entrega, sem deixar meio caminho andado.

**Descoberta por padrão, não lista fixa.** `MCP_TOKEN_<NOME>` (ex.: `MCP_TOKEN_HERMES`) é
descoberto varrendo `process.env` por regex — um consumidor novo é uma variável de ambiente
nova (`.env` + `docker-compose.yml`), sem tocar em `rayzen-mcp-http.mjs`. Mesmo escopo do
`MCP_READONLY_TOKEN` (leitura) — a Fase 8 não introduz escopo novo, só identidade e revogação.

**`identificarConsumidor()` nunca decide autorização — só identifica para o log.** É uma função
separada de `escopoDoToken()` de propósito: misturar as duas faria o log depender da mesma
lógica que autoriza, e um bug ali vazaria para os dois lugares ao mesmo tempo.
`checkAuth()` chama `escopoDoToken()` primeiro (autoriza ou responde 401) e só DEPOIS
`identificarConsumidor()` (loga) — nunca o contrário, confirmado por teste.

**Hermes (o único consumidor real) migrado de ponta a ponta:** `infra/hermes/config.yaml` e
`infra/hermes/docker-compose.hermes.yml` trocaram `MCP_READONLY_TOKEN` por `MCP_TOKEN_HERMES`
— sem sobrar referência ao valor compartilhado nos dois arquivos, confirmado por teste. O token
compartilhado continua existindo e funcionando (`escopoDoToken()` ainda o reconhece) para
qualquer OUTRO consumidor futuro que ainda não tenha o seu.

**Validado vermelho antes de verde:** revertendo `rayzen-mcp-http.mjs` para antes desta fase,
4 dos 6 testes novos falham — confirmando que medem o mecanismo novo, não uma tautologia.

**Entregue:** `CONSUMIDORES_LEITURA` + `identificarConsumidor()` em `rayzen-mcp-http.mjs` ·
`escopoDoToken()` estendido · `checkAuth()` logando identidade · `infra/hermes/config.yaml` e
`docker-compose.hermes.yml` migrados · `docker-compose.yml` (declaração explícita de
`MCP_TOKEN_HERMES`, mesma exigência já documentada para `GEMINI_API_KEY`) · `.env.example`
documentando `MCP_READONLY_TOKEN` (que nunca tinha entrado lá) e `MCP_TOKEN_HERMES`.

**Testado com a mesma técnica de `escopo-leitura.spec.ts` — leitura textual do `.mjs`, não
import direto:** este arquivo inicia um servidor HTTP real ao ser carregado, sem guard de
entry-point — importar num teste abriria uma porta de verdade. Rede de segurança aqui é
textual, herdada do padrão que já sustenta este arquivo desde a Fase 4-B.

**6 testes novos** (`mcp/__tests__/token-por-consumidor.spec.ts`). **501 no agent** (era 495).
**1488 no monorepo** (era 1482), estável em duas rodadas.

**Fecha o plano original inteiro** — Fases 0 a 8 todas entregues ou parcialmente entregues e
declaradas (Fase 5: parcial · Fase 6: escopo reduzido a `run_command` · Fase 7: 7/8 nesta data).
O que resta são os itens explicitamente adiados de cada fase (worktree isolada para
`run_command`, generalização de `decidir()` para as outras 43 ações, auditoria de `apps/api`
registrar quem aprovou) — nenhum bloqueia o uso diário, todos declarados sem data.

---

## Pendências pós-plano — 12/09

Plano próprio (`~/.claude/plans/drifting-crafting-cray.md`, aprovado em plan mode) para os
itens deixados em aberto na tabela acima, mais os achados de uma varredura de "está tudo
funcional?". Estado nesta data:

| item | status |
|---|---|
| Achado 0 — 6 gaps novos (safe-root, exec cru, handler ausente) | ✅ fechado — commit `6493fed` |
| Item A.1 — limpeza automática do worktree da sessão supervisionada | ✅ fechado — commit `8bde265` |
| Item C.1+C.2 — auditoria registra quem aprovou (Fase 7, caso 4) | ✅ fechado — commit `0089503` |
| Item A.2 — decisão de custo×benefício sobre isolar `run_command` | ✅ decidido — medido 0,8-4,2s de `git worktree add` nesta máquina, aceito frente ao gate de aprovação humana da Fase 5 |
| Item A.3 — workspace isolado por invocação para `run_command` | ✅ fechado — ver detalhe abaixo |
| Item C.3 — `aprovadoPor` chega a uma tabela persistida (Fase 7, caso 4, fechado de ponta a ponta) | ✅ fechado — ver detalhe abaixo |
| Item B — `decidir()` generalizado para as outras 42 ações | ⏳ fora de escopo desta rodada — trabalho de várias sessões, por família de ação |

### Item A.3 — o que entrou

`criarWorktree`/`removerWorktree` extraídos de `actions/supervised-session.ts` para
`exec/workspace-isolado.ts` (novo módulo) — dois chamadores precisando do mesmo mecanismo,
duplicar seria repetir o erro que este plano inteiro existe para evitar. `decidir.ts`'s
`decidirComandoLivre()` cria um worktree isolado por invocação **só quando**: a execução foi
aprovada, não é `dryRun`, **e** um `path` foi dado explicitamente.

> **A terceira condição (path explícito) não estava no desenho original, e foi descoberta
> escrevendo o teste.** Sem `path`, `workdir` cai em `process.cwd()` — que durante os TESTES é
> `apps/agent`, subdiretório do próprio repositório rayzen-ai. Isolar esse caso teria feito
> testes comuns (`composicao-de-camadas.spec.ts` chamando `runCommand({command: 'git
> status'})` sem `path`) criar worktrees de verdade contra o repositório real a cada execução
> da suíte — confirmado ao vivo antes de corrigir. `supervised-session.ts` aceita esse mesmo
> default porque lá é decisão explícita de sessão longa; para `run_command` seria efeito
> colateral silencioso. Sem `path`, a execução cai no `process.cwd()` sem passar por
> `criarWorktree()` — igual a antes do Item A.3.

Degrada para a base real (sem isolamento) quando não é repositório git ou o worktree falha —
a aprovação humana já aconteceu, recusar por causa do isolamento jogaria fora uma execução já
aprovada. Limpeza sempre em `finally` (`actions/terminal.ts`), sucesso ou falha.

**Achado de higiene de teste:** sob a suíte completa (múltiplos workers de Jest fazendo I/O de
git ao mesmo tempo), `rmSync` sem retry esbarrava em `EBUSY` no Windows ao apagar o
repositório-base logo depois de `git worktree remove` — nunca reproduzia isolado. Corrigido com
`maxRetries`/`retryDelay` do próprio `rmSync`. Confirmado em 3 rodadas completas consecutivas.

**6 testes novos** (1 em `exec/__tests__/workspace-isolado.spec.ts` — os outros 5 vieram de
`actions/__tests__/worktree-real.spec.ts`, MOVIDO para lá, arquivo antigo removido — mais 5 em
`actions/__tests__/terminal-workspace-isolado.spec.ts`, novo). **575 no agent** (era 570).
**1563 no monorepo** (era 1557), estável em 3 rodadas.

### Item C.3 — o que entrou

C.1+C.2 (fechados em 12/09, commit `0089503`) deixaram `aprovadoPor` disponível dentro de
`decidir()`, mas sem lugar persistido para onde ir — exatamente a lacuna que este item fecha.
Três pontas, todas na mesma cadeia de propagação:

1. **`AgentAuditLog` (schema Prisma, `apps/api`)** ganhou `approvedBy String? @map("approved_by")`
   — migração `20260912230000_agent_audit_log_approved_by`, `ALTER TABLE ... ADD COLUMN IF NOT
   EXISTS`, mesmo padrão de `20260908030000_approval_actor_type`.
2. **`RunCommandResult` (`apps/agent/src/actions/terminal.ts`)** ganhou `aprovadoPor?: string`,
   populado nos dois caminhos de sucesso de `executar()` a partir de
   `decisao.registroDeAuditoria.aprovadoPor` — nunca presente em `dryRun`/recusa, porque nesses
   casos `executar()` nem chega a rodar.
3. **`poller.ts` deixou de reconstruir o audit só a partir do PAYLOAD de entrada.** `aprovadoPor`
   só existe no RESULTADO da execução — a identidade de quem aprovou só é conhecida depois que o
   servidor de aprovações a deu, e o payload da task é anterior a isso. `processTask()` extrai o
   campo do `enrichedResult` com o mesmo cuidado de tipo que todo campo vindo de `unknown` recebe
   nesta casa (checagem de `typeof === 'string'` antes de aceitar — um resultado forjado com
   `aprovadoPor` de outro tipo nunca vira identidade aceita).

`CreateAuditEntryDto`/`AuditLogService.create()` e `UpdateTaskDto`/`AgentBridgeController.update()`
(`apps/api/src/modules/agent-bridge/`) carregam o campo pelas duas pontas que faltavam — DTO de
entrada do PATCH e DTO de gravação do audit.

**Validado vermelho→verde nos três pontos da cadeia:** `git stash` de `audit-log.service.ts`
confirma erro de compilação no teste (`'approvedBy' does not exist`); `git stash` de `poller.ts`
confirma `approvedBy: undefined` no PATCH onde deveria vir `'marcelo'`.

**11 testes novos** (2 em `audit-log.service.spec.ts`, 3 em `poller-approved-by.spec.ts` — arquivo
novo, já que `poller.ts` nunca teve suíte própria antes desta entrega). **508 na api** (era 505).
**578 no agent** (era 575). **1568 no monorepo** (era 1563), estável em 2 rodadas completas —
a terceira rodada reproduziu os 3 flakes já documentados de I/O de git sob carga concorrente
(`executar-programa.spec.ts`, `git-fase1-emergencial.spec.ts`, `terminal-workspace-isolado.spec.ts`),
confirmados verdes em isolamento — mesmo padrão medido no Item A.3, não uma regressão nova.

---

## Ordem, e por que ela

```
5-A (run_command → RED, IMEDIATA)
0 (inventário) → 7 (composição) → 1 + 1-A → 2 → 3 → 4 → 8 → 5 → 6 → 4-B

  └── autorizado agora: 0 e 7. Parar depois da 7.
```

- **7 antes de tudo que refatora**: sem rede, a Fase 6 é uma reescrita de segurança sem medição.
- **5 (fechar o `run_command`) só depois de 2**, senão fecha-se a porta antes de existir a porta boa.
- **6 por último**: é a que mais move código, e as anteriores reduzem a superfície que ela precisa
  cobrir.
- **8 é independente** e pode andar a qualquer momento.

Cada fase entrega valor sozinha e pode parar ali sem deixar o sistema pior — critério deliberado,
porque plano longo que só vale no fim não sobrevive a mudança de prioridade.

---

## Riscos gerais

| risco | mitigação |
|---|---|
| Resolução de `.cmd`/`.bat` no Windows quebrar metade das ações | resolver executável na subida, falhar alto, migrar ação a ação |
| Refatoração afrouxar checagem sem ninguém ver | *shadow mode* na Fase 6 + testes da Fase 7 escritos antes |
| Capabilities incompletas travarem trabalho real | priorizar pelo uso medido em `agent_audit_logs`, não pelo imaginado |
| O agent rodar código velho e parecer que o plano não funcionou | `rayzen-start.bat` já compila sempre desde 06/09; conferir mtime do `dist` |
| Perder a contenção atual no meio da migração | os 13 testes de `encadeamento-de-comando.spec.ts` **não saem** até a Fase 5 fechar |

## Rollback global — falha fechado (decisão 11)

**A versão original desta seção está revogada.** Ela dizia que o ponto de não-retorno era reversível
"rebaixando `red` para `high`" — isto é, **restaurando o executor vulnerável**. Não é rollback, é
reintrodução de defeito com outro nome.

A regra passa a ser:

- rollback de correção de segurança **desabilita a capability** e deixa o trabalho manual
- **nunca** restaura automaticamente uma versão vulnerável, nem por flag, nem por variável de
  ambiente, nem por rebaixamento de risco
- o custo aceito é **indisponibilidade**, que é o lado certo para errar

Rollback de mudança **não-relacionada a segurança** (uma capability que quebrou por `.cmd`, por
exemplo) continua sendo reverter o commit — a distinção é se o caminho antigo era vulnerável.

## O que NÃO está neste plano

- **Reescrever o `path-guard`**: ele continua como segunda barreira. Trocar duas barreiras ao mesmo
  tempo é como se perde a que funcionava.
- **Sandbox de SO** (container por execução, usuário sem privilégio no Windows): mais forte que tudo
  aqui, e escopo próprio.
- **A superfície da V1/V2**: este plano é do agent. O inventário da Fase 0 vai dizer se há algo lá,
  e aí vira plano separado.
