# Validações — executado, limitado e pendente

Data: 13/09/2026 · HEAD `8293ab760287bb1670dfa20f7f7eb5ed1aad4856`. Este registro separa testes de comportamento, inspeções de implantação e cenários ainda não realizados. Não é um certificado de funcionamento ponta a ponta.

## 1. Controles da auditoria

- Checkout inicialmente limpo; testes sem atualização de snapshots, sem geração de relatório JUnit no repo e com cache Jest desabilitado.
- Chamadas de runtime limitadas a inspeção de processos/containers, Git, metadados de arquivo, agregações SQL de leitura e inspeção Redis com EVAL_RO. Nenhum conteúdo de conversa, documento pessoal ou valor de credencial foi incluído nos entregáveis.
- Scripts com ingestão, check/evaluate, geração de contexto, cron/QA, benchmark e memória não foram executados contra produção. Nomes de endpoints não foram usados como garantia de leitura.
- Em particular, V2 memory.search/context pode incrementar accessCount e promover classe; GET agent/session/:id/reply consome a resposta. Essas rotas foram excluídas.
- Não houve envio de Telegram, Claude real, navegador pessoal, mudança de ACL, restart, instalação ou deploy.
- P7 criou e removeu somente um repositório Git descartável sob TEMP, com caminho absoluto validado. Não tocou o Git do projeto real.

## 2. Testes existentes executados

### T1 — API V1: 11 suites, 163 testes aprovados

Comando executado da raiz (PowerShell):

```powershell
pnpm.cmd --filter api exec jest --runInBand --no-cache --reporters=default --runTestsByPath src/modules/agent-bridge/__tests__/agent-bridge.service.spec.ts src/modules/agent-bridge/__tests__/audit-log.service.spec.ts src/modules/execution/__tests__/execution.service.spec.ts src/modules/execution/__tests__/approval.service.spec.ts src/modules/execution/__tests__/approval.controller.spec.ts src/modules/orchestrator/__tests__/orchestrator.service.spec.ts src/modules/session/__tests__/session.service.spec.ts src/modules/memory/__tests__/memory.service.spec.ts src/modules/memory/__tests__/indexable-path.spec.ts src/modules/telegram/__tests__/vinculo-canal-projeto.spec.ts src/modules/telegram/__tests__/aviso-sem-projeto.spec.ts
```

Resultado: exit 0, 25,887 s reportados pelo Jest. Testes de componentes com mocks. O carregamento do Prisma emitiu aviso EPERM para arquivo .env protegido; não impediu as suites selecionadas e não foi contornado. Nenhuma conexão de produção foi necessária.

Comprova as propriedades cobertas nessas suites: filtragem/claim de fila, auditoria/autoria, execução, aprovação persistida e identidade, classificação de pedidos, sessões, memória/filtro de caminhos e associação Telegram/projeto. Não comprova que AgentSession.create usa a fila, que um erro de domínio vira failed, ou que duas interações Telegram pendentes são roteadas corretamente.

### T2 — API V2: comando com 12 suites selecionadas aprovado

```powershell
pnpm.cmd --filter api-v2 exec jest --runInBand --no-cache --silent --reporters=default --runTestsByPath src/gateway/__tests__/events.gateway.spec.ts src/context-engine/__tests__/context-engine.service.spec.ts src/memory/__tests__/memory.service.spec.ts src/memory/__tests__/memory-ranking.spec.ts src/memory/__tests__/memory-backfill.spec.ts src/mission/__tests__/step-executor.service.spec.ts src/workflow/__tests__/workflow-engine.service.spec.ts src/skill-engine/__tests__/skill-engine.service.spec.ts src/qa-scientist/__tests__/collect-failures.spec.ts src/qa-scientist/__tests__/run-experiment.spec.ts src/qa-scientist/__tests__/batimento-declara-fome.spec.ts src/benchmark/__tests__/run-for-strategy.spec.ts
```

Resultado: exit 0. O resumo com número de casos não ficou preservado no retorno truncado da ferramenta; não é apresentado um total inventado. Saída incluiu avisos ts-jest/allowJs e mensagens de falha esperada dos próprios cenários com mocks.

Cobertura escolhida: JWT/inscrição do WebSocket, contexto e falhas de seção, memória/ranking/backfill, recuperação/execução de steps, workflow e skills, sinal do Scientist e benchmark usando o prompt real do candidato. Não foram disparados experimentos ou promoções na instância real.

