# `RayzenExec` — plano de preparação

> **Estado: PLANO. Nada executado.** Nenhuma conta criada, nenhum arquivo copiado, nenhuma
> sessão movida, VS Code e Remote Control intocados.

---

## Bloqueio a resolver antes de tudo

**Eu não consigo criar a conta.** Medido agora:

| | |
|---|---|
| `marce` pertence a `Administradores` | **sim** |
| token desta sessão está elevado | **não** — UAC entrega token filtrado |
| elevar daqui | impossível: exige prompt interativo, e esta sessão não tem |

`New-LocalUser`, `icacls` em `C:\` e instalação de serviço **falham com acesso negado** neste
contexto. O passo 1 precisa que **você** rode um script elevado — um só, revisável, entregue
abaixo. Todo o resto eu faço sem elevação.

> Registrar isso é parte do trabalho: um plano que assume privilégio que não tem falha no meio,
> com metade feita — que é o pior estado possível para uma mudança de conta.

---

## O que já existe (medido, não suposto)

| ferramenta | escopo | consequência |
|---|---|---|
| `node` `C:\Program Files\nodejs\` | **máquina** | `RayzenExec` herda. Nada a instalar |
| `npm`, `pnpm` (mesmo diretório) | **máquina** | idem |
| `git` `C:\Program Files\Git\` | **máquina** | idem |
| **`claude`** `C:\Users\marce\.npm-global\claude.ps1` | **por usuário** | **precisa de instalação própria** — e isso é bom: instalação por usuário nasce com `~/.claude` próprio |
| disco livre em `C:` | 239 GB | sobra |

**Só o Claude Code precisa ser instalado.** O toolchain do projeto já é machine-wide.

---

## A consequência estrutural que decide o desenho

O repositório está em **`C:\Users\marce\Desktop\Projects\rayzen-ai`** — dentro do perfil do dono.

O Windows já ACL-a `C:\Users\marce` para o dono: **`RayzenExec` não consegue ler o projeto**, e
isso não é obstáculo, é o requisito 14 satisfeito por construção. Mas obriga uma decisão:

> **`RayzenExec` nunca toca a sua cópia de trabalho.** Ela recebe um **clone próprio** fora do
> seu perfil, e as sessões rodam lá.

O trabalho volta por **git**, não por arquivo compartilhado — que é o mesmo contrato do worktree
já em uso: o branch não é mesclado automaticamente, você revisa e traz.

Isso também **elimina** o risco de edição concorrente na mesma árvore, que era a preocupação do
lock por projeto. Duas árvores, dois checkouts, um merge revisado por você.

---

## 1. Arquivos e diretórios

```
C:\RayzenExec\                       ← raiz, FORA de C:\Users
├── workspace\                       ← clones dos projetos que a sessão pode tocar
│   └── rayzen-ai\                   ← clone próprio (git clone do remoto, não cópia do seu)
├── logs\                            ← saída das sessões
└── tmp\                             ← temporário da conta

