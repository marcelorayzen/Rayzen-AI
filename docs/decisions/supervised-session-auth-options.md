# Autenticação da sessão supervisionada — opções para a Fase 4-B

> ## ✅ DECIDIDO E EXECUTADO — **opção 1**, em 2026-09-11
>
> `RayzenExec` tem **login próprio** do Claude Code, feito interativamente dentro da conta, na
> **mesma assinatura**. Nenhum `~/.claude` foi copiado, nenhuma credencial foi movida ou
> compartilhada, e **nenhuma `ANTHROPIC_API_KEY` entrou em lugar nenhum**.
>
> **A pergunta que travava a decisão foi respondida medindo, não deduzindo.** Ela era: a
> assinatura permite duas contas de SO logadas ao mesmo tempo? O sintoma previsto era a sessão
> do dono cair. Medido em 09/09 comparando o número de processos do agent **antes e depois** da
> chamada na outra conta — `1 → 1`, nada caiu. Olhar só o resultado do outro lado não veria a
> queda.
>
> A migração da sessão foi executada em 11/09 e validada ponta a ponta (12/12). Registro em
> [`rayzenexec-preparacao.md`](rayzenexec-preparacao.md); a fase, em
> [`../plano-execucao-tipada.md`](../plano-execucao-tipada.md).
>
> O texto abaixo é o da decisão, preservado como estava — inclusive os avisos que se
> confirmaram.

---

## O que trava a Fase 4-B

O isolamento da sessão supervisionada — usuário dedicado, perfil próprio, workspace restrito — é
técnico e conhecido. O que trava não é isso: **a sessão usa o `~/.claude` do usuário atual para
autenticar o Claude Code.** Uma conta `RayzenExec` sem esse diretório não autentica, e copiá-lo é
compartilhar credencial entre contas.

Portanto a fase depende de **como `RayzenExec` obtém a própria autenticação** — e isso é decisão
de produto, não de engenharia.

### O que está no disco hoje (medido, não inferido)

```
%USERPROFILE%\.claude\.credentials.json     ← credencial de login
%USERPROFILE%\.claude.json                  ← configuração de usuário
```

`~/.claude` no Windows é `%USERPROFILE%\.claude`, e **`CLAUDE_CONFIG_DIR` reloca** "settings,
session history, and plugins" para outro lugar ([settings](https://code.claude.com/docs/en/settings)).

> ⚠️ **A documentação consultada não afirma que `CLAUDE_CONFIG_DIR` reloca as credenciais de
> login** — ela lista settings, histórico e plugins. Tratar isso como "logo, dá para apontar a
> sessão para um diretório de credenciais separado" seria inferência, e é exatamente o tipo de
> suposição que esta casa já pagou caro. **Precisa ser medido antes de virar plano.**

### Sobre a API key, o que a doc diz literalmente