### T3 — PC Agent: 9 suites aprovadas; 2 bloqueadas no preparo de fixtures

A primeira tentativa encontrou EPERM ao indexar `hook.config.mjs` protegido pelo mapa de módulos Jest. Repetiu-se a seleção com exclusão desse arquivo na CLI, sem alterar permissões ou configuração versionada:

```powershell
pnpm.cmd --filter agent exec jest --runInBand --no-cache --silent --reporters=default --modulePathIgnorePatterns 'hook[.]config[.]mjs$' --runTestsByPath src/actions/__tests__/supervised-session-permissoes.spec.ts src/exec/__tests__/workspace-isolado.spec.ts src/actions/__tests__/terminal-workspace-isolado.spec.ts src/__tests__/poller-approved-by.spec.ts src/__tests__/executor-cobre-whitelist.spec.ts src/mcp/__tests__/escopo-leitura.spec.ts src/mcp/__tests__/token-por-consumidor.spec.ts src/exec/__tests__/aprovacao-no-agent.spec.ts src/exec/__tests__/decidir-capability-red.spec.ts src/exec/__tests__/sessao-isolada.spec.ts src/hooks/__tests__/hook-signal-quality.spec.ts
```

Resultado: 9 suites/171 casos aprovados; 2 suites/11 casos falharam no preparo, exit 1. As duas suites de fixture de repositório tentam criar diretórios sob `C:\Users\marce\Projects`, fora da raiz de escrita autorizada. EPERM no mkdir é seguido de falha de cleanup com caminho indefinido. Isso é bloqueio ambiental, não demonstra regressão nas assertions de isolamento.

Procedimento mínimo posterior: executar essas duas suites em um checkout descartável cujo ambiente de teste tenha diretório de fixtures gravável e isolado, ou ajustar especificamente o helper de fixture para usar tmpdir; então repetir apenas as duas suites. Não ampliar ACL do diretório pessoal para tornar testes verdes.

Comportamento adicional P7 foi verificado com fixture próprio em TEMP usando a função real de cleanup. Ele cobre justamente o caso sem commit que a suite existente não cobre.

### T4 — Doctor local de leitura

Resultado observado: referências/pastas, módulos pnpm e clientes Prisma disponíveis; duas falhas: ACL do .env do agent permite acesso do grupo de sandbox e dist anterior às fontes. A presença de AGENT_TOKEN/API foi checada sem imprimir valores. A configuração declara role desktop e modo de sessão isolada ligado. Nenhuma correção executada.

Não extrapolar: um flag true não comprova que a sessão percorre RayzenExec; nem que um processo antigo carregou o flag/novo código.

## 3. Experimentos isolados P1–P7

Os experimentos carregam o TypeScript real do HEAD via transpileModule e executam o código com dependências controladas. Não mudam fontes, não usam tokens e não chamam rede. O harness e os experimentos estão ao final deste documento para reprodução.

| ID | Pergunta resolvida | Método e resultado | Limite |
|---|---|---|---|
| P1 | Criar sessão chega ao dispatcher esperado? | AgentSessionService real com persistência/Telegram simulados: taskLog criado; par agent:jarvis:supervised_session, enquanto executor espera jarvis:supervised_session | Ausência de enqueue também verificada estaticamente; não é integração com Redis real |
| P2 | Um job processing volta a ser reclamado após restart? | AgentBridge real com job persistente simulado; primeiro claim processing; serviço novo retorna null mesmo com lock disponível | Reinício de instância e estado, não kill de processo Redis/agent |
| P3 | Resultado de domínio ok:false vira erro da tarefa? | Poller real com executor simulado retornando falha; PATCH enviado com status done | Não testa cada action, comprova a regra comum do poller |
| P4 | A conversa V2 sobrevive a nova instância? | Serviço real cria sessão; get no novo serviço não encontra ID | Não reiniciou produção; Map e compilado corroboram |
| P5 | Silêncio aprova etapa? | Loop supervisionado real; STEP_DONE, pollReply=null, depois DONE; segundo prompt contém APROVOU | Dependências de Claude/API substituídas; espera de 30 min abreviada |
| P6 | Texto sem marcador vira concluído? | Saída classificada noise, >50 caracteres; retorno ok=true e chamada complete | Não avalia qualidade de texto de modelo real |
| P7 | Cleanup preserva WIP sem commit? | Git real temporário: alterar tracked + criar untracked, chamar removerWorktree real; diretório e branch removidos | Demonstrou perda na fixture, não histórico de perdas no repositório real |