C:\Users\RayzenExec\                 ← perfil, criado pelo Windows no primeiro logon
├── .claude\                         ← criado pelo LOGIN PRÓPRIO. Nunca copiado
└── .npm-global\                     ← instalação própria do Claude Code CLI
```

**Nada é copiado do seu perfil.** Sem `~/.claude`, sem `~/.vscode`, sem extensões, sem `.env`,
sem token, sem credencial, sem arquivo pessoal. O clone vem **do remoto**, com `git clone`.

> O `.env` do projeto **não** viaja no clone (é gitignored) — então a sessão nasce sem os
> segredos do projeto, e isso é intencional. O que ela precisar entra nomeado (seção 4).

## 2. Permissões

| caminho | quem | acesso |
|---|---|---|
| `C:\RayzenExec\` | `RayzenExec` | Modify |
| `C:\RayzenExec\` | `marce` | Read (para você revisar o que a sessão fez) |
| `C:\RayzenExec\` | herança | **removida** |
| `C:\Users\marce\` | `RayzenExec` | **nenhum** — padrão do Windows, a ser **verificado**, não presumido |
| grupo `Administradores` | `RayzenExec` | **fora** — requisito 2 |

`RayzenExec` fica só em `Users`. Sem logon interativo pela tela (a sessão entra por tarefa
agendada), sem acesso remoto.

## 3. Autenticação

**Login próprio do Claude Code, executado dentro da conta.** Nunca cópia.

- **Sem `ANTHROPIC_API_KEY`** — requisito 7. E há o motivo documentado: em modo `-p` a chave
  **prevalece sobre a assinatura quando presente**, então defini-la anularia a intenção
- Se o login por assinatura **não funcionar ou o plano restringir**: **parar e relatar**
  (requisito 8). Não trocar por API key
- O login é interativo (device code / navegador). **Você faz**, dentro da sessão da conta —
  não há como eu fazer isso por você, e não deveria haver

> **A pergunta em aberto continua sendo de plano, não técnica:** a assinatura permite duas contas
> de SO logadas ao mesmo tempo? Se não permitir, o sintoma provável é a sua sessão cair — e é por
> isso que o primeiro teste (seção 5) verifica **as duas ao mesmo tempo**.

## 4. Variáveis

Ambiente da sessão = `ambienteMinimo()` que já existe, **nada de `...process.env`**:

`PATH` · `SystemRoot` · `SystemDrive` · `windir` · `COMSPEC` · `PATHEXT` · `TEMP` · `TMP` ·
`APPDATA` · `LOCALAPPDATA` · `USERPROFILE` · `ProgramFiles` · `ProgramData` · `USERNAME` ·
`COMPUTERNAME` · locale

**Nenhuma credencial.** `CREDENCIAIS_INDISPENSAVEIS` continua vazia — o CLI autentica pelo
`~/.claude` da própria conta, alcançado por `USERPROFILE`.

Se o PC Agent vier a despachar para essa conta, o `AGENT_TOKEN` entra **nomeado e justificado**,
não por spread. Hoje não é necessário: quem fala com a API é o processo pai.

## 5. Testes

Executados **como `RayzenExec`**, via tarefa agendada (é o único caminho não-interativo; `runas`
sempre pede senha no console).

| # | teste | critério |
|---|---|---|
| 1 | `claude -p "diga apenas ok"` | responde — e **a sua sessão continua funcionando ao mesmo tempo** |
| 2 | os 22 do `validar-fase-1a-windows.mjs` | 22/22 sob a conta dedicada |
| 3 | ler `C:\Users\marce\.env` | **acesso negado** |
| 4 | ler `C:\Users\marce\.ssh\id_ed25519` | **acesso negado** |
| 5 | listar `C:\Users\marce\Desktop\Projects` | **acesso negado** |
| 6 | ler `.env` de outro projeto | **acesso negado** |
| 7 | `whoami /groups` | **não** contém `Administradores` |
| 8 | `Get-ChildItem env:` na sessão | zero variáveis com `TOKEN`/`SECRET`/`PASSWORD`/`KEY` |

Os testes 3–6 são o requisito 14, e são **verificação**, não suposição: o padrão do Windows
deveria negá-los, e é exatamente o tipo de padrão que se confirma medindo.

## 6. Riscos

| risco | tratamento |
|---|---|
| **Plano do Claude não permitir duas sessões** | teste 1 mede as duas simultâneas. Se falhar: **parar e relatar** — não trocar por API |
| Perfil novo consome disco | ~1 GB com o CLI; há 239 GB |
| A sessão não enxerga o projeto | **é o desenho**, não defeito: ela trabalha no clone próprio |
| Trabalho fica preso no clone | volta por git — mesmo contrato do worktree, revisado por você |
| Senha da conta vira mais um segredo | gerada aleatória, gravada só onde você lê, nunca no terminal nem em log |
| Tarefa agendada guarda a senha | o Agendador armazena protegido pelo DPAPI da máquina. É o preço de rodar sem interação — está declarado |
| Achar que isto é isolamento total | **não é.** Mesma máquina, mesmo disco, mesma rede. É isolamento **de conta e de árvore de arquivos** |

## 7. Rollback

Remove **só** o que foi criado, e nesta ordem:

```powershell
Unregister-ScheduledTask -TaskName 'RayzenExec - Sessao' -Confirm:$false   # se existir
Remove-LocalUser -Name 'RayzenExec'                                        # elevado
Remove-Item 'C:\Users\RayzenExec' -Recurse -Force                          # elevado
Remove-Item 'C:\RayzenExec'      -Recurse -Force                           # elevado
```

Nada do seu perfil é tocado em nenhum passo, então não há o que restaurar do seu lado. O
`supervised_session` continua rodando como hoje, no seu usuário, até você aprovar a migração —
que **não** faz parte deste plano.

---

## O que preciso de você

**Um script elevado, este:**

```powershell
# Executar como Administrador, UMA vez.
$senha = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$sec   = ConvertTo-SecureString $senha -AsPlainText -Force

New-LocalUser -Name 'RayzenExec' -Password $sec -FullName 'Rayzen Exec (sessoes remotas)' `
              -Description 'Conta isolada para sessoes do Claude Code CLI' -PasswordNeverExpires
# NAO adicionar a Administradores. `Usuarios` ja e o grupo padrao.

New-Item -ItemType Directory -Path 'C:\RayzenExec\workspace','C:\RayzenExec\logs','C:\RayzenExec\tmp' -Force | Out-Null
icacls 'C:\RayzenExec' /inheritance:r | Out-Null
icacls 'C:\RayzenExec' /grant:r 'RayzenExec:(OI)(CI)M' 'marce:(OI)(CI)R' 'SYSTEM:(OI)(CI)F' | Out-Null

# A senha vai para um arquivo que so voce le. Nunca para o terminal.
$f = Join-Path $env:USERPROFILE 'rayzenexec-senha.txt'
Set-Content -Path $f -Value $senha -Encoding utf8
icacls $f /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Output "Conta criada. Senha em: $f"
```

Depois disso eu sigo sem elevação: clone do projeto, instalação do Claude Code na conta, tarefa
agendada, e os 8 testes. **O login do Claude é interativo e é seu** — eu paro ali e te aviso.

**Ordem de aprovação:** (1) você revisa este plano · (2) roda o script elevado · (3) eu preparo e
paro no login · (4) você loga · (5) eu rodo os 8 testes e reporto · (6) **só então** discutimos
migrar o `supervised_session`.

---

## Execução — 2026-09-09

### Feito e verificado

| passo | resultado |
|---|---|
| conta `RayzenExec` | criada, habilitada |
| grupo `Administradores` | **0** — requisito 2 cumprido |
| grupo `Usuários` | adicionada (ver defeito abaixo) |
| `C:\RayzenExec` | criado, herança removida, ACL `SYSTEM(F)` · `marce(R)` · `RayzenExec(M)` |
| Claude Code CLI | instalado **dentro da conta** — `2.1.266`, em `C:\Users\RayzenExec\AppData\Roaming\npm` |
| perfil da conta | criado no primeiro processo |
| `~/.claude`, `~/.vscode`, `.env`, token | **nada copiado** |
| ambiente da conta | **0** variáveis com `TOKEN`/`SECRET`/`PASSWORD`/`KEY` |

