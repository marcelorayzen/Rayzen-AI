# Auditoria técnica e funcional — Rayzen AI

Data: 13/09/2026 · responsável pela decisão de produto: Marcelo · natureza: investigação, sem implementação.

Documentos relacionados: [matriz de capacidades](MATRIZ-CAPACIDADES.md), [plano de evolução](PLANO-EVOLUCAO.md), [validações e aceitação](VALIDACOES.md).

## 1. Diagnóstico executivo

O Rayzen é hoje uma plataforma própria de contexto, memória pesquisável, acompanhamento de projetos e ferramentas de execução, com interfaces web, Telegram e integrações com o trabalho do Claude. Existem mecanismos úteis de autorização, isolamento, missões, QA e experimentação. A plataforma já guarda atividade real; isso não demonstra que uma solicitação delegada percorra todas essas etapas corretamente.

Para o uso imaginado por Marcelo, o principal problema é **a continuidade do contrato entre as etapas**. A criação de sessão supervisionada não chega à fila consumida; a aprovação pode ser inferida do silêncio; o executor pode informar falha e a tarefa acabar marcada como concluída; a limpeza do worktree pode apagar alterações sem commit. Corrigir apenas o primeiro elo ativaria um caminho com outros defeitos críticos.

A base de contexto deve ser aproveitada. A memória ainda precisa distinguir fato confirmado, inferência, decisão vigente e telemetria; correções não invalidam todos os contextos já montados. Existem conversas persistidas na V1, mas a sessão conversacional da V2 vive em memória do processo. Ter documentos armazenados não equivale a lembrar corretamente, nem a acompanhar aprendizado demonstrado.

**Recomendação:** fortalecer o runtime atual como autoridade de tarefas, aprovações, memória e evidências; manter modelos e executores substituíveis. O primeiro produto diário deve ser uma única tarefa de projeto, rastreável desde a aceitação até um artefato verificado, com conversa independente, aprovação vinculada à tarefa e recuperação após queda. Hermes pode ser avaliado como interface/runtime de diálogo conectado a essa autoridade. O experimento encontrado não justifica entregá-la a ele agora.

Confiança alta nos defeitos reproduzidos e nos elos rastreados no código; moderada sobre a experiência cotidiana completa, que não foi exercitada com novas tarefas ou mensagens em produção.

## 2. Escopo, revisão e método

- Checkout: `C:\Users\marce\Projects\rayzen-ai`; branch `main`.
- HEAD analisado: `8293ab760287bb1670dfa20f7f7eb5ed1aad4856`.
- Início registrado: 13/09/2026, 01:46:59, UTC−03. As observações seguintes são fotografias desta madrugada, não monitoramento contínuo.
- Estado inicial: `git status --porcelain` vazio. Aviso de acesso ao ignore global do Git, sem alteração local reportada.
- Referência anterior: `0089503d22c009a762f0acd39be9fd8893f34a4b`. Foram examinados os cinco commits posteriores, inclusive workspace por invocação, autoria da aprovação, deploy e escopo MCP por consumidor.
- Ambiente local: Windows/PowerShell, Node 22.22.2, pnpm 10.33.2.
- Instruções: busca por AGENTS nas raízes aplicáveis; leitura de CLAUDE.md, instruções locais pertinentes, apps/web/AGENTS.md e documentos de arquitetura, protocolo, execução tipada, congelamento, memória e operação.
- Ações: leitura de código/configuração não secreta, testes com dependências simuladas, experimento Git descartável, inspeções locais e consultas remotas de leitura. Não foram executados chat, memória/contexto V2, benchmark, missão, aprovação ou QA ingest em produção.
- As únicas entregas no checkout são os quatro Markdown desta pasta. Nenhuma correção, commit, push, deploy, reinicialização ou mudança de permissão foi feita.

### Como interpretar as evidências

**D** = documento/proposta; **C** = código; **I** = produtor e consumidor conectados; **T** = teste nesta auditoria; **R** = observação de runtime ou registro persistido. Um registro `done` ou `completed` comprova o estado gravado, não a qualidade do resultado.

Referências `caminho:linha` correspondem ao HEAD acima. P1–P7 são experimentos descritos integralmente em VALIDACOES.md. R1–R7 identificam as observações remotas/locais registradas no mesmo documento. “Não encontrado” limita-se aos locais e chamadores pesquisados.

## 3. Implantação e uso observados