Saídas preservadas:

```json
{"probe":"P1_session_dispatch","taskLogs":1,"queueJobs":0,"producedKey":"agent:jarvis:supervised_session","expectedKey":"jarvis:supervised_session"}
{"probe":"P2_processing_restart","first":"processing","afterRestart":null,"lockAvailable":true}
{"probe":"P3_failure_result","result":{"ok":false,"error":"simulated failure"},"status":"done"}
{"probe":"P4_conversation_restart","lost":true}
{"probe":"P5_timeout_approval","approvalRequested":true,"continuedAsApproved":true}
{"probe":"P6_noise_completion","classification":"noise","resultOk":true,"completeCalled":true}
{"probe":"P7_worktree_dirty_cleanup","dirtyEntriesBefore":2,"dirRemovido":true,"branchRemovido":true,"uncommittedFilesRemain":false,"baseHeadUnchanged":true,"baseContent":"base"}
```

As reproduções são testes de diagnóstico, não correções. Não foram adicionadas como suites ao produto porque a solicitação autoriza somente os quatro documentos.

## 4. Runtime e implantação — observações de leitura

### R1 — servidor e build

Acesso SSH já disponível ao host de desenvolvimento/produção; Git, docker ps/inspect e leitura de artefatos compilados. Não foram impressos arrays completos de Environment, credenciais, logs de conversa ou payloads de trabalho.

- Checkout remoto no mesmo HEAD; `storage/` não versionado.
- 12 containers principais em execução. API, API V2, web e agent-server iniciados por volta de 04:11 UTC, MCP 04:13 UTC nesta data.
- Imagens em execução correspondem aos IDs das respectivas tags atuais. Labels OCI de revisão não estavam presentes nas imagens inspecionadas.
- JS implantado da API contém taskLog.create na criação supervisionada; V2 compilada contém sessions Map; poller compilado do agent-server contém approvedBy/aprovadoPor.
- V2 inicia com `migrate deploy; ... node`: há migração de boot, mas o shell permite continuar após falha. V1 usa &&.
- Coluna approved_by do audit log existe no banco. A presença do schema não prova trilha de aprovação completa em cada execução.
- Fontes selecionadas local/servidor com SHA-256 correspondentes:

| Arquivo | SHA-256 |
|---|---|
| apps/api/src/modules/agent-session/agent-session.service.ts | 2a08501f40f29626fdabca740097a0d703f02244b45c609321bb86b241db8376 |
| apps/api-v2/src/conversation/conversation.service.ts | 32eac1f4388bff9ff46a61ffad5f5ea53b90f9165fc0c99ad37a1f414564a42f |
| apps/agent/src/poller.ts | 8712ada9527f05230b2785ab458ed6efb617de3f3c6541c06b020efe1cd15d4c |
| infra/hermes/docker-compose.hermes.yml | 81b0f7a9e4b5570f326e4caa821786530637d025af6e5acf82281bdacad0cabd |

Amostra não equivale a build integral reproduzível. Estado do Git e markers compilados respondem perguntas diferentes.

### R2 — agregações PostgreSQL

Consultas somente de leitura, com contagens/status/datas, sem conteúdo:

| Entidade | Observação |
|---|---|
| documents | 2.090 |
| events | 22.587 |
| conversation_messages | 6.670 |
| test_runs | 225 |
| v2.memory_meta | 54 |
| agent_sessions | 5: 4 active, 1 completed |
| task_logs relacionados a sessão supervisionada | 5 pending desde junho, com module/action incompatível |
| skill_usage_logs | 169; última atividade 14/08 |
| v2.benchmark_results | 272; última atividade 23/08 |
| cost_records | 545; última atividade 24/08 |
| hipóteses Scientist | 63 |
| strategies | 2 active, 52 candidate |

São fotografias, não números esperados para teste de regressão. Não concluir falta de documentos pelos poucos MemoryMeta: a indexação V1 não cria necessariamente metadado V2.

### R3 — fila Redis

Leitura de jobs via EVAL_RO, sem claim, lock, ack ou update:

| data.status | Quantidade | Data mais recente observada nesse grupo |
|---|---:|---|
| processing | 3 | 17/06/2026, 23:18:06.598 UTC |
| done | 76 | 19/08/2026 |
| failed | 81 | 07/09/2026 |

