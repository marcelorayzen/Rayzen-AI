# Continuidade — estado para a próxima sessão

Última atualização: 13/09/2026 · pacote 1.0 refinado para **2.0** com medição local.

## 1. Estado atual, verificado

| campo | valor |
|---|---|
| HEAD / branch | `ae7dc0bfe526a039a930f9d40b276fd61ab02d4b` / `main` |
| Working tree no início | limpo |
| Delta desde a revisão auditada (`8293ab7`) | **somente documentação** — zero arquivos de código |
| Trabalho preexistente a preservar | nenhum |
| Caminho canônico de tarefa | **decidido por evidência**: `AgentSession` (trabalho longo) + `Task`/Bull (ação pontual). `TaskLog` é código morto — um escritor, zero leitores |
| Projeto piloto | fixture descartável com teste determinístico (padrão do pacote, mantido) |
| Perfil/versão efetiva do Hermes | **v0.21.2 (2026.9.11)**, container `Up`, MCP `rayzen` enabled com 9 ferramentas |
| Canal de teste | não escolhido |
| Autorizações operacionais | **concedida uma**: gerar `MCP_TOKEN_HERMES` e recriar `mcp-http` + Hermes (13/09, explícita) |

**Trabalho feito nesta sessão:** revalidação B0 por leitura e medição local; inventário X0;
refinamento do plano; **H0 executado e aprovado** no servidor.

**Mutações de produção realizadas** (todas autorizadas, todas reversíveis):

| o quê | reversão |
|---|---|
| `MCP_TOKEN_HERMES` gerado e acrescentado ao `.env` do servidor | backup íntegro em `.env.bak-20260913-160005`; revogar = apagar a linha e recriar `mcp-http` |
| `mcp-http` recriado | nenhuma mudança de imagem ou config além da variável nova |
| container `rayzen-hermes-spike` recriado com `--build` | imagem `hermes-hermes:latest` reconstruída; spike isolado, compose separado |

Nenhum código de produto alterado, nenhum commit. O valor do token nunca apareceu em output, log
ou documento.

## 2. Documentos

| arquivo | o que é |
|---|---|
| [B0-REVALIDACAO.md](B0-REVALIDACAO.md) | o que foi medido: delta, reconferência dos P0, achado novo em A02, X0 vazio, decisões resolvidas |
| [PLANO-REFINADO.md](PLANO-REFINADO.md) | a sequência revisada, blocos com arquivos reais, critérios reduzidos a seis |
| [auditoria de 13/09](../../audits/2026-09-13-jarvis/) | os quatro originais, preservados sem alteração |

O pacote de continuidade original (`README`, `DIRECAO-E-DECISOES`, `PLANO-DE-TRABALHO`,
`CRITERIOS-DE-ACEITE`, `CONTINUIDADE`, `PROMPTS-VSCODE`) **ainda não foi copiado para o
repositório**. A visão de produto e o catálogo C01–C20 vivem lá; este refinamento os referencia
pelo nome, não por link.

## 3. Quadro de progresso

| Bloco | Estado | Evidência | Próxima ação |
|---|---|---|---|
| **B0** | **concluído** | [B0-REVALIDACAO.md](B0-REVALIDACAO.md) | — |
| **X0** | **concluído — resultado vazio** | nenhum conector n8n/WhatsApp/CRM no monorepo | X1 é construção do zero; fora do primeiro marco |
| **H0** (novo) | **✅ aprovado — validado no servidor** | [H0-RESULTADO.md](H0-RESULTADO.md): Hermes v0.21.2 chamou o MCP por decisão própria, devolveu os 10 projetos reais e `stage: building` (confere com o hook); `9 × [MCP] acesso de "hermes"` no log | H1 — fixar versão, migrar schema da config, medir o que sobrevive à recriação |
| **R1** | **✅ preparado localmente** | [R1-RESULTADO.md](R1-RESULTADO.md): A01/A02/A04 corrigidos; 3 specs novas (51 casos), todas vermelhas antes pelo motivo certo; **suíte do agent 48/48 · 629/629**; typecheck limpo | revisar e commitar; depois R2 |
| **R2** | **✅ preparado localmente** | [R2-RESULTADO.md](R2-RESULTADO.md): `enqueue()` separado de `dispatch()`, sessão enfileira de verdade, `task_logs` sai, diretório vem do `projectId` com recusa. 14 casos novos, 7 vermelhos antes | revisar e commitar; **rebuildar o agent desktop** (roda do `dist/`) |
| **R3.a** | **✅ preparado localmente** | [R3-RESULTADO.md](R3-RESULTADO.md): A06 (callback global → estado persistido, handler por chat/tópico) e A07 (janela pegava as 20 PRIMEIRAS mensagens). 22 casos novos · api 49 suites / 539 testes | revisar e commitar |
| **R3.b** | **✅ preparado localmente** | [R3-RESULTADO.md §6-9](R3-RESULTADO.md): lock virou lease renovado (60s TTL, 20s de renovação, dono identificado); órfã vira `failed` explícita e **não é re-executada**. 13 casos novos · api 50/548 · agent 50/639 | revisar e commitar |
| **H1** | **✅ preparado localmente** | [H1-RESULTADO.md](H1-RESULTADO.md): só `memories/` era persistido **e estava vazio**; `state.db`, sessões, credenciais e config se perdiam a cada recreate. Código e Node saíram de `~/.hermes` (1,9 GB → 52 MB) e o volume passou a cobrir o estado inteiro. **C08 validado com retomada real** | aplicar no spike (roda layout antigo) |
| **H2 — identidade** | **✅ preparado localmente** | [IDENTIDADE.md](IDENTIDADE.md): identidade conversacional em `infra/hermes/SOUL.md`, bind `:ro` (cópia na imagem não serve — o volume de H1 a mascararia). **Carregamento verificado** com regra observável; 5,5 KB chegam inteiros. Rastreabilidade frase↔mecanismo, com o que **não** tem lastro declarado | publicar junto com o deploy |
| **H2 — consultas** | **✅ preparado localmente** | [H2-RESULTADO.md](H2-RESULTADO.md): escopo e isolamento **funcionam** (medido); mas o objetivo vinha do `description` de cadastro (obsoleto desde 09/08), `/state` devolvia `200 null` para id inexistente, e `getDecisionEvents` da V2 vazava escopo por camelCase. 14 casos novos | retestar contra o Hermes **depois** do deploy — `mcp-http` não entra no webhook |
| I1 | não iniciado | — | — |
| X1 / L1 / Operação | planejados | — | — |