### Dois defeitos meus, corrigidos

1. **`-Description` do `New-LocalUser` tem limite de 48 caracteres** e eu escrevi 90. Falhou na
   validação do parâmetro, **antes** de criar qualquer coisa — verificado depois: sem conta, sem
   workspace, sem arquivo de senha.
2. **`New-LocalUser` não adiciona a grupo nenhum.** Eu havia escrito no script que `Usuários` era
   o padrão; é falso, e a conferência pós-criação pegou. Sem `Usuários` a conta não tem direito de
   logon. Corrigido por `scripts/corrigir-grupo-rayzenexec.ps1`, que descobre o grupo pelo **SID**
   (`S-1-5-32-545`) e não pelo nome — o script não pode depender do idioma do Windows.

### Limitação encontrada: tarefa agendada não roda

Registrar a tarefa como `RayzenExec` funciona sem elevação, mas ela **não executa**
(`267011` = *task has not yet run*): falta o direito **"Log on as a batch job"**, que exige
elevação para conceder e não vem com `Usuários`.

**Contorno em uso:** `Start-Process -Credential`, que funciona sem elevação e foi validado
(`whoami` retornou `desktop-jthsvui\rayzenexec`). É suficiente para as sessões, porque quem as
dispara é o agent, que roda como o dono.

### ⛔ Bloqueio real: o isolamento do sistema de arquivos **não existe**

Dos cinco alvos do requisito 14, **dois foram lidos**:

```
negado (ok): C:\Users\marce\.env
negado (ok): C:\Users\marce\.ssh
negado (ok): C:\Users\marce\.claude\.credentials.json
LEU (RUIM):  C:\Users\marce\Desktop\Projects
LEU (RUIM):  C:\Users\marce\Desktop\Projects\rayzen-ai\.env      ← com todos os segredos
```

**A causa não é a conta nova.** `C:\Users\marce\Desktop` tem um ACE **explícito**:

```
BUILTIN\Usuários:(OI)(CI)(M)          ← Modify, herdado por TUDO abaixo
```

Ou seja: **qualquer conta local desta máquina lê e ESCREVE em tudo sob o seu Desktop**, e isso
vale desde antes — o teste de isolamento só tornou visível. A raiz do perfil (`C:\Users\marce`)
está protegida; o `Desktop` não.

E há mais dois principais com acesso ao repositório:

| principal | acesso | o que é |
|---|---|---|
| `CodexSandboxUsers` | `(M,DC)` no repo | contém `CodexSandboxOffline` e `CodexSandboxOnline` — do Codex |
| `S-1-5-21-…-4034650017` | `(M,DC)` no repo | **SID órfão** — conta removida, ACE que sobrou |

> **Consequência para a Fase 4-B:** enquanto esse ACE existir, mover a sessão para `RayzenExec`
> **não** isola nada do que importa. A conta separada continua alcançando o `.env` do projeto.
> O isolamento de conta está pronto; o isolamento de arquivo **não**.

**Não corrigi por decisão.** Mexer no ACL do seu Desktop é invasivo e pode quebrar o Codex, que
depende dele. É decisão sua, e as opções estão abaixo.

### Canal de arquivos entre as contas

Marce só tem leitura em `C:\RayzenExec`, e `RayzenExec` não deveria ler o perfil do dono — então
não havia como mover arquivo entre as duas. Usei `C:\Users\Public\rayzen-drop`, que é o local
compartilhado padrão do Windows, para entregar o script de teste. É um canal **deliberado e
estreito**; deve ser esvaziado quando não estiver em uso.

---

## 2026-09-09 — mover o repo NÃO resolveu, e o desenho mudou

### O move foi executado e falhou no objetivo

O repositório saiu de `C:\Users\marce\Desktop\Projects\rayzen-ai` para
`C:\Users\marce\Projects\rayzen-ai`. **O acesso continua exatamente como antes.**

`Move-Item` no mesmo volume é uma renomeação: o DACL **não é recalculado**. As ACEs viajaram
junto, inclusive a que veio do Desktop — e ela continua **efetiva** mesmo marcada `(I)`, porque
o flag herdado é gravado fisicamente no filho e ninguém o reavalia.

| ACE no repo depois do move | origem | efeito |
|---|---|---|
| `BUILTIN\Usuários:(I)(OI)(CI)(M)` | veio do Desktop | **`RayzenExec` lê e escreve tudo, inclusive o `.env`** |
| 3 SIDs `(M,DC)` | resíduo | **os três não resolvem** — contas removidas |
| `CodexSandboxUsers:(M,DC)` | explícita | escrita do sandbox do Codex |

A prova de que é resíduo, e não herança: uma pasta **criada agora** em `C:\Users\marce\Projects`
herda só `CodexSandboxUsers(RX)` · `SYSTEM` · `Administradores` · `marce`. Sem `Usuários`.

E `RayzenExec`, `CodexSandboxOffline` e `CodexSandboxOnline` estão todos no grupo `Usuários`.

> **A verificação do próprio script (linha 118) previa isso** e deve ter emitido o `ATENCAO`. Um
> script que confere o próprio resultado vale o que custa — mas só se alguém ler o aviso.

### O move cobrou dois preços que ninguém previu

Descobertos em 09/09 ao investigar "o `start.bat` não funciona mais".