Há tarefas presas apesar de locks curtos. O status é campo da aplicação dentro do job: não inferir recover/retry de Bull apenas de attempts/backoff definidos no enqueue.

### R4 — Windows, presença e isolamento

- Tarefa `Rayzen AI - Autostart`: instalada, estado Ready, trigger logon, principal Interactive, RunLevel Limited, action cmd.exe.
- Conta local RayzenExec existe e está Enabled.
- Agent local: PID observado 23328, início 12/09 às 19:34:21; artefato dist de 14:35:30, fontes do poller modificadas 20:20:52.
- Dois processos MCP locais iniciados em 09/09, antes dos commits de 12–13/09.
- ACL do .env do agent inclui permissão de modificação de CodexSandboxUsers; token presente. Nenhum token foi copiado, registrado ou usado.
- Modo isolado presente na configuração. Não foram lidas senhas nem executadas tarefas sob RayzenExec.

Consulta de presença reproduzível, sem mutação:

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -match 'Rayzen' } | Select-Object TaskName,State
Get-LocalUser -Name RayzenExec | Select-Object Name,Enabled
```

Detalhes de triggers/principal foram extraídos via objetos PowerShell e JSON para evitar a perda de colunas ao misturar tipos de saída.

### R5 — sinal recente do QA Scientist

Heartbeat observado em 13/09, 04:21:57 UTC: ciclos=10, semSinal=10, hipoteses=0. Na janela de sete dias consultada: zero mission steps failed/skipped nas fontes de sinal utilizadas, zero benchmarks de baixa fitness e zero trace errors.

Código de collectFailures lê essas fontes; não foi localizada consulta de TestRun V1 ou de traces reais Langfuse nessa coleta. Não foi disparado ciclo do Scientist. Ausência de sinal pode significar baixa utilização/instrumentação, não ausência de falhas no produto.

### R6 — persistência, backup e restauração

- PostgreSQL/Redis com volumes; Redis com AOF; Evidence com bind persistente.
- API V2 sem volume de sessão; document-processing V1 escreve PDFs em tmpdir.
- Agent-server tem repo montado somente leitura e docker.sock com escrita.
- Diretório de backups inspecionado contém seis arquivos parciais/manuais; mais recente de 05/09 relativo a policy_rules; também snapshots de documentos de 22/08 e Langfuse de 17/08.
- Crontab do usuário inspecionado: uma entrada ativa, sem identificação de rotina de backup. Root/systemd, serviços externos e destino fora do host não foram inventariados integralmente.
- Documento de migração descreve backup fora do host em agosto. Não foi executada restauração nem confirmada a vigência de toda essa rotina.

Conclusão precisa: há persistência e cópias parciais observadas; recuperação completa e RPO/RTO atuais permanecem inconclusivos.

### R7 — Hermes

- Container `rayzen-hermes-spike` parado, exit 137, OOMKilled=false.
- Comando sleep infinity; restart no.
- Volume nomeado montado somente em ~/.hermes/memories; configuração read-only.
- Compose atual declara token MCP próprio. No ambiente do container parado existente, a variável MCP_TOKEN_HERMES estava ausente (verificação booleana, sem valor de outros tokens).
- Config atual declara write_approval=true e include de nove ferramentas de consulta.

Não iniciado, reconfigurado ou chamado. Não atribuir o exit 137 automaticamente a falta de memória. A documentação upstream identifica state.db/sessões fora do diretório montado; a persistência local do spike não cobre retomada completa. [Documentação oficial de armazenamento](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage).

## 5. CI e diferença Windows/Linux

Metadados lidos com gh, sem reexecutar workflow:

| Revisão | Resultado observado | Fonte |
|---|---|---|
| 0089503 | failure | [run anterior](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34705641857) |
| 1ab4cde | success | [correção de fixtures Linux](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34732951628) |
| 8293ab7 | success | [run do HEAD](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34736558434) |

A hipótese de CI ainda quebrado na mesma revisão foi corrigida. O bloqueio de duas suites no sandbox Windows é uma condição diferente.

Limites da confiança no CI: build-smoke tem continue-on-error; checks curl podem terminar em echo sem falhar o job; QA ingest escreve no ambiente configurado. Não foi rodado o comando geral de QA contra produção. Um run verde não cobre os cenários de interação/queda listados abaixo.

## 6. Verificações não realizadas e procedimento mínimo

| Verificação | Por que não executada | Procedimento mínimo posterior |
|---|---|---|
| Chat real/modelos/fallback | Cria mensagens, custo e possivelmente memória | Stack de staging, corpus sintético, chaves de orçamento restrito, captura de modelo efetivo |
| Pergunta/aprovação Telegram | Envia mensagem e altera estado real | Bot/chat de teste, duas tarefas sintéticas e approvals vinculadas |
| Nova sessão Claude/RayzenExec | Executa código/LLM e cria artefatos | Repo descartável, conta isolada, escopo/critério explícitos; observar bundle e processo |
| Navegador/desktop | Abre apps e pode capturar conteúdo pessoal | Página fixture e perfil de navegador dedicado; desktop sem dados pessoais se necessário |
| Restart/kill/logout durante tarefa | Interrompe serviço/sessão em uso | Replica isolada da stack/agent e tarefa fixture com efeitos idempotentes observáveis |
| Relevância/correção de memória | Busca V2 pode escrever contadores; inserção/correção altera base | Snapshot anonimizado ou corpus sintético, ranking versionado e respostas avaliadas |
| Estudo por domínio demonstrado | Entidade/fluxo completo não localizado | Implementar caso mínimo de exercício/tentativa antes de afirmar aprendizado |
| Promoção/rollback estratégia | Altera comportamento e consome modelo | Casos golden congelados, baseline e candidato identificados, gate e restauração ensaiados |
| Backup/restore e recriação Hermes | Altera estado da stack/container | Destino separado; nenhum down/restore sobre volumes de produção |
| Voz PT-BR e quota atual | Áudio/rede/consumo; não necessário para inspeção | Frases sintéticas, consentimento de microfone no dispositivo de teste, teto de uso |
| Autorização uniforme API/MCP | Teste negativo pode disparar ação legada real | Executor fake sem efeitos e fixtures de identidade/escopo/args alterados |

## 7. Roteiro de aceitação ponta a ponta

Preparação: stack isolada, dois projetos fictícios A/B, duas conversas/canais de teste, repo fixture com teste determinístico, relógio controlável e executor que registra efeitos. Registrar revisão de código, versões dos serviços, taskId/attemptId/approvalId, base/commit, TestRun e hashes dos artefatos. Não usar credenciais nem corpus pessoal de produção.

| ID | Procedimento | Resultado obrigatório / evidência |
|---|---|---|
| E01 — onde parei | Inserir decisão confirmada, evento e pendência no projeto A; pedir retomada; trocar modelo e canal; repetir após restart | Mesma decisão vigente com fonte/data; pendência correta; falha de seção explícita; zero dados de B |
| E02 — delegação concorrente | Pedir alteração pequena; receber taskId; durante execução enviar conversa distinta e editar outro arquivo no checkout do dono | Resposta de conversa antes do fim; workspace separado; um executor por recurso; diff/bundle íntegro sem sobrescrever WIP |
| E03 — navegador e evidência | Em página fixture, executar assertion que passa e outra que falha; capturar screenshot/trace e TestRun | Estado reflete assertion; URL/commit/task/run associados; evidência acessível após recriação e pertinente à falha |
| E04 — celular correto | Criar duas perguntas de tarefas A/B; responder em ordem inversa; repetir mensagem; reiniciar canal antes da segunda | Só aprovação referenciada muda; replay sem efeito; projeto/tarefa expostos; ator vem da autenticação |
| E05 — silêncio/negação | Solicitar aprovação; expirar relógio; enviar “não pode”; depois tentar token vencido/args alterados | Zero execução adicional por silêncio/negação; expired/waiting explícito; autorização nova necessária para nova ação |
| E06 — queda e cancelamento | Interromper antes do claim, após claim, após efeito e antes do ack; reiniciar; cancelar durante subprocesso | Tarefa recuperável; efeito único ou recovery_required quando incerto; cancelamento para trabalho e preserva artefato parcial |
| E07 — corrigir/esquecer | Registrar informação v1; consultar; corrigir para v2; repetir com mesmo query e outros canais; excluir conforme política | Resposta usa v2 imediatamente; v1 superada; cache invalidado; escopo/índice/réplicas tratados; retenção de backup documentada |
| E08 — aprender estudando | Ensinar conceito, aplicar exercício com erro conhecido, registrar tentativa, repetir após restart | Próxima atividade ataca lacuna demonstrada; domínio não aumenta só por armazenar texto; fonte e critério da avaliação registrados |
| E09 — histórico longo | Conversar >20 mensagens; adicionar instrução que substitui anterior; reiniciar/reabrir sessão | Prompt efetivo usa janela recente/decisão vigente; histórico recuperável sem depender de Map |
| E10 — escopo e conteúdo hostil | Fonte exclusiva de A; consulta B/pessoal; documento contendo instrução de executar/alterar memória; arquivo de caminho sensível | Sem mistura automática de escopo, execução ou consolidação da instrução; consulta “readonly” não muda classe |
| E11 — melhoria verificável | Falha sintética de qualidade alimenta Scientist; comparar baseline/candidato nos mesmos casos; aprovar e simular falha de aplicação; reverter | pending/approved/applied distintos; efeito idempotente; consumo pelo chamador demonstrado; baseline recuperado |
| E12 — preservação/presença | WIP tracked/untracked em workspace; cleanup após sucesso/erro/cancelamento; alteração da base; login/logout/PC indisponível | WIP preservado e referenciado; conflito não aplicado silenciosamente; capability indisponível não anuncia sucesso |
| E13 — conclusão verdadeira | Executor retorna ok:false, exitCode não zero, teste falho, no tests e sucesso com prova | failed/not_run/completed_unverified/verified corretos; ruído ou HTTP 200 não promove estado |
| E14 — orçamento/fallback | Provedor retorna 429/erro; fallback elegível mais caro; orçamento esgotado; chamada sem metering | Teto aplicado antes do gasto; modelo efetivo/estimativa registrados; unknown não é zero; erro claro sem loop ilimitado |
| E15 — restauração | Backup sintético completo; restaurar em ambiente novo; recuperar conversa, tarefa esperando, memória e artefato | IDs/estados e hashes conferem; aprovação não consumida/recriada indevidamente; RPO/RTO medidos |
| E16 — casa futura | Adapter simulado, leitura de estado, ação reversível e repetição da mensagem; dispositivo sem resposta | Uma ação autorizada; feedback confirma estado; sem feedback não há “concluído” |

Critério do primeiro marco: E01–E07, E09 e E12–E13 aprovados no caminho escolhido; E03 inclui somente a capacidade de navegador declarada no piloto. E08/E11 pertencem à evolução profissional; E14/E15 devem preceder dependência operacional diária ampla; E16 é futuro.

## 8. Conferência dos entregáveis

Às 03:09:56 (UTC−03), HEAD permaneceu na revisão auditada; git diff --name-only não mostrou alterações em arquivos rastreados. git status --short --untracked-files=all listou apenas os quatro Markdown desta pasta. Foram conferidos os destinos e limites de linha das referências locais, os links entre documentos e o fechamento dos blocos de código; nenhuma referência local quebrada foi encontrada.

## 9. Código reproduzível dos experimentos

Executar a partir da raiz do checkout, com Node e TypeScript instalados pelo lockfile, alimentando cada bloco JavaScript separadamente ao stdin do Node. Se salvar o bloco, usar arquivo temporário fora do checkout. Os blocos não devem ser colados como comandos shell interpolados; preservar o texto literal. Não é necessário executar novamente para ler o diagnóstico.

### P1–P6 — dependências controladas, sem rede

```javascript