| Camada | Evidência atual | O que permite concluir | Limite |
|---|---|---|---|
| Git do servidor | Mesmo HEAD; status com `?? storage/` | Checkout remoto acompanha a revisão | Não garante que todo processo carregou cada fonte |
| Containers principais | 12 em execução; API, V2, web, agent-server e MCP recriados nesta madrugada | Serviços implantados estão presentes | Saúde de processo não é aceite funcional |
| Imagens | IDs em execução iguais aos IDs das tags atuais; sem label OCI de commit | Não havia divergência entre container e tag inspecionada | Não há atestado completo fonte → build |
| Código implantado | Fontes selecionadas com SHA-256 local/remoto iguais; JS compilado contém produtor incorreto da sessão, Map V2 e autoria no poller do servidor | Defeitos centrais não são apenas de uma branch esquecida | Amostragem de arquivos, não hash completo das imagens |
| PC Agent | Processo local iniciado em 12/09, 19:34; dist anterior a fontes modificadas depois | Processo existente não comprova execução das últimas mudanças locais | Não reiniciado nem exercitado |
| MCP local | Dois processos iniciados em 09/09 | Há consumidores persistentes locais | Atualizar arquivo não recarrega automaticamente processo |
| Atividade | 2.090 documentos; 22.587 eventos; 6.670 mensagens; 225 TestRuns | Há captura e uso persistido reais | Sem inspeção de conteúdo pessoal ou auditoria de qualidade desse corpus |
| Sessões/fila | Cinco sessões supervisionadas: quatro active, uma completed; cinco task_logs relacionados pending; três jobs processing desde junho | Caminho supervisionado e recuperação exigem reparo | O completed histórico não é comprovação de execução verificável |
| Hermes | Container separado parado, exit 137, OOMKilled=false, comando sleep infinity | Spike não é o assistente ativo | Motivo do sinal de término não determinado |

## 4. Mapa dos componentes e responsabilidades reais

| Componente | Papel e integração encontrada | Maturidade demonstrada / limite |
|---|---|---|
| Web Next.js | Chat SSE V1; projeto, sessões, missões, memória, evidências e gates V2 | Código integrado; requisição de chat bloqueia o input enquanto responde |
| API V1 | Orchestrator, projetos/estado, eventos, Brain/Memory, Wiki, QA, Telegram, Execution e AgentBridge | Principal infraestrutura persistente utilizada |
| API V2 | Context Engine, memória tipada, conversa, missões/steps/workflow, skills, specialists, gates, custos, benchmarks | Integrações parciais; múltiplos motores e estados distintos |
| PostgreSQL + pgvector | Histórico, documentos vetoriais e entidades V1/V2 | Persistência real; não oferece por si só verdade, escopo ou recuperação de tarefa |
| Redis + Bull v4 | agent-tasks, locks, caches; Redis com volume e AOF | Fila usa status dentro de job.data; não usa o ciclo de worker Bull para recuperação |
| PC Agent | Polling, whitelist, ações locais, hooks/watcher, Claude novo, RayzenExec | Ferramentas implementadas; PC e sessão do Windows são dependências relevantes |
| Agent-server | Executor de ações de servidor | Em execução; socket Docker com acesso de escrita, autoridade elevada a controlar por capacidade |
| RayzenExec | Conta Windows separada, workspace próprio, transporte por Git bundle e entrega revisável | Código e conta habilitada; execução completa não repetida nesta auditoria |
| MCP stdio/HTTP | Consultas e escritas explícitas; escopo HTTP por consumidor | Escopo de leitura testado; ferramentas de contexto ainda podem causar escrita interna de memória |
| Claude no VSCode | Trabalho atual de desenvolvimento; hooks enviam eventos/contexto ao Rayzen | Rayzen observa sinais disponíveis, não controla a sessão existente do editor |
| Sessão supervisionada | Loop que inicia `claude -p`, interpreta marcadores e pede respostas via API/Telegram | Caminho de entrada quebrado e decisões de segurança incorretas |
| LiteLLM/Ollama/provedores | Modelos por alias, fallback, inferência e embeddings | Modelo externo/local substituível; não é identidade nem memória do Rayzen |
| QA + Evidence V1 | Ingestão de relatórios, TestRun, evidências em storage persistente | Reutilizar associação ao TestRun já existente; vínculo por caso ainda é outro nível |
| QA Scientist/Evolutionary | Sinais, hipóteses, casos golden, comparação de prompts, promoção com gate | Laboratório implementado e histórico; nenhum sinal útil recente na janela observada |
| Hermes | Spike separado, LiteLLM e nove ferramentas MCP de consulta | Configurado como experimento; sem gateway pessoal persistente comprovado |
| Sentinel | Ideia presente no contexto/research | Implementação autônoma não localizada; não presumir serviço local ou app no celular |