> "When set, this key is used instead of your Claude Pro, Max, Team, or Enterprise subscription
> even if you are logged in. In non-interactive mode (`-p`), the key is always used when present."
> — [env-vars](https://code.claude.com/docs/en/env-vars)

Dois fatos que decidem as opções 3 e 4:

1. **`ANTHROPIC_API_KEY` sobrescreve a assinatura**, mesmo logado.
2. **Em modo `-p` — que é o modo do `supervised_session` — ela é sempre usada quando presente.**
   Não há prompt, não há escolha em runtime.

---

## Opção 1 — `RayzenExec` com login próprio, **mesma conta Claude**

`RayzenExec` roda `claude login` e autentica na **mesma conta** do dono, gerando credencial
própria no perfil dela. Nada é copiado; cada conta faz seu login.

| | |
|---|---|
| **Claude Code** | compatível — é o fluxo normal de login |
| **Remote Control** | compatível em tese; **não medido** nesta configuração |
| **Custo / plano** | ⚠️ **A questão inteira.** Não sei se o plano permite duas sessões/contas de SO simultâneas na mesma assinatura. Isso é termo de uso, não detalhe técnico — **precisa ser confirmado com a Anthropic antes de decidir**, não deduzido |
| **Credenciais** | duas credenciais independentes, cada uma no perfil da sua conta; nenhuma compartilhada |
| **`supervised-session`** | muda o `cwd`/perfil do spawn; a lógica não muda |
| **Risco residual** | se o plano não permitir, a sessão pode ser desconectada sem aviso — e o sintoma seria a sessão falhar em silêncio, que é o modo de falha desta casa |
| **Rollback** | remover a conta; a sessão volta a rodar como o dono (regime atual) |
| **Como validar** | logar em `RayzenExec`, rodar `claude -p "diga ok"` **como ela**, e confirmar que a sessão do dono **continua funcionando ao mesmo tempo** — é a simultaneidade que está em dúvida, não o login |

---

## Opção 2 — `RayzenExec` com **conta Claude separada**

Assinatura própria para a conta de execução.

| | |
|---|---|
| **Claude Code** | compatível, sem ambiguidade de termos |
| **Remote Control** | compatível; sessões aparecem sob outra identidade — o que é o ponto |
| **Custo / plano** | **assinatura adicional** |
| **Credenciais** | totalmente separadas; comprometer a sessão não alcança a conta do dono |
| **`supervised-session`** | igual à opção 1 |
| **Risco residual** | baixo no eixo de credencial. O custo é operacional: duas contas para manter, e o histórico da sessão fica fora do seu |
| **Rollback** | cancelar a assinatura; a sessão volta ao regime atual |
| **Como validar** | igual à 1, sem a dúvida de simultaneidade |

---

## Opção 3 — `RayzenExec` com **API key própria** (headless)

`ANTHROPIC_API_KEY` no ambiente de `RayzenExec`, sem login por assinatura.

| | |
|---|---|
| **Claude Code** | compatível **em modo `-p`**, que é exatamente o modo do `supervised_session`. A doc é literal: em `-p` a chave é sempre usada quando presente |
| **Remote Control** | ⚠️ **não é o caminho.** Remote Control pressupõe uma sessão vinculada a uma conta; API key é execução avulsa. Se a sessão precisar aparecer no Remote Control, esta opção não serve |
| **Custo / plano** | pago por uso, separado da assinatura — orçamento previsível e **cortável** |
| **Credenciais** | uma variável de ambiente. **Contradiz a allowlist da Fase 4**, que hoje não repassa credencial nenhuma: seria a primeira exceção nomeada, e precisa entrar como tal |
| **`supervised-session`** | o `ambienteMinimo()` ganharia `ANTHROPIC_API_KEY` — e só ela |
| **Risco residual** | chave de longa duração no ambiente de um processo que roda código de terceiros. Mitigável com chave de escopo/orçamento próprios e rotação, **não eliminável** |
| **Rollback** | remover a variável; a sessão para de autenticar e fica desabilitada — falha fechada, que é o lado certo |
| **Como validar** | com a chave no ambiente e **sem** `~/.claude`, `claude -p "diga ok"` deve responder; e o painel de custo da API deve registrar o consumo separado |

> **Combinação que merece atenção:** opções 1 ou 2 **mais** a 3 é contraditória. Com
> `ANTHROPIC_API_KEY` presente, o modo `-p` **ignora a assinatura** — pagar-se-ia a assinatura e
> consumiria a API. Se as duas coexistirem, é a chave que vale.

---

## Opção 4 — manter o usuário atual, com mitigação (**regime de hoje**)

Sem conta dedicada. A sessão roda como o dono, com o que já foi entregue em 08/09.

| | |
|---|---|
| **Claude Code** | funciona hoje |
| **Remote Control** | funciona hoje |
| **Custo / plano** | zero |
| **Credenciais** | `ambienteMinimo()` não repassa nenhuma; leitura de `.env`, `*.pem`, `id_ed25519`, `hook.config.mjs`, `.ssh`, `.aws`, `.claude` negada; `cat`/`type`/`more` fora da allowlist |
| **`supervised-session`** | inalterado |
| **Risco residual** | **não é isolamento.** O processo roda como o dono: mesmo disco, mesma rede, mesmas credenciais em arquivo. As negações reduzem superfície e podem ser contornadas por um caminho que ninguém enumerou — que é a premissa que este projeto inteiro está trabalhando para abandonar |
| **Rollback** | não se aplica; é o estado atual |
| **Como validar** | já validado: 22/22 no Windows real em 08/09 — **mas como o mesmo usuário**, nunca sob conta dedicada |

---

## Recomendação

Alinhada com a sua, e com um ajuste de ordem:

1. **Não compartilhar o `~/.claude`.** Em nenhuma opção. Copiar credencial entre contas é o
   defeito que a Fase 4-B existe para eliminar.
2. **Preferir login separado dentro de `RayzenExec`** — opção 1 se o plano permitir, opção 2 se
   não permitir.
3. **API key só para headless**, quando o Remote Control não for necessário. E entrando na
   allowlist como **exceção nomeada**, nunca por um spread.
4. **`supervised_session` sem autonomia de alto risco até a decisão** — é o estado atual e fica.

**O que decide entre 1 e 2 é uma pergunta que eu não posso responder:** se a assinatura permite
duas contas de SO logadas simultaneamente. Confirmar isso com a Anthropic é o próximo passo, e é
mais barato que qualquer implementação.

> **Ordem sugerida:** confirmar o termo → se permitir, opção 1; se não, escolher entre pagar a
> segunda assinatura (2) ou aceitar headless sem Remote Control (3). A opção 4 continua válida
> como regime intermediário — desde que ninguém a chame de isolamento.

---

## Estado congelado enquanto se decide — *resolvido, mantido para comparação*

- Fase 1-A **mantida e validada** (22/22 no Windows real, 08/09)
- ~~Nenhuma sessão movida para `RayzenExec`; nenhum usuário criado~~ → conta criada em 09/09,
  sessão migrada em **11/09**, atrás de `AGENT_SESSAO_ISOLADA=true`
- Migração das demais capabilities **não iniciada** — segue verdade
- `run_command` de risco alto **bloqueado sem aprovação humana** criada no servidor
- ~~**Os testes dos helpers ainda NÃO foram executados sob conta dedicada**~~ → executados em
  09/09 sob `RayzenExec`: **19 de 22**. As 3 falhas são o mesmo caso e **nenhuma é de
  segurança**: `ToastNotificationManager` é WinRT e exige sessão interativa com shell, que a
  conta não tem. O teste que mede segurança — *"canário continua ausente após notify"* —
  **passou**, e é justamente ele que separa "não rodou" de "não apareceu"

> **A consequência prevista aqui se confirmou e virou desenho:** `notify` não funciona dentro da
> conta. Quem avisa o usuário é o agent do dono, que já tem a sessão gráfica. Manter uma sessão
> interativa logada só pelo toast trocaria uma limitação cosmética por uma conta permanentemente
> logada.