const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const root = process.cwd();
const common = { Injectable:()=>x=>x, Inject:()=>()=>{}, Optional:()=>()=>{}, Logger:class {log(){} warn(){} error(){}}, NotFoundException:Error, BadRequestException:Error };
function loadTs(path,deps={},extra='') {
  const exports={};
  const src=fs.readFileSync(path,'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:false,esModuleInterop:true}}).outputText;
  const safeRequire=name=>{
    if(name in deps) return deps[name];
    if(name==='@nestjs/common') return common;
    if(name==='@nestjs/bull') return {InjectQueue:()=>()=>{}};
    if(['crypto','path','os','fs','node:path','node:os','node:fs/promises'].includes(name)) return require(name);
    throw Error('Unexpected dependency: '+name);
  };
  vm.runInNewContext(js+'\n'+extra,{exports,require:safeRequire,Buffer,URL,console:{log(){},error(){},warn(){}},process:{env:{},cwd:()=>root},setTimeout,clearTimeout,setInterval,clearInterval},{filename:path});
  return exports;
}

(async()=>{
 const queued=[],rows=[],messages=[];
 const telegram={send:async x=>messages.push(x),setReplyHandler(f){this.handler=f},clearReplyHandler(){this.handler=null}};
 let sessionCounter=0;
 const db={agentSession:{create:async({data})=>({id:'session-'+(++sessionCounter),...data}),findUnique:async()=>({status:'waiting'}),update:async()=>({})},taskLog:{create:async r=>rows.push(r.data)}};
 const {AgentSessionService}=loadTs('apps/api/src/modules/agent-session/agent-session.service.ts');
 await new AgentSessionService(db,telegram).create('audit-project','audit prompt');
 console.log(JSON.stringify({probe:'P1_session_dispatch',taskLogs:rows.length,queueJobs:queued.length,producedKey:rows[0].module+':'+rows[0].action,expectedKey:'jarvis:supervised_session'}));
 const {AgentBridgeService}=loadTs('apps/api/src/modules/agent-bridge/agent-bridge.service.ts');
 const job={id:'audit-task',data:{id:'audit-task',status:'pending',targetRole:'desktop'},update:async function(data){this.data=data}};
 const queue={getJobs:async()=>[job],client:{set:async()=> 'OK'}};
 const bridge=new AgentBridgeService(queue);
 const first=await bridge.claimTask('desktop');
 const afterRestart=await new AgentBridgeService(queue).claimTask('desktop');
 console.log(JSON.stringify({probe:'P2_processing_restart',first:first.status,afterRestart,lockAvailable:true}));
 const patches=[];
 const task={id:'audit-task',module:'jarvis',action:'supervised_session',payload:{},status:'processing'};
 const {poll}=loadTs('apps/agent/src/poller.ts',{'axios':{create:()=>({post:async()=>({data:task}),patch:async(url,body)=>patches.push(body)})},'./executor':{executeTask:async()=>({ok:false,error:'simulated failure'})}});
 await poll();
 console.log(JSON.stringify({probe:'P3_failure_result',result:patches[0].result,status:patches[0].status}));
 const {ConversationService}=loadTs('apps/api-v2/src/conversation/conversation.service.ts');
 const llm={chat:async()=>({content:'{}'}),extractJson:()=>({reply:'audit',readyToExecute:false})};
 const deps=[llm,{build:async()=>({text:''})},{},{}];
 const svc=new ConversationService(...deps);
 const response=await svc.message('audit-project','audit prompt');
 let lost=false;
 try{new ConversationService(...deps).get(response.sessionId)}catch{lost=true}
 console.log(JSON.stringify({probe:'P4_conversation_restart',lost}));
 const sup=loadTs('apps/agent/src/actions/supervised-session.ts',{
   child_process:{spawn:()=>{throw Error('No real spawn allowed')},execFileSync:()=>{throw Error('No real git allowed')}},
   '../exec/sessao-isolada':{modoIsoladoLigado:()=>false},
   '../exec/workspace-isolado':{criarWorktree:async()=>null,removerWorktree:async()=>({})},
 },'exports.auditHooks=h=>{runClaude=h.runClaude;apiPost=h.apiPost;pollReply=h.pollReply;headAtual=()=>"";getGitDiff=()=>""}; exports.analyzeOutput=analyzeOutput;');
 let prompts=[],posts=[];
 sup.auditHooks({runClaude:async p=>{prompts.push(p);return prompts.length===1?'Etapa A [[RAYZEN:STEP_DONE]]':'[[RAYZEN:DONE]]';},apiPost:async(p,b)=>{posts.push({p,b});return{}},pollReply:async()=>null});
 await sup.supervisedSession({sessionId:'audit-session',prompt:'audit',projectPath:'audit-no-files'});
 console.log(JSON.stringify({probe:'P5_timeout_approval',approvalRequested:posts.some(x=>x.b.requiresApproval),continuedAsApproved:prompts[1].includes('APROVOU')}));
 posts=[];
 const noise='abcdefghijklmnopqrstuvwxyz '.repeat(3);
 sup.auditHooks({runClaude:async()=>noise,apiPost:async(p,b)=>{posts.push({p,b});return{}},pollReply:async()=>null});
 const result=await sup.supervisedSession({sessionId:'audit-session',prompt:'audit',projectPath:'audit-no-files'});
 console.log(JSON.stringify({probe:'P6_noise_completion',classification:sup.analyzeOutput(noise).type,resultOk:result.ok,completeCalled:posts.some(x=>x.p.endsWith('/complete'))}));
})().catch(e=>{console.error(e);process.exitCode=1});

```

### P7 — somente repositório descartável, função real de cleanup

Este teste provoca perda de WIP exclusivamente na fixture para demonstrar o comportamento. O ambiente filho isola a configuração Git do usuário; o cleanup verifica o diretório absoluto antes de remover a fixture.

```javascript

const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const root = process.cwd();
const common = { Injectable:()=>x=>x, Inject:()=>()=>{}, Optional:()=>()=>{}, Logger:class {log(){} warn(){} error(){}}, NotFoundException:Error, BadRequestException:Error };
function loadTs(path,deps={},extra='') {
  const exports={};
  const src=fs.readFileSync(path,'utf8');
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:false,esModuleInterop:true}}).outputText;
  const safeRequire=name=>{
    if(name in deps) return deps[name];
    if(name==='@nestjs/common') return common;
    if(name==='@nestjs/bull') return {InjectQueue:()=>()=>{}};
    if(['crypto','path','os','fs','node:path','node:os','node:fs/promises'].includes(name)) return require(name);
    throw Error('Unexpected dependency: '+name);
  };
  vm.runInNewContext(js+'\n'+extra,{exports,require:safeRequire,Buffer,URL,console:{log(){},error(){},warn(){}},process:{env:{},cwd:()=>root},setTimeout,clearTimeout,setInterval,clearInterval},{filename:path});
  return exports;
}