Fontes principais: [apps/web/app/hooks/useChatStream.ts:130](../../../apps/web/app/hooks/useChatStream.ts#L130); [apps/api/src/modules/agent-bridge/agent-bridge.service.ts:11](../../../apps/api/src/modules/agent-bridge/agent-bridge.service.ts#L11); [apps/agent/src/executor.ts:35](../../../apps/agent/src/executor.ts#L35); [apps/agent/src/exec/sessao-isolada.ts:240](../../../apps/agent/src/exec/sessao-isolada.ts#L240); `docker-compose.yml`; [infra/hermes/docker-compose.hermes.yml:13](../../../infra/hermes/docker-compose.hermes.yml#L13).

## 5. Fluxos rastreados

### 5.1 Conversar, recuperar contexto e planejar

Web → `POST /orchestrate/stream` com `sessionId/projectId/workMode` → Orchestrator V1 → histórico PostgreSQL + contexto do projeto + pesquisa Memory → modelo via LiteLLM → SSE + persistência das mensagens. A extração posterior pode inserir memória inferida da fala do usuário.

Telegram mantém associação persistida entre canal/tópico e projeto/sessão; isso é diferente do callback global para uma pergunta pendente. V2 oferece conversa → contexto → proposta de execução → Router/Mission, mas guarda o objeto de conversa em Map.

Identidade efetiva: prompts dos serviços, modo de trabalho, contexto recuperado e ferramentas permitidas. [core/identity/SOUL.md:8](../../../core/identity/SOUL.md#L8) descreve intenção de produto; sua declaração de que Claude governa toda inteligência não corresponde a todos os caminhos atuais. Não foi localizado carregador automático desse SOUL nem dos arquivos `core/skills/*.skill.md` nesses runtimes.

Trocar o modelo pode preservar IDs/dados externos ao modelo, mas não resolve perda da sessão V2, janela histórica errada ou roteamento entre canais. Fontes: [useChatStream.ts:137](../../../apps/web/app/hooks/useChatStream.ts#L137); [orchestrator.service.ts:819](../../../apps/api/src/modules/orchestrator/orchestrator.service.ts#L819); [conversation/conversation.service.ts:52](../../../apps/api-v2/src/conversation/conversation.service.ts#L52); [telegram.service.ts:132](../../../apps/api/src/modules/telegram/telegram.service.ts#L132).

### 5.2 Delegação normal versus sessão supervisionada

Caminho normal: intenção `jarvis/action` → ExecutionService → verificação de executor online → enqueue agent-tasks → AgentBridge claim → PC/server poller → whitelist/ação → PATCH status → evento/evidência quando aplicável.

Caminho supervisionado atual: Orchestrator → AgentSessionService.create → AgentSession + **taskLog**, sem enqueue. O par produzido é `agent / jarvis:supervised_session`; o dispatcher exige `jarvis / supervised_session`. O contrato também precisa transportar o projeto resolvido, sua pasta e o identificador da tarefa. Código disponível nas duas pontas não constitui integração.

O ExecutionService espera até 30 s e então lança erro; não cancela a execução nem entrega uma referência recuperável nessa saída. O poller considera promessa resolvida como done, mesmo com `ok:false`. A cadeia não tem uma transição obrigatória “artefato entregue → validação observada”.

Fontes: [execution.service.ts:70](../../../apps/api/src/modules/execution/execution.service.ts#L70); [agent-session.service.ts:14](../../../apps/api/src/modules/agent-session/agent-session.service.ts#L14); [agent-bridge.service.ts:33](../../../apps/api/src/modules/agent-bridge/agent-bridge.service.ts#L33); [apps/agent/src/poller.ts:54](../../../apps/agent/src/poller.ts#L54); P1–P3.

### 5.3 Missão V2 e aprovação

Conversa V2 → Router → Mission/Steps → Workflow ou StepExecutor → SkillEngine/Specialist → V1/executor. Existem IDs de projeto, missão e etapa, mas `SkillEngine.dispatchToAgent` envia somente action e input: IDs do envelope não são propagados automaticamente.

Há três políticas diferentes: confirmação textual do chat, ApprovalGate V2 e autorização persistida V1 para execução tipada. Na V1, argumento/ator/recurso são vinculados à autorização e o consumo é único. Na V2, gate de skill depende de missionId/stepId, aprovação reutilizada não vincula novo input por hash, e o approvedBy vem do corpo recebido. Não há uma política única cobrindo todas as ações legadas.

StepExecutor marca passos running como failed no boot para permitir retomada. Essa recuperação parcial **não** recupera os jobs processing da fila do PC. Interrupção de specialist é cooperativa no próximo ciclo, não demonstra término de subprocesso ou reversão de efeitos.

Fontes: [skill-engine.service.ts:41,159](../../../apps/api-v2/src/skill-engine/skill-engine.service.ts#L41); [approval-gates.service.ts:193](../../../apps/api-v2/src/approval-gates/approval-gates.service.ts#L193); [approval-gates.controller.ts:15,65](../../../apps/api-v2/src/approval-gates/approval-gates.controller.ts#L15); [apps/api/src/modules/execution/approval.service.ts:36,96](../../../apps/api/src/modules/execution/approval.service.ts#L36); [mission/step-executor.service.ts:25](../../../apps/api-v2/src/mission/step-executor.service.ts#L25); [specialists/specialist.service.ts:135](../../../apps/api-v2/src/specialists/specialist.service.ts#L135).

### Contratos existentes entre as etapas

| Fronteira | Schema/IDs atuais | Lacuna rastreada |
|---|---|---|
| Fila → agent | [packages/types/src/index.ts:2](../../../packages/types/src/index.ts#L2): pending/processing/done/failed; Task com id, module, action, payload, targetRole, datas e resultado | Não há cancelled, waiting ou verified nesse contrato; campos de tarefa/aceite não são obrigatórios dentro do payload |
| Chat → sessão supervisionada | [apps/api/src/modules/agent-session/agent-session.controller.ts:1](../../../apps/api/src/modules/agent-session/agent-session.controller.ts#L1) e service: projectId/prompt → sessionId | Session ID e task ID não estão conectados por enqueue real |
| V2 → V1 dispatch | [apps/api-v2/src/skill-engine/skill-engine.service.ts:159](../../../apps/api-v2/src/skill-engine/skill-engine.service.ts#L159): action + payload=req.input | projectId/missionId/stepId do envelope não seguem automaticamente |
| Executor → persistência | [apps/agent/src/poller.ts:65](../../../apps/agent/src/poller.ts#L65): status e result; evento posterior best effort | Resultado não tem schema de sucesso funcional obrigatório ou transação com evidência |
| Evidência → QA | [apps/api/src/modules/evidence/evidence.service.ts:51](../../../apps/api/src/modules/evidence/evidence.service.ts#L51): testRunId explícito ou associação recente; metadados no evento | Vínculo com task/caso não é obrigatório; associação heurística pode não provar qual execução produziu a imagem |

### 5.4 Captura do trabalho do Claude e memória

Hooks filtram sinais, enviam eventos de ferramentas e, no encerramento, síntese/checkpoint e turnos V2. O watcher observa alterações de arquivos. São observações do trabalho; um arquivo alterado não demonstra intenção, decisão aprovada ou resultado correto. [event/event.controller.ts:11](../../../apps/api/src/modules/event/event.controller.ts#L11) classifica certos arquivos de instrução/ADR como decisão pela origem.

Abrir VSCode chama o CLI `code`. A sessão supervisionada inicia outro processo Claude e recompõe contexto entre iterações; não retoma automaticamente a sessão já aberta por Marcelo. Isso precisa ficar explícito na interface para que duas instâncias não trabalhem inadvertidamente no mesmo recurso.

Fontes: `apps/agent/src/hooks/rayzen-hook.mjs`; [apps/agent/src/workspace-watcher.ts:206](../../../apps/agent/src/workspace-watcher.ts#L206); [apps/agent/src/actions/open-vscode.ts:13](../../../apps/agent/src/actions/open-vscode.ts#L13); [supervised-session.ts:342](../../../apps/agent/src/actions/supervised-session.ts#L342).

## 6. Memória: inventário de leitura, escrita e governança

Inventário dos caminhos identificados por busca de chamadores, controllers, hooks e MCP. Abrange os ingressos observados no monorepo; não atesta a inexistência de scripts externos.

| Caminho | Escrita / leitura real | Escopo, revisão e risco |
|---|---|---|
| Memory V1: texto, arquivo, URL, GitHub e Notion | indexDocument e helpers; search/context/list/delete | checksum por projeto; sem projeto, search abrange todos; exclusão não invalida todos os caches |
| Brain V1: texto/URL/documentos | Segundo indexador e busca sobre documents; cache Redis | Mesmo armazenamento, regras de invalidação diferentes; não é outra base independente |
| Orchestrator: conversa | Histórico + busca; extração automática para memoria/auto | Inferência do LLM vira entrada sem revisão/contradição explícita |
| Hooks CLI → Events | Evento operacional; captura de arquivo com replaceBySourcePath | Substituição limita-se ao caminho CLI previsto; filtro de segredos não cobre todos os ingressos |
| Workspace watcher | POST /memory/index com conteúdo do arquivo e origem | Não passa replaceBySourcePath; versões diferentes podem coexistir |
| Wiki / Blueprint / QA V1 | Captura de aprendizado, indexação de fonte e padrões de falha | Wiki.importSource chama Brain sem projeto nesse caminho; confirmar escopo antes de expandir uso pessoal |
| V2 Memory.store | V1 indexContent + upsert MemoryMeta | Duas escritas não transacionais; metadados tipados e classe têm regras distintas |
| V2 Conversation | persistTurn, indexSession, indexConversation | Conteúdo acumulado não substitui persistência da sessão Map |
| DocumentationEngine / MissionResult | Memory.store de documentação/resultado | Pode perpetuar a classificação incorreta de uma execução |
| ContextEngine / V2 search | Busca vetorial, ranking por modo/tipo, classes, seleção e cache | trackAccess escreve contador e promove inbox→working após três acessos |
| MCP | search_memory usa Brain V1; get_context usa ContextEngine V2; escritas explícitas via ferramentas próprias | Token readonly bloqueia ferramentas de escrita; get_context pode alcançar trackAccess da memória V2 |
| Hermes | Memória própria em arquivos; consulta Rayzen por MCP | write_approval configurado no spike; não encontrado sincronizador bidirecional de fatos |

Fontes: [apps/api/src/modules/memory/memory.service.ts:77,155,289,383](../../../apps/api/src/modules/memory/memory.service.ts#L77); [brain/brain.service.ts:79,173](../../../apps/api/src/modules/brain/brain.service.ts#L79); [wiki/wiki.service.ts:128,397](../../../apps/api/src/modules/wiki/wiki.service.ts#L128); [blueprint/blueprint.service.ts:262](../../../apps/api/src/modules/blueprint/blueprint.service.ts#L262); [qa/qa.service.ts:211](../../../apps/api/src/modules/qa/qa.service.ts#L211); [event/event.controller.ts:152](../../../apps/api/src/modules/event/event.controller.ts#L152); [apps/api-v2/src/memory/memory.service.ts:129,189,320,338](../../../apps/api-v2/src/memory/memory.service.ts#L129); [conversation.service.ts:220,255,282](../../../apps/api-v2/src/conversation/conversation.service.ts#L220); [documentation-engine.service.ts:61](../../../apps/api-v2/src/documentation-engine/documentation-engine.service.ts#L61); [mission-result.service.ts:68](../../../apps/api-v2/src/mission/mission-result.service.ts#L68).

Há separação útil por projectId, origem, tipo, modo e classe. **Não foi localizado um modelo completo de domínios pessoal/profissional/estudos com autorização e política de recuperação independente**, nem histórico de supersessão de fatos, vigência, contradições resolvidas e propagação de exclusão a todas as cópias/contextos.

A classe “consolidated” não significa aprovação humana: decisões/constraints podem nascer nessa classe. A promoção por acesso mede uso, não verdade. Correções por novo texto podem coexistir com a versão anterior; o cache ContextEngine de cinco minutos não inclui include/maxTokens na chave e não é invalidado automaticamente por todas as mutações. O modo architecture não inclui memory_relevant por padrão, apesar de haver ranking de memória para modos de trabalho.

Conteúdo externo entra como referência, mas não foi encontrada uma fronteira sistemática que impeça instruções contidas em documentos de influenciar ações. Os filtros de caminhos sensíveis da captura CLI são proteção útil e localizada. Para memória confiável, exigir origem, escopo, status epistemológico, versão vigente e separação entre referência e autorização.

O estudo N1 anterior mede recuperação em dez consultas; a própria documentação corrigiu sua interpretação de precisão. Não houve nova medição de relevância nesta auditoria e nenhuma porcentagem histórica é apresentada como qualidade atual. Fonte: [docs/memoria-n1-baseline-precisao.md:340](../../../docs/memoria-n1-baseline-precisao.md#L340).

## 7. Achados priorizados

P0: barreira antes de ativar delegação; P1: impede uso diário confiável; P2: evolução/operabilidade. Prioridade é de desenvolvimento, não alegação de exploração externa.

| ID / prioridade | Evidência e conclusão | Impacto para Marcelo | Confiança e limite |
|---|---|---|---|
| A01 / P0 | [workspace-isolado.ts:75,81](../../../apps/agent/src/exec/workspace-isolado.ts#L75), P7: remove --force destruiu alterações tracked sem commit e arquivo novo; branch também removida | Trabalho delegado pode desaparecer na limpeza | Alta, reprodução com Git real em repositório temporário; não demonstra perda já ocorrida no projeto real |
| A02 / P0 | [supervised-session.ts:497–518](../../../apps/agent/src/actions/supervised-session.ts#L497), P5: ausência de resposta entra no ramo APROVOU; regex também aceita “não pode” | Silêncio/negação podem permitir continuação | Alta; timeout simulado sem esperar 30 min, mesma decisão de código |
| A03 / P0 | [agent-session.service.ts:14–38](../../../apps/api/src/modules/agent-session/agent-session.service.ts#L14), [executor.ts:117](../../../apps/agent/src/executor.ts#L117), P1 e R2 | Pedido de sessão parece aceito, mas não alcança o executor | Alta, código + produção; enfileirar sozinho é correção insuficiente |
| A04 / P0 | [poller.ts:65](../../../apps/agent/src/poller.ts#L65), P3; [supervised-session.ts:559](../../../apps/agent/src/actions/supervised-session.ts#L559), P6; [skill-engine.service.ts:80](../../../apps/api-v2/src/skill-engine/skill-engine.service.ts#L80) | Erro/ruído pode virar conclusão e depois aprendizado | Alta, reproduções isoladas; logs históricos de sucesso exigem revalidação |
| A05 / P1 | [agent-bridge.service.ts:33–63](../../../apps/api/src/modules/agent-bridge/agent-bridge.service.ts#L33), P2/R3; [apps/agent/src/index.ts:13](../../../apps/agent/src/index.ts#L13) | Queda deixa tarefa processing; ticks concorrentes podem disputar recursos | Alta para estado preso; concorrência inferida do código, sem teste de carga |
| A06 / P1 | [telegram.service.ts:28,57,370–400](../../../apps/api/src/modules/telegram/telegram.service.ts#L28) | Resposta do celular pode cair na interação pendente errada; restart perde callback | Alta, campo único e precedência rastreados; sem envio de mensagem real |
| A07 / P1 | [conversation.service.ts:52](../../../apps/api-v2/src/conversation/conversation.service.ts#L52), P4; [orchestrator.service.ts:820](../../../apps/api/src/modules/orchestrator/orchestrator.service.ts#L820) asc/take20 | V2 perde sessão ao reiniciar; V1 longa usa as primeiras 20 mensagens | Alta; perda V2 reproduzida, janela V1 demonstrada pelo query |
| A08 / P1 | [skill-engine.service.ts:41,159](../../../apps/api-v2/src/skill-engine/skill-engine.service.ts#L41); gates V2 e approval V1 | Aprovação e IDs não têm contrato uniforme; acesso direto sem missão contorna gate de skill | Alta no código; não se afirmou bypass do JWT nem de toda capacidade tipada |
| A09 / P1 | [apps/api/src/modules/memory/memory.service.ts:155](../../../apps/api/src/modules/memory/memory.service.ts#L155) V1; V2 `:183,338`; ContextEngine `:224` | Escopo omitido mistura projetos; repetição/inferência/caches prejudicam memória corrigível | Alta para mecanismos; qualidade de respostas atuais não medida |
| A10 / P1 | [browse-screenshot.ts:18–27](../../../apps/agent/src/actions/browse-screenshot.ts#L18); [poller.ts:108](../../../apps/agent/src/poller.ts#L108) | Abrir página e capturar desktop não valida comportamento; upload automático não cobre browse_and_screenshot | Alta no código; navegador real não operado |
| A11 / P1 | [qa-engine.service.ts:99–109](../../../apps/api-v2/src/qa-engine/qa-engine.service.ts#L99) retorna [] e passRate=1 | Gate pode anunciar aprovação sem ter lido testes | Alta; módulo congelado, não confundir com QA V1 funcional |
| A12 / P1 | R4/doctor/icacls: .env do agent com token presente e grupo CodexSandboxUsers com modificação | Fronteira local de credenciais não corresponde ao isolamento pretendido | Alta na ACL observada; nenhum segredo lido ou extraído |
| A13 / P1 | R4; `apps/api-v2/Dockerfile:62`; R1 sem atestado OCI | Processo local desatualizado e boot V2 após migration falha podem ocultar divergências | Alta sobre configuração; migration falha não foi provocada |
| A14 / P2 | [document-processing.service.ts:36](../../../apps/api/src/modules/document-processing/document-processing.service.ts#L36) usa tmpdir; R6 backups | Downloads gerados não sobrevivem necessariamente à recriação; restauração global não comprovada | Alta para armazenamento temporário; inventário de backups parcial |
| A15 / P2 | QA Scientist `:170,340`, R5; AiRouter `:140` | Evolução existe, mas janela recente não trouxe sinal; promoção afeta só chamadores elegíveis | Alta no mecanismo e agregados; não mede benefício ao usuário |
| A16 / P2 | CostController `:47`; Specialists `:150`; AiRouter `:121`; LlmService `:119` | Contagem/cap de custo não cobre todos os caminhos; fallback pode mudar custo e qualidade | Alta no código; nenhum saldo, preço vigente ou quota foi sondado |
| A17 / P2 | R7 e Compose Hermes `:19,39` | Spike não entrega presença, retomada e persistência completas | Alta; capacidades do Hermes upstream não provam integração local |

### Barreiras positivas já existentes

Não reconstruir: autorização V1 vinculada a argumentos e identidade autenticada; whitelist de executor e decisão central de run_command; consumidores MCP distintos; autenticação JWT no WebSocket; associação persistida Telegram/projeto; RayzenExec e entrega por bundle; filtros da captura CLI; TestRun e storage de evidências; testes de benchmark com prompt do candidato. Há bons blocos locais, mas sua composição precisa das correções acima.

## 8. Presença, navegador, voz e dispositivos

| Situação | O que o código permite afirmar | O que falta demonstrar |
|---|---|---|
| Marcelo trabalha enquanto outra tarefa executa | Node pode atender requisições independentes; worktrees/RayzenExec oferecem separação | Limite de concorrência, trava de recurso e chat desacoplado; input web fica disabled enquanto loading |
| Navegador fechado | Ações de arquivo/API/servidor não dependem dele; browse abre navegador padrão | Executor Playwright de produção com readiness, assertions, isolamento e artefatos |
| PC bloqueado | Servidor pode continuar tarefas próprias | Captura/interação desktop depende da sessão gráfica; não testada sob lock |
| Logout / reboot Windows | Tarefa instalada usa AtLogOn, Interactive, Limited | Não é serviço anterior ao login; recuperação funcional e credenciais da conta separada |
| PC desligado | Serviços do servidor independem do PC | Tarefas desktop devem declarar indisponibilidade/aguardar, não prometer “pode fechar o PC” |
| Celular | Telegram e web são canais existentes | Resposta ligada a task/approval, continuidade entre canais e entrega real em rede móvel |
| Voz | Web grava/transcreve e pede síntese; VoiceService usa Groq direto | Áudio PT-BR, latência, qualidade e recuperação não testados; TTS configurado é modelo english com limite de 800 caracteres |
| Agenda/serviços pessoais | get_calendar usa helper Outlook local via PC Agent | Conta, disponibilidade e resultado não consultados; não é sincronização pessoal persistente nem integração Google comprovada |
| Casa | Nenhum executor doméstico integrado localizado | Adiar até contrato de responsabilidade, estado e aprovação estar validado |

Fontes: `InputBar.tsx:134`; [install-autostart.ps1:91](../../../scripts/install-autostart.ps1#L91); [orchestrator.service.ts:280](../../../apps/api/src/modules/orchestrator/orchestrator.service.ts#L280); [voice/voice.service.ts:12,29,61](../../../apps/api/src/modules/voice/voice.service.ts#L12); [actions/outlook-calendar.ts:20](../../../apps/agent/src/actions/outlook-calendar.ts#L20).

## 9. Skills, aprendizado e sustentabilidade

**Skills:** arquivos documentais descrevem comportamentos; SkillAsset/registry oferecem definição versionada, schemas e runtime, com sincronização de builtins. Resolver uma skill não executa automaticamente um Markdown novo. Os handlers executáveis continuam implementados no SkillEngine/dispatcher. Schemas declarados não são validação runtime uniforme. O registro desabilitado é respeitado em resolve, mas listAll pode voltar à entrada estática e exibir disponibilidade incoerente.

**Aprendizado:** (a) indexação e recuperação mudam o contexto; (b) captura explícita/automática registra conteúdo; (c) Evolutionary/QA Scientist compara prompts/estratégias. Não há treinamento de modelo fundacional identificado. AiRouter usa estratégia ativa somente se taskType existe e o chamador não forneceu systemPrompt; se messages já vierem montadas, elas têm precedência no corpo enviado. Logo, promoção não altera todas as conversas ou todo Claude.

Há comparação com casos golden, medição do prompt candidato e gate de promoção. Aprovar chama promote, mas erro na aplicação do efeito é apenas logado; o gate pode continuar approved. Promote aposenta estratégias anteriores e ativa a escolhida em operações separadas. Não foi demonstrado rollback transacional com conjunto de regressão. QA Scientist marca hipótese promoted ao criar o gate, antes da aplicação efetiva. Isso precisa de estados distintos “proposta / aprovada / aplicada / revertida”.

No runtime: 169 registros de uso de skills (último em 14/08), 272 benchmarks (último em 23/08), 63 hipóteses, duas estratégias active e 52 candidate. O heartbeat recente do Scientist tinha dez ciclos sem sinal, zero hipóteses geradas; a janela de sete dias não tinha mission steps com falha, benchmarks de baixa fitness ou trace errors nas fontes consultadas. Isso não prova ausência de bugs: pode ser ausência de execução/instrumentação.

**Custos:** aliases gpt-4o/gpt-4o-mini apontam no arquivo para modelos Groq; há Gemini/Anthropic em fallback e Ollama para tarefas leves. Esses nomes são aliases internos, não identificação garantida do modelo que respondeu. LiteLLM tem cache e callbacks Langfuse. Embeddings Jina e voz direta ficam fora desse caminho. LlmService grava custo, mas AiRouter mantém setter sem chamador localizado; Specialists consulta orçamento com estimativa fixa. Não há teto uniforme pré-execução para toda chamada/CLI/voz. “Free tier” documentado não garante custo zero ou quota atual; nenhuma chamada paga foi feita na auditoria.

**Operação:** PostgreSQL e Redis têm volumes; evidências têm bind persistente. API V2 não possui volume de sessão e PDFs usam temporário na V1. Foram encontrados backups parciais, mas não uma restauração atual comprovada. Há tags flutuantes de infraestrutura. O CI recente está verde; smoke com continue-on-error e curl tolerando erro não deve ser usado sozinho como critério de release. O script de QA do CI envia resultados ao ambiente configurado: não foi executado localmente.

Fontes adicionais: [skill-engine/skill-registry.service.ts:60,75](../../../apps/api-v2/src/skill-engine/skill-registry.service.ts#L60); [evolutionary.service.ts:210](../../../apps/api-v2/src/evolutionary/evolutionary.service.ts#L210); [approval-gates.service.ts:84–130](../../../apps/api-v2/src/approval-gates/approval-gates.service.ts#L84); [qa-scientist.service.ts:392–411](../../../apps/api-v2/src/qa-scientist/qa-scientist.service.ts#L392); [ai-router.service.ts:137–160](../../../apps/api-v2/src/ai-router/ai-router.service.ts#L137); [infra/litellm/config.yaml:11,99,118](../../../infra/litellm/config.yaml#L11); [.github/workflows/ci.yml:105,153](../../../.github/workflows/ci.yml#L105).

## 10. Revalidação das hipóteses anteriores

| Hipótese em 0089503 | Classificação nesta revisão | Evidência / ressalva |
|---|---|---|
| Sessão gravada em taskLog e module/action divergente | Confirmado | P1, código implantado e R2 |
| Timeout interpretado como aprovação | Confirmado | P5; configuração RayzenExec não corrige a decisão do loop |
| Saída sem marcador concluída pelo tamanho | Confirmado | P6 |
| Telegram replyHandler único | Confirmado | Associação persistida de projeto é melhoria distinta |
| Hermes sleep infinity, restart no, apenas memories | Confirmado | Compose/Dockerfile e container parado; SQLite de sessões não está no volume persistido |
| V2 Conversation em Map | Confirmado | P4 e compilado implantado |
| Recuperação de processing não demonstrada | Confirmado o defeito na fila agent | P2/R3; existe recuperação parcial de steps V2 |
| browse_and_screenshot abre URL e captura tela | Confirmado | Código; evidência remota desse action não se integra ao upload especial de screenshot |
| CI falha por paths/preparação Linux | Corrigido no CI atual | 1ab4cde e HEAD têm runs success; dois fixtures locais continuam bloqueados pelo sandbox Windows |
| Documentos divergentes sobre filas/congelamento/capacidades | Confirmado | Bull real versus BullMQ descrito; protocolo GET versus POST claim; V2 reativada versus textos antigos |
| WebSocket já autentica JWT e MCP tem leitura por consumidor | Confirmado como proteção existente | Testes desta auditoria; não é falta de autenticação. Readonly MCP não equivale a consulta sem efeitos internos |

CI atual: [run do HEAD](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34736558434), [correção Linux](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34732951628), [falha na referência anterior](https://github.com/marcelorayzen/rayzen-ai-private/actions/runs/34705641857).

## 11. Divergências documentais que devem orientar a continuação

- [docs/RAYZEN_AGENT_PROTOCOL.md:34](../../../docs/RAYZEN_AGENT_PROTOCOL.md#L34) descreve GET de pending; poller usa POST claim. O mesmo protocolo promete preservação de trabalho na limpeza, mas o teste P7 mostra a exceção sem commit.
- `docs/architecture.md` descreve BullMQ e centralização de LLM mais ampla que o código: dependência real é Bull v4; voz/embeddings têm caminhos diretos.
- `docs/FROZEN.md` registra decisões de escopo de agosto; [apps/api-v2/FROZEN.md:3](../../../apps/api-v2/FROZEN.md#L3) diz explicitamente que o congelamento geral antigo está obsoleto. Módulos congelados ainda podem ter endpoints acessíveis. Não tratar “congelado” como removido ou “endpoint acessível” como uso comprovado.
- Comentário de TTS em [infra/litellm/config.yaml:90](../../../infra/litellm/config.yaml#L90) registra playai quebrado; o serviço de voz atual chama outro modelo diretamente. Conclusão correta: alias antigo divergente e áudio atual não validado.
- Comentário “memória e estado” do volume Hermes persiste apenas memories. A documentação oficial situa sessões em state.db e estado de roteamento em armazenamento distinto. [Sessões Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/sessions), [armazenamento Hermes](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage).
- Migração V2 existe no comando de boot; sua falha pode ser ignorada pelo ponto e vírgula. “Não roda migrate” seria diagnóstico incorreto.
- A conta RayzenExec e a tarefa de autostart existem; isso não autoriza afirmar que Sentinel foi implementado ou que há aplicativo próprio no celular.

## 12. Limites e encaminhamento

Não foram feitos: novas conversas ou tarefas reais; chamadas a provedores para medir modelo/voz/quota; aprovação pelo Telegram; reinício durante tarefa; lock/logout; execução do Claude separado; abertura do navegador pessoal; promoção de estratégia; restauração de backup; avaliação estatística atual da memória. As verificações pendentes têm procedimentos e critérios em VALIDACOES.md.

Não corrigir todos os módulos de uma vez. Priorizar A01–A08 no caminho escolhido e provar o primeiro fluxo diário antes de ampliar presença pessoal. A matriz distingue “há código”, “está ligado”, “foi testado” e “há uso comprovado”; o plano indica o que reutilizar para evitar reconstrução.