Estados válidos: `não iniciado`, `em andamento`, `bloqueado`, `preparado localmente`,
`validado em teste`, `implantado`, `validado em produção`. Nunca porcentagem subjetiva.

## 3.1 Implantado em 14/09 — R1…R3, H0…H2 e identidade

Push de `f30c610` (8 commits), deploy automático, e os dois rebuilds manuais que o webhook não
cobre. **Validado em produção, não presumido:**

| verificação | resultado |
|---|---|
| containers × imagens | ✅ todos recriados, mais novos que as imagens, healthy (13 no ar) |
| **R3.b — jobs órfãos** | ✅ `processing` **3 → 0**; `failed` 81 → 84. Os três presos desde **17/06** foram podados com motivo explícito |
| **H2 — erro ≠ vazio** | ✅ `/projects/<id inexistente>/state` devolve **404** (era `200 null`) |
| **H2 — fonte vigente** | ✅ perguntado o objetivo, o Hermes respondeu o **vigente** e declarou a fonte (`rayzen_get_goal`). Antes vinha do `description` de cadastro, obsoleto |
| **H1 — layout** | ✅ `~/.hermes` = 52 MB só de estado; código em `/opt/hermes/agent` |
| **Identidade** | ✅ *"Sou o Rayzen…"* — SOUL de 5.546 bytes montado `:ro` |
| pin do Hermes | ✅ `local 422bc9bd` — o `upstream` já era `5eb99eb2`, **a quinta versão diferente** desde ontem |
| invariantes | ✅ **15/15 ok**, zero falha |

`mcp-http` e o Hermes exigiram `up -d --build` manual (compose separado / fora da lista do
webhook), sempre depois de conferir que o `rayzen-deploy.sh` não estava rodando.

**Falta só do lado da máquina de trabalho:** `rayzen-start.bat`, para o agent desktop pegar R2 e
R3.b — ele roda do `dist/` e é quem executa `supervised_session`.

## 4. Próximo passo

H0 e R1 estão fechados; a dívida de configuração do Hermes foi corrigida e validada.

**Antes de qualquer bloco novo, duas coisas a decidir:**

1. **Commit do trabalho local.** Nada foi commitado. São 8 arquivos: 3 de código, 3 de teste, o
   `config.yaml`/`Dockerfile` do Hermes, mais `docs/exec-paths.md` regenerado e os documentos
   deste pacote. Lembrar que **push em `main` publica** — o webhook dispara build e deploy.
2. **Aplicar a config corrigida no spike do Hermes**, que ainda roda a imagem sem pin e o schema 0.

**Depois disso:**

- **R2** — `enqueue()` sem espera, `AgentSession` como trabalho canônico, fim da escrita em
  `TaskLog`. Agora liberado: a ordem exigia R1 primeiro, e R1 está feito.
- **H1 (resto)** — medir o que sobrevive à recriação do container (`hermes sessions` contra o
  volume, que monta só `~/.hermes/memories`). Depois C08/C09.

**Achado deixado em aberto:** três suítes do agent criam fixtures em `~/Projects` e não limpam;
`workdir.spec.ts` falha de forma não-determinística por causa do lixo acumulado. Detalhe em
[R1-RESULTADO.md](R1-RESULTADO.md). As 9 fixtures órfãs foram movidas para o scratchpad da sessão,
não apagadas.

## 5. Registro por sessão

```text
Data e responsável:
Pedido autorizado nesta sessão:
HEAD/branch inicial e final:
Trabalho preexistente preservado:
Bloco e achados afetados:
Arquivos alterados:
Decisões e justificativas (de Marcelo / escolha técnica no escopo delegado — dizer qual):
Testes executados e evidências:
Testes bloqueados/não realizados e motivo:
Implantação e runtime: não alterados / descrição autorizada:
Riscos e caminhos ainda não cobertos:
Próximo passo exato:
```

## 6. Encerramento sem perda de contexto

Não depender da memória do chat. Ao terminar uma rodada, atualizar este arquivo e os critérios
afetados. Não marcar A01–A17 como resolvidos em bloco: indicar escopo, revisão e prova por achado.
Um `done`, um CI verde ou um heartbeat não comprovam que o objetivo humano foi cumprido.