const path=require('node:path'), os=require('node:os'), cp=require('node:child_process');
const tempBase=fs.realpathSync(os.tmpdir());
const auditRoot=fs.mkdtempSync(path.join(tempBase,'rayzen-jarvis-audit-'));
const repo=path.join(auditRoot,'repo');
fs.mkdirSync(repo);
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:auditRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(auditRoot,'no-global-config')};
function git(args,cwd=repo){const r=cp.spawnSync('git',args,{cwd,env,encoding:'utf8',shell:false});if(r.error)throw r.error;return{code:r.status,stdout:r.stdout,stderr:r.stderr};}
function must(args){const r=git(args);if(r.code)throw Error(r.stderr);return r.stdout.trim();}
(async()=>{
try {
 must(['init','-q']);
 fs.writeFileSync(path.join(repo,'tracked.txt'),'base\n');
 must(['add','tracked.txt']);
 must(['-c','user.name=Audit','-c','user.email=audit@example.invalid','commit','-qm','fixture']);
 const before=must(['rev-parse','HEAD']);
 const wtmod=loadTs('apps/agent/src/exec/workspace-isolado.ts',{
 './executar-programa':{ambientePadrao:()=>env,executarPrograma:async(_strategy,program,args,opts)=>{if(program!=='git')throw Error('Only git fixture allowed');return git(args,opts.cwd);}},
 os:{tmpdir:()=>auditRoot},
 });
 const wt=await wtmod.criarWorktree(repo,'audit007');
 if(!wt||!path.resolve(wt.dir).startsWith(auditRoot+path.sep))throw Error('Fixture outside temporary audit root');
 fs.writeFileSync(path.join(wt.dir,'tracked.txt'),'UNCOMMITTED CHANGE\n');
 fs.writeFileSync(path.join(wt.dir,'untracked.txt'),'NEW UNCOMMITTED FILE\n');
 const beforeStatus=git(['status','--porcelain'],wt.dir).stdout.trim().split('\n').length;
 const result=await wtmod.removerWorktree(repo,wt);
 console.log(JSON.stringify({probe:'P7_worktree_dirty_cleanup',dirtyEntriesBefore:beforeStatus,...result,uncommittedFilesRemain:fs.existsSync(path.join(wt.dir,'untracked.txt')),baseHeadUnchanged:must(['rev-parse','HEAD'])===before,baseContent:fs.readFileSync(path.join(repo,'tracked.txt'),'utf8').trim()}));
} finally {
 const resolved=fs.realpathSync(auditRoot);
 if(path.dirname(resolved)!==tempBase||!path.basename(resolved).startsWith('rayzen-jarvis-audit-'))throw Error('Unsafe cleanup root');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
})().catch(e=>{console.error(e);process.exitCode=1});

```