**1. `node_modules` do pnpm ficou quebrado.** O pnpm liga pacotes por *junction* com caminho
**absoluto**, e `node_modules/.modules.yaml` grava `virtualStoreDir` absoluto. Depois do move,
todos apontavam para `C:\Users\marce\Desktop\Projects\rayzen-ai\node_modules\.pnpm\…` — que não
existe mais. `tsc` sumiu, o build do agent passou a falhar.

E `pnpm install` **não conserta sozinho**: ele detecta que precisa purgar o diretório, aborta com
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` — e **sai com código 0**. Um install que não fez nada
e reportou sucesso. Precisa de `CI=true pnpm install --frozen-lockfile` para autorizar a purga.

> Mover um repositório JS não é mover arquivos: metade do `node_modules` são links absolutos.
> Qualquer runbook de move precisa terminar em reinstalação, e conferir que ela **de fato** rodou.

**2. `rayzen-start.bat` anunciava recusa e subia assim mesmo.** O padrão era:

```bat
set "PAUSA=rem sem pausa - modo automatico"   ...   %PAUSA% & exit /b 1
```

Sob o Agendador, `%PAUSA%` expande para `rem …` — e **`rem` comenta a linha inteira, inclusive o
`& exit /b 1` depois dele**. As três saídas de erro do script (pnpm ausente, `.env` ausente, build
falhou) eram no-op exatamente no modo em que ninguém lê a tela.

Medido às 02:07 de 09/09: `tsc` falhou, o script imprimiu *"NAO subindo com o dist antigo"*, subiu
com o `dist` de 08/09, e a tarefa devolveu `LastTaskResult 0`. É o cenário que aquela mensagem
existe para impedir, acontecendo enquanto a mensagem era exibida.

> Mesma família do `dist` congelado por 20 dias (06/09): **o guard existia, estava escrito, e não
> guardava.** Corrigido separando `%PAUSA%` e `exit /b 1` em linhas próprias.

**3. O autostart se auto-bloqueava — e este não veio do move.** A tarefa redirecionava o `cmd`
inteiro para `%TEMP%\rayzen-autostart.log`. Os `start` do `.bat` criam janelas
`powershell -NoExit`, que **herdam o handle desse log** e, por causa do `-NoExit`, ficam vivas
mesmo quando o comando dentro delas falha. O arquivo ficava com handle exclusivo por tempo
indeterminado, e a execução **seguinte** não conseguia abri-lo: o `cmd` devolvia `1` **sem
executar uma linha do script**.

Medido em 09/09: a execução das 02:07 deixou 4 janelas vivas; a das 07:37 devolveu
`LastTaskResult 1` com o log ainda datado de **02:07** — intocado.

> Os três sintomas são o mesmo para quem olha o painel: *"o autostart falhou ao subir"*. Mas um
> era build quebrado, outro era guard que não guardava, e este era o log da execução anterior
> trancando a próxima. Um log escrito para diagnosticar a falha **virou a falha**.

O redirecionamento agora cobre só a fase de preparo, dentro do `.bat`, e termina **antes** dos
`start` — nada que a fase 2 cria pode herdar handle de arquivo. Provado: com agent e widget no
ar, o log é gravável e a tarefa roda duas vezes seguidas com `LastTaskResult 0`.

### Decisão: não se conserta ACL do workspace do dono

Mexer no DACL da árvore de trabalho é invasivo, pode quebrar o Codex, e resolveria o sintoma
pela metade — a sessão continuaria rodando **na conta do dono**. A direção é estrutural:
`RayzenExec` recebe **workspace próprio** em `C:\RayzenExec\workspaces`, com ACL explícita.

### `git worktree` não serve — e o motivo é estrutural

Worktree grava um `.git` que é um **arquivo apontando** para
`C:\Users\marce\Projects\rayzen-ai\.git\worktrees\…`, e compartilha o object store. `RayzenExec`
não lê o perfil do dono: o worktree quebraria em toda operação git — e se lesse, seria o oposto
de isolamento. **Clone**, então.

### De onde vem o clone: `git bundle`

Três caminhos fechados, um aberto:

| caminho | por que não |
|---|---|
| clone do GitHub | repo **privado**; a conta não tem credencial, e dar uma viola o requisito 4 |
| clone da cópia do dono | a conta não lê `C:\Users\marce\Projects`. **É o desenho** |
| **`git bundle`** | carrega **só objetos versionados**. `*.env` e `.claude/*` são gitignored e não rastreados |

O bundle é entregue por `C:\Users\Public\rayzen-drop`, restrito por ACL a `marce`(RW) +
`RayzenExec`(R), e **apagado assim que o clone termina**. O passo 2 **audita o bundle abrindo-o**
— clona num temporário e procura `.env`, chave, credencial e `hook.config.mjs` — em vez de
confiar no `.gitignore`.

O trabalho volta por `C:\RayzenExec\outbox`, que `marce` lê (tem `R` na raiz). Mesmo contrato de
antes: bundle revisado pelo dono, nunca merge automático.

### Bloqueio medido: os passos 1 e 3 se separam por privilégio

`C:\RayzenExec` tem `marce:(OI)(CI)(R)` e owner `BUILTIN\Administradores`:

| tentativa como `marce` | resultado |
|---|---|
| criar `C:\RayzenExec\workspaces` | **negado** |
| escrever em `C:\RayzenExec\workspace` | **negado** |
| `Set-Acl` em `C:\RayzenExec` | **negado** — falta `SeSecurityPrivilege` |

Não há caminho sem elevação, e **dar escrita a `marce` ali enfraqueceria a separação que a conta
existe para ter**. Um script elevado, uma vez — e todo o resto sem elevação.

### Os quatro scripts

| # | script | quem roda | elevado |
|---|---|---|---|
| 1 | `rayzenexec-1-preparar-workspaces.ps1` | você | **sim, uma vez** |
| 2 | `rayzenexec-2-semear-bundle.ps1` | você | não |
| 3 | `rayzenexec-3-clonar-na-conta.ps1` | a **conta**, via `Start-Process -Credential` | não |
| 4 | `rayzenexec-4-testes-isolamento.ps1` | a **conta** | não |

ACL do passo 1: `SYSTEM(F)` · `Administradores(F)` · `marce(R)` · `RayzenExec(M)`, com
`/inheritance:r`. Os principais são resolvidos **por SID**, nunca por nome — mesma lição de
`d1ec7ff`, em que `Usuários` não era o que o script supunha. O script recusa continuar se
`BUILTIN\Usuários` ou `CodexSandboxUsers` sobrarem no resultado.

### Defeito meu na primeira execução do passo 1: elevado **não basta**

`New-Item` falhou com acesso negado mesmo com o script rodando elevado — o check de elevação
passou e a falha veio depois dele.

A causa: `criar-rayzenexec.ps1` rodou `/inheritance:r` em `C:\RayzenExec` e concedeu **somente**
`SYSTEM(F)`, `marce(R)` e `RayzenExec(M)`. **`BUILTIN\Administradores` ficou fora da DACL.** Um
token elevado carrega o grupo, mas a DACL não concede nada a ele; e ser *owner* dá `WRITE_DAC`,
**não** escrita de arquivo.

> Eu tinha esse `icacls` na tela ao escrever o script e li a ausência como ruído. É a mesma
> família de `d1ec7ff` (`New-LocalUser` não adiciona a grupo nenhum): **afirmar privilégio em vez
> de medi-lo.** A diferença é que aqui o `$ErrorActionPreference = 'Stop'` fez o script parar
> antes de mudar qualquer coisa — verificado depois: sem `workspaces`, raiz intocada.

O passo 1 agora detecta a ausência e se concede acesso usando o `WRITE_DAC` do owner, antes de
criar. **Não é poder novo:** `Administradores` já pode tomar posse de qualquer objeto. A ausência
apenas tornava a árvore não-administrável sem `takeown` — inclusive para o rollback do plano.

### A bateria distingue três estados, não dois

`NEGADO` · `LEU` · **`INCONCLUSIVO`** (o alvo não existe). Importa porque `Test-Path` devolve
`False` para negado **e** para inexistente: um alvo que sumiu pareceria isolamento funcionando.
A lista de alvos é conferida por `marce`, que os enxerga, e só os existentes entram no teste —
mesma distinção estrutural dos invariantes do sistema.

### Executado em 09/09 — passos 1 a 4

| passo | resultado |
|---|---|
| 1 — `workspaces` com ACL explícita | ✅ `RayzenExec(M)` · `marce(R)` · `Administradores(F)` · `SYSTEM(F)`, **sem `Usuários`, sem `CodexSandboxUsers`** |
| 2 — bundle + auditoria | ✅ 779 arquivos, zero credencial, restrito por ACL no canal |
| 3 — clone dentro da conta | ✅ `HEAD 1e88672`, branch `main`, **owner do clone: `RayzenExec`** |
| 4 — bateria de isolamento | **3 falhas**, todas pré-existentes (abaixo) |
| canal `Public` | ✅ esvaziado depois do clone |

**Bateria — 9 de 12:**

```
OK     roda como RayzenExec              OK     escreve no workspace autorizado
OK     NAO esta em Administradores       OK     workspace sem segredo
OK     negado  ~\.ssh\id_ed25519         OK     ambiente: 0 vars TOKEN/SECRET/KEY
OK     negado  ~\.claude\.credentials    OK     claude 2.1.266 responde na conta
OK     negado  ~\Projects                FALHA  LEU  ~\Projects\rayzen-ai\.env
OK     negado  ~\rayzenexec-senha.txt    FALHA  LEU  ...\hooks\hook.config.mjs
                                         FALHA  LEU  ~\Desktop
```

### O achado: esconder o pai não protege o filho

`C:\Users\marce\Projects` foi **negado**. `C:\Users\marce\Projects\rayzen-ai\.env`, dentro dele,
foi **lido**.

Não é contradição: o Windows concede *Bypass traverse checking* (`SeChangeNotifyPrivilege`) a
todos por padrão, então abrir um caminho absoluto **não exige permissão nos diretórios
intermediários**. A conta não consegue *listar* `Projects`, mas alcança qualquer arquivo dentro
dele cuja própria ACL permita.

> Isso condena a premissa do move de 09/09 por um motivo mais forte do que o já registrado. Ainda
> que `Move-Item` tivesse recalculado o DACL, a lição permanece: **a proteção precisa estar no
> objeto, não no caminho até ele.** Mover para um pai protegido nunca foi um mecanismo de
> proteção — era um mecanismo de ocultação.

As 3 falhas são exatamente as ACEs residuais já mapeadas (`BUILTIN\Usuários:(I)(M)` no repo, ACE
explícito no `Desktop`). **Não são regressão deste desenho** — são o defeito que ele
deliberadamente não toca, por decisão sua de 09/09.

### Testes 1 e 2 do plano — executados em 09/09

**Teste 1 — o Claude responde na conta, e a sessão do dono sobrevive.** ✅

| | |
|---|---|
| login | feito por você, interativo, dentro da conta. `~/.claude` próprio, nada copiado |
| `claude -p "responda apenas: ok"` | respondeu `ok` — versão 2.1.267 |
| sessão do dono durante a chamada | **1 → 1 processo**, nada caiu |

> **O risco dominante do plano não se materializou.** A dúvida registrada em "6. Riscos" era se a
> assinatura permite duas contas de SO ao mesmo tempo; o sintoma previsto era a sessão do dono
> cair. Duas sessões rodaram simultaneamente sem conflito. Medido comparando o número de
> processos do agent **antes e depois** — olhar só o resultado do outro lado não veria a queda.

**Teste 2 — os 22 do `validar-fase-1a-windows.mjs` sob a conta: 19 ok · 3 falhas.**

As 3 são o mesmo caso, e **nenhuma é de segurança**:

```
FALHA | notify benigno / subexpressao / unicode travessao
        E_ACCESSDENIED em [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier
OK    | canario continua ausente apos notify     <- o teste que mede segurança PASSOU
```

`ToastNotificationManager` é WinRT e exige **sessão interativa com shell**. A conta é disparada
por `Start-Process -Credential`, sem `explorer.exe` e sem sessão de logon — medido: `query user`
lista só `marce`. A API recusa antes de qualquer coisa acontecer.

> A distinção é a mesma dos invariantes: **o helper não executou o payload, apenas não conseguiu
> desenhar na tela.** O canário ausente é a evidência, e ele é justamente o teste que separa "não
> rodou" de "não apareceu". Sem ele, três `E_ACCESSDENIED` seriam indistinguíveis de três bypasses.

**Consequência para a Fase 4-B:** se o `supervised_session` migrar para a conta, `notify` **não
funciona** nesse modo. A saída natural é o agent do dono notificar em nome dela — quem fala com o
usuário já é quem tem a sessão gráfica. Manter uma sessão interativa logada só para o toast
trocaria uma limitação cosmética por uma conta permanentemente logada.

### O canal de volta, exercitado ponta a ponta

A conta alterou um arquivo no próprio clone, commitou e entregou o trabalho como `git bundle`
em `C:\RayzenExec\outbox`. O dono verificou e inspecionou **sem mesclar**:

```
conta  → commit 9b11cdf  autor: RayzenExec <rayzenexec@localhost>
       → bundle incremental 1e88672..HEAD  (0,9 KB)
dono   → bundle verify: okay
       → fetch para refs/rayzenexec/20260909-212408
       → diff: docs/decisions/roundtrip-rayzenexec.md | 7 +++++++
árvore do dono: HEAD 1e88672, branch main, arquivo AUSENTE — intocada
```

Duas escolhas de desenho que a execução confirmou:

**O bundle é incremental (`base..HEAD`), não completo.** Além de menor, é mais honesto: um bundle
completo "aplicaria" mesmo se as bases tivessem divergido, escondendo a divergência. O
incremental declara o pré-requisito e o `verify` do dono o checa contra o repositório dele.

**A entrega vira um ref isolado (`refs/rayzenexec/<carimbo>`), nunca um merge.** O trabalho fica
endereçável, revisável e descartável (`git update-ref -d`), e a árvore do dono não se move. É o
contrato do plano — *revisa e traz* — virando mecanismo em vez de disciplina.

> **Detalhe operacional:** com `marce:(RX)`, o dono **não consegue limpar o `outbox`** — só ler.
> Bundles acumulam até a conta ou um admin removerem. É consequência direta de "o dono não escreve
> na área da sessão", e o preço é uma limpeza que precisa ser pedida a quem tem `M`.

### Revisar o clone: `RX`, e por que o git ainda recusa

`marce:(OI)(CI)R` não permitia sequer **entrar** no diretório — sem o bit de *execute* não há
travessia, então `cd`, `git -C` e o Explorer falham com "Permission denied", embora ler um arquivo
por caminho absoluto funcione. Corrigido para `RX`, que continua sendo somente leitura.

O git então passou a recusar por outro motivo, e **esse fica**:

```
fatal: detected dubious ownership ... owned by: RayzenExec, current user is: marce
```

A sugestão do próprio git é `git config --global --add safe.directory`. **Não foi feito, por
decisão.** Essa proteção existe exatamente para este caso: se algo na conta escrever um
`.git/config` com hooks ou `core.fsmonitor`, o git rodando como **o dono** executaria aquilo.
Adicionar a exceção desfaria parte do isolamento recém-construído. O caminho para revisar o
trabalho da conta é o bundle no `outbox` — que já era o desenho.

## 2026-09-09 — o isolamento de arquivo passou a existir: 12 de 12

A decisão que estava em aberto foi tomada e executada: **cirúrgica + estrutural**.

### O que foi feito, na ordem — e a ordem importa

**1. `icacls <repo> /reset /T`** — 841.721 arquivos, 137 falhas (todas em `node_modules/.pnpm`,
caminho longo; nenhuma tocou arquivo de segredo).

```
antes:  3 SIDs orfaos (M,DC) · CodexSandboxUsers (M,DC) · BUILTIN\Usuarios (M, residual do Desktop)
depois: CodexSandboxUsers (I)(RX) · SYSTEM (F) · Administradores (F) · marce (F)
```

**2. `scripts/proteger-segredos-locais.ps1`** — 8 arquivos com herança removida
(`.env`, `.env.agent.local`, `.env.local`, `apps/agent/.env`, `apps/api/.env`,
`apps/web/.env.local`, `apps/widget/.env`, `hook.config.mjs`).

> **O reset vem primeiro, sempre.** Ele restaura a herança e apagaria o que o passo 2 aplicou.
> Fazer na ordem inversa produziria um "OK" completo com os segredos reabertos.

**3. `icacls Desktop /remove:g *S-1-5-32-545`** — o ACE `BUILTIN\Usuários:(OI)(CI)(M)` que dava
**Modify** a toda conta local sobre 310.837 arquivos, incluindo **6 `.env` de outros projetos**
(banco-imob, Ray Coach, Rayzen Commerce, VB-ferragens) e um `logins.txt` no topo.

O Codex **não quebrou**: ele tem ACE próprio (`CodexSandboxUsers:(OI)(CI)(RX)`) no Desktop,
independente do `Usuários`. Foi essa medição que tornou a remoção de baixo risco.

ACLs salvas antes de cada passo (`icacls /save`), reversíveis por `/restore`.

### Bateria final, medida pela conta

```
OK  roda como RayzenExec            OK  escreve no workspace autorizado
OK  NAO esta em Administradores     OK  workspace sem segredo
OK  negado  ~\.ssh\id_ed25519       OK  ambiente: 0 vars TOKEN/SECRET/KEY
OK  negado  ~\.claude\.credentials  OK  claude 2.1.267 responde
OK  negado  ~\Projects              OK  negado  ~\Projects\rayzen-ai\.env
OK  negado  ~\rayzenexec-senha.txt  OK  negado  ...\hooks\hook.config.mjs
                                    OK  negado  ~\Desktop
RESUMO: 0 falha(s)
```

Lado do dono verificado depois: agent e widget no ar, escrita no repo OK, git funcionando,
`pnpm --filter agent build` exit 0.

### Duas coisas que a execução ensinou

**A propagação de remoção é automática; a de ACE explícita não.** Remover `BUILTIN\Usuários` da
raiz do Desktop limpou os 310k descendentes sozinho, porque eles têm herança habilitada. Já as
ACEs **explícitas** do repo exigiram `/reset /T` — herança não as alcança, por definição.

**`icacls` não pode ser chamado pelo Bash desta máquina.** A primeira tentativa do reset devolveu
`Parametro invalido "C:/Program Files/Git/reset"`: o Git Bash aplicou conversão de caminho MSYS ao
argumento `/reset`. E saiu com **código 0** — o terceiro "sucesso" que não fez nada nesta sessão,
depois do `pnpm install` sem TTY e do `%PAUSA% & exit`.

> Três vezes no mesmo dia, o mesmo formato de mentira: **exit 0 sem trabalho feito.** É o motivo
> de cada passo aqui terminar verificando o estado, e não o código de saída.

### O que continua fora do escopo

`RayzenExec` **não** entra em `Administradores`. `~/.claude` **não** é copiado. O login do Claude
Code na conta é interativo e é seu; **se houver bloqueio de autenticação, eu paro e reporto** —
sem trocar por `ANTHROPIC_API_KEY`, que em modo `-p` prevalece sobre a assinatura e anularia a
intenção.

E o que este desenho **não** resolve: o `.env` do repositório em `C:\Users\marce\Projects` segue
legível por qualquer conta local. O isolamento aqui é o da **sessão**, que passa a rodar noutra
árvore. Fechar o repo do dono continua sendo decisão em aberto.

---

## 2026-09-11 — a migração: a sessão supervisionada passa a rodar na conta

O passo 6 da ordem de aprovação ("só então discutimos migrar o `supervised_session`") foi
executado. A **opção 1** do `supervised-session-auth-options.md` — login próprio da conta, mesma
assinatura — é a que está em uso, e o risco dominante dela já havia sido medido em 09/09: duas
contas de SO rodando ao mesmo tempo, sem a sessão do dono cair.

### O transporte foi medido antes de qualquer linha de implementação

Três propriedades do caminho novo eram suposição, e cada uma derrubava o desenho sozinha.
`scripts/rayzenexec-9-sondar-sessao.ps1` respondeu as três numa única ida à conta:

| pergunta | resposta medida |
|---|---|
| o perfil que a conta recebe é o dela? | sim — `C:\Users\RayzenExec`, `APPDATA` próprio |
| o dono lê o log **enquanto** a conta escreve? | sim — 10 tamanhos distintos, **zero** erro de compartilhamento |
| o prompt atravessa byte a byte por arquivo? | sim — SHA-256 idêntico, com acento e metacaractere |
| o código de saída volta? | sim, **por arquivo** |
| o marcador do protocolo sobrevive? | sim |
| `; && \| $(whoami)` no prompt é interpretado? | **não** — voltou literal |

A sonda reprovou duas vezes antes de medir alguma coisa, e os dois defeitos eram meus:
`Tee-Object` não aceita `-LiteralPath` no PowerShell 5.1, e meu parser do resultado usava
`[a-z_]+`, que não casa `prompt_sha256` por causa dos dígitos — o SHA chegava, a chave é que não
era lida. **Um sensor que nunca ficou vermelho não foi testado; um que fica vermelho por um
defeito próprio também não mediu nada.**

> **O achado que vale para qualquer log desta casa:** `Tee-Object` do PowerShell 5.1 não aceita
> `-Encoding` e grava **UTF-16**. Anexado a um arquivo criado em UTF-8, produz um arquivo com
> duas codificações dentro — que **cresce normalmente**, é legível ao vivo, e no qual nenhuma
> linha casa com o que se espera. A sonda acusou "0 de 8 linhas" com o arquivo cheio. Por isso o
> runner usa `Add-Content` linha a linha, que também garante que nunca há handle preso.

### O que foi construído

```
agent (como marce)
  └── sessao-isolada.ts ── execFile ──> sessao-isolada-lancar.ps1   (dono)
                                          └── Start-Process -Credential
                                                └── sessao-isolada-runner.ps1   (RayzenExec)
                                                      preparar · executar · entregar
```

| decisão | por quê |
|---|---|
| o prompt viaja por **arquivo**, e chega ao `claude` por splat de array | texto de terceiro nunca entra em linha de comando — é a regra de `executar-helper.ts` |
| as listas de ferramentas continuam **só** no TypeScript | cópia no `.ps1` seria duas listas divergindo, como `taskTypes` entre QA Scientist e invariantes |
| o canal público é fechado por ACL **antes** da primeira escrita | passa por lá um bundle de 21 MB com o repositório privado; restringir depois deixa janela |
| grupos internos por **SID**, nunca por nome | `BUILTIN\Usuários` se chama outra coisa em cada idioma |
| espera pela **marca**, nunca por `-Wait` | `-Wait` dá acesso negado em processo de outra conta — e dá **depois** de o trabalho terminar |
| `git clean -fd`, sem `-x` | `-x` levaria `node_modules` a cada sessão |
| o workspace da conta é **reposto** na base do dono a cada sessão | o clone estava **9 commits atrás** (base de 08/09); a sessão produziria patch contra um passado |

### Falha fechado, e ela foi vista vermelha

Com `AGENT_SESSAO_ISOLADA=true` e a conta indisponível, a sessão **para**. Não existe queda para
o usuário do dono: seria desfazer o isolamento justamente quando ninguém está olhando, com a
sessão reportando sucesso.

A guarda de canal aberto foi validada **reintroduzindo o defeito** — um diretório de trabalho com
`BUILTIN\Usuários:(OI)(CI)(RX)`:

```
O canal ...\sessao-VERMELHO-teste esta aberto a S-1-5-32-545. Nada foi enviado.
exit do lancador:         2
canal apagado sem enviar: True
a conta NAO foi acionada: True
```

> **E o primeiro vermelho encontrou outro defeito.** A guarda recusou certo, mas o processo saiu
> com **1**, não com o `2` que o script declara: `Write-Error` sob `$ErrorActionPreference =
> 'Stop'` encerra na hora, e o `exit` escrito depois **nunca roda**. Mesma família do
> `%PAUSA% & exit /b 1` do autostart, em que `rem` comia o `exit` da própria linha. Trocado por
> uma função `Parar` que escreve em stderr e sai com o código, com teste.

### Validação ponta a ponta — 12 de 12

`node scripts/validar-sessao-isolada.mjs` roda o caminho inteiro contra a conta real e confere o
**estado dos dois lados**, não o código de saída:

```
OK  a conta foi para a base do dono     c50a957 · ramo rayzen/sessao-34ccace5
OK  claude executou na conta            exit=0 · 18093 ms
OK  log atravessou a fronteira de conta
OK  marcador do protocolo voltou
OK  diff veio da conta                  docs/decisions/...md | 3 +++
OK  bundle produzido                    1 commit(s)
OK  bundle verify contra o repo do dono
OK  o trabalho esta enderecavel
OK  metacaractere sobreviveu literal
OK  HEAD do dono intacto                c50a957
OK  working tree do dono intacto        nenhum arquivo novo aqui
```

**A primeira execução reprovou em 1 de 12, e o defeito era de desenho, não de transporte:** o
diff do card de aprovação saía **vazio exatamente quando a sessão trabalhava bem**. O runner
fazia `git diff --stat HEAD` *depois* de o Claude commitar — e contra o próprio commit não há
diferença, nem sobra nada para `git status --short`. Com `Bash(git commit:*)` na lista de
permitidas, esse é o caminho comum, não a exceção.

> O conserto é comparar contra o **HEAD de antes da etapa**. E o mesmo defeito existia no modo
> **local** desde sempre, pelo mesmo motivo — `getGitDiff` também comparava contra `HEAD`.
> Corrigido nos dois, e de passagem `execSync` com string montada virou `execFileSync` com argv,
> então a linha sai da coluna "montada" de `docs/exec-paths.md`.

Duas medidas de operação que saíram da validação: `claude -p` **não emite progressivamente** —
devolve a resposta inteira num bloco só, no fim, então há um pedaço de log por iteração (vale
igual para o modo local, cujo agrupamento de 800ms sempre agrupou uma rajada única). E fechar o
stdin (`$null |`) tira os **3 segundos** que o CLI espera por entrada que nunca vem — 60s num
laço de 20 iterações.

### Como ligar, e o que fica de fora

```env
AGENT_SESSAO_ISOLADA=true      # qualquer outro valor mantém o regime local
```

O padrão continua **desligado**: o regime local é o que roda hoje, e ligar sem a conta pronta
para a sessão por desenho.

| fora do escopo | estado |
|---|---|
| `notify` dentro da conta | **não funciona** — WinRT exige sessão interativa com shell. Quem avisa é o agent do dono, que já tem a sessão gráfica |
| a senha da conta | o agent lê `rayzenexec-senha.txt` para montar a credencial. É o preço de não ter *"Log on as a batch job"*, que exige elevação. O caminho melhor é conceder o direito uma vez, elevado, e trocar isto por tarefa agendada — cuja credencial fica sob DPAPI da máquina |
| bundle completo por sessão | 21 MB, escritos e apagados. Incremental exigiria rastrear o HEAD da conta e tratar divergência; à toa diante de uma chamada de LLM de 15-20s |
| `C:\RayzenExec\logs` | acumula um trio de arquivos por etapa, e **o dono não apaga** — mesma limitação do `outbox`. A retenção de bundles (20 mais recentes) já nasceu do lado que tem `Modify`; a dos logs não existe ainda |
