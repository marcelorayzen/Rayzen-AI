---
capitulo: 5
titulo: "Turbulência de Junho — o Pivot NORTE e o Bugchain"
periodo: "2026-06-01 a 2026-06-25"
fontes:
  commits: ["b9ffcf2", "0512df2", "c26a1b4", "8bd1526", "68d87e9", "e2acb22", "357030f", "123a716", "fed0172", "13ef071", "21a90f1", "8f0c1f7", "29f1366", "ca8aaba", "4f6bfad"]
  memory: ["memory/project_rayzen_definition.md", "memory/project_context_broker.md", "memory/project_tooluse_bugchain.md", "memory/project_server_autologin_pending.md", "memory/project_encoding_cleanup.md", "memory/project_role_policy_drift.md", "memory/feedback_hook_projectid_loop.md", "memory/project_state_synthesis_incremental.md", "memory/project_widget_decision.md", "memory/reference_vps_ssh.md"]
  docs: ["docs/adr/ADR-001-role-policy-supervised-session.md", "docs/adr/ADR-002-role-policy-graphify-sync.md"]
confianca: "media"
---

# Capítulo 5 — Turbulência de Junho

Se maio foi construção acelerada, junho foi o mês em que o projeto testou, de verdade, o que tinha construído — e descobriu que boa parte não aguentava contato com a realidade. Este é o capítulo mais denso do livro, e o que mais se apoia em memória (`confianca: media`) em vez de fonte única e datada.

## O pivot NORTE — congelar e descongelar o executor

Em **2026-06-11**, uma decisão estratégica: o commit `b9ffcf2` — *"feat(rayzen): pivot para cérebro de memória/QA — executor de missões congelado"* — redefine o que o Rayzen é. `memory/project_context_broker.md` explica o porquê: "o executor autônomo de missões LLM foi congelado. O papel central do Rayzen agora é exatamente este: ser a memória persistente e o contexto comprimido que torna o Claude Code mais eficaz a cada sessão." No mesmo dia, o manual de uso é reescrito para refletir a nova direção (`c26a1b4`) e o deploy ganha um script determinístico para o notebook local (`0512df2`).

Desse pivot nasce o **loop de write-back** que ainda hoje sustenta o protocolo Claude Code ↔ Rayzen (a mesma mecânica usada para escrever este livro): `rayzen_capture_learning` → `POST /wiki/learning` → indexado via `MemoryService` com `projectId` → reaparece automaticamente em `rayzen_get_context` na sessão seguinte. Não é um detalhe cosmético — é a resposta arquitetural direta ao congelamento: se o executor não é mais o centro, o centro passa a ser a memória que sobrevive entre sessões.

**Cinco dias depois, o pivot é parcialmente revertido.** Em 2026-06-16, `memory/project_rayzen_definition.md` registra: "o executor de missões V2 foi descongelado. Decisão do Marcelo após auditoria completa: a Fase 3 (JARVISHealthCheck + IntentContract + Router reescrito) está pronta e o loop de step-execution já roda end-to-end." O `apps/api-v2/FROZEN.md` que documentava o congelamento fica obsoleto. O que faltava não era reconstruir o executor — era fechar um único elo: **gate→resume** (aprovar um gate não retomava de fato o step pausado). Esse elo específico é exatamente o que o bugchain, três dias depois, revela ser muito mais grave do que parecia nesta auditoria.

O resultado líquido do pivot-e-reversão não foi "voltar ao estado anterior" — foi uma definição de papéis que se mantém até hoje: **Rayzen = cérebro persistente (memória + contexto + governança QA); Claude Code = executor (código, deploy, testes); Agent desktop = executor local (browser, terminal, screenshots).**

## A migração de volta para o notebook local

Em paralelo, `memory/reference_vps_ssh.md` registra que em **2026-06-10** a VM Azure que hospedava a "VPS central" desde 05-18 (capítulo 3) foi desativada, e a infraestrutura migrou de volta para o notebook local — agora tratado como servidor permanente via Cloudflare Tunnel, evitando port-forwarding. É uma decisão de custo e simplicidade operacional, mas com uma consequência que aparece nove dias depois: um notebook doméstico não tem a mesma disponibilidade de uma VPS gerenciada.

**06-19/20** — o servidor cai durante o próprio debug de uma missão real e fica inacessível tanto por LAN quanto pelo domínio público (`memory/project_server_autologin_pending.md`). Causa raiz: o notebook trava na tela de login no boot, porque a conexão WiFi está salva "somente para este usuário" no NetworkManager — a senha fica presa no keyring do GNOME, que só destrava com login físico de sessão. Rede, Docker e o Cloudflare Tunnel dependem dessa rede, então nada sobe até alguém logar na máquina fisicamente. A correção (tornar a conexão WiFi system-wide + autologin gráfico como rede de segurança) ficou registrada como pendente, para aplicar na próxima janela de acesso físico — um trade-off consciente, aceito por ser máquina pessoal atrás do próprio túnel autenticado.

## Um quase-desastre em meio à limpeza (nota temporal: 05-31)

Um incidente vale registro aqui mesmo sendo datado do fim de maio (05-31, ver capítulo 4), porque pertence ao mesmo padrão de fragilidade operacional deste capítulo: uma limpeza de corrupção de encoding (`U+FFFD`, originada de pastes manuais de seed em 05-11 e 05-29) quase apagou dados de um projeto real e paralelo — a meta ativa do cliente "VB Ferragens" foi deletada por engano, achando-se que era um registro mal arquivado do próprio Rayzen. Foi restaurada do backup. A lição registrada em `memory/project_encoding_cleanup.md` é direta: "antes de deletar uma linha de outro projeto, confirmar o `project_id` e perguntar — o que é do Rayzen no Rayzen, o que é do VB no VB." Um lembrete cru de que multi-projeto significa multi-blast-radius.

## O bugchain — 12 bugs, três ondas, uma missão real

O núcleo técnico deste capítulo é o que `memory/project_tooluse_bugchain.md` descreve como uma cadeia de bugs "descobertos validando de ponta a ponta — o sistema funcionava em camadas superficiais mas nunca tinha sido exercitado de ponta a ponta com uma ação real antes". Entre **06-19 e 06-22**, implementar tool-use real (o LLM chamando skills de verdade via `SkillEngine`, em vez de apenas narrar a ação) revelou uma falha nova a cada tentativa em produção.

**Onda 1 (06-19/20) — 6 bugs de schema e dispatch:**
1. `jarvis:file_read` com schema `lines: 'object'` sem `properties` — o LLM passava `lines: 1000` (número), o Groq rejeitava com 400.
2. O 400 escalava para o tier 4 (Claude) sem necessidade — erro definitivo de schema, escalar não resolve, e o Claude ainda rejeita nomes de tool com `:`.
3. Prefixo duplicado `jarvis:jarvis:file_read` — o `SkillEngineService.dispatchToAgent()` mandava a action já prefixada para a V1, que prefixa de novo por padrão.
4. `ACTION_ROLE` (V1) e `role-policy.ts` (agent) nunca tinham sido atualizados com as ações de arquivo/git/prisma que já existiam há tempo no `SkillRegistry` da V2 — caíam no papel errado ou eram rejeitadas.
5. `AGENT_API_URL`/`AGENT_TOKEN` obsoletos — o `.env` da raiz ainda apontava para o IP da Azure já desativado, com um token que nem era o JWT certo. O agent desktop nunca tinha, de fato, conseguido falar com produção até esse fix.
6. Path relativo resolvendo contra o cwd errado — dependendo de como pnpm/PowerShell lança o agent, `process.cwd()` não é a raiz do projeto.

Um gotcha à parte, descoberto na mesma investigação: **dois arquivos `.env` candidatos** para o agent desktop (`apps/agent/.env` e o `.env` da raiz), carregados por launchers diferentes — editar só um e reiniciar não resolve nada se o usuário usa o outro. Esse exato padrão reaparece, quase idêntico, no incidente de julho descrito no capítulo 7.

**Onda 2 (06-20) — 3 bugs estruturais no motor de missões:**
1. Um gate criado durante um `tool_call` deixava o step em `skipped` para sempre — nenhum dos dois motores de execução escolhe steps fora de `pending`. Corrigido resetando o step para `pending` ao aprovar o gate (com custo: perde-se o contexto da conversa anterior do specialist).
2. `WorkflowEngineService.runStepLogic()` ignorava `mission.specialistId` no caminho de resume — o gate→approve inferia o specialist por texto, podendo escolher "reviewer" para um step de edição.
3. Instância de specialist só em memória — um restart do `api-v2` deixava o step órfão em `running` para sempre. Foi exatamente essa falha que causou a missão duplicada `30327e07`, cancelada manualmente em 06-20. Corrigido com reconciliação no boot (`OnModuleInit` marca como `failed` qualquer step preso em `running` de uma instância anterior).

Bônus fora da cadeia original: o agent desktop não tinha detecção de offline — `jarvis:file_read` falhava 10 de 10 vezes, cada tentativa pagando o timeout cheio de 30s, porque o agent simplesmente não estava rodando, sem nenhum sinal prévio. Corrigido com um `AgentHeartbeatService` que grava `lastSeenAt` por papel.

**Onda 3 (06-21/22) — a primeira missão real via `/v2/route`, e o bug mais grave de todos:**

Rotear uma missão de verdade — "adicionar step de testes do api-v2 no `ci.yml`" — em vez de uma criada manualmente via API, expôs uma cadeia pior do que qualquer teste manual tinha achado:

1. `StepExecutorService` nunca tratava `executor: 'skill'` — só o outro motor (`WorkflowEngineService`) tinha esse branch. Todo step de skill ia para um specialist de IA que tentava *adivinhar* a ação via tool calls genéricos — funcionava por acaso quando a IA adivinhava certo, gerando gates espúrios e custo desnecessário.
2. **O bug mais grave do bugchain inteiro:** um gate aprovado nunca deixava a ação de risco médio/alto executar de fato. `runStepLogic()` só verificava `status === 'failed'`; um specialist `'interrupted'` (gate criado no meio de um tool call) caía no caminho de sucesso, e o step virava `'done'` com um gate pendente órfão — nada executado. Pior: como o resume reiniciava o specialist do zero, cada nova aprovação recriava *outro* gate, porque `checkAndCreate()` nunca verificava se já existia um gate `approved` para o mesmo step. Resultado: aprovar um gate três vezes seguidas nunca deixava um `git commit` rodar de verdade — um loop de aprovação infinito e silencioso.
3. Confirmação de um problema já suspeitado: o planner LLM realmente não populava `dependsOn` — "Push" e "Commit" rodaram em paralelo na mesma missão real, sem dependência declarada entre eles.

A missão `4fddd26e` foi completada de ponta a ponta — o step de teste foi de fato adicionado ao `ci.yml`, confirmado passando no CI real. Era a primeira vez que o motor de missões da V2 provava, com uma tarefa real e não sintética, que funcionava.

## O "loop" que não era sobre projectId

Em paralelo ao bugchain, um sintoma relatado como "o Rayzen quer refazer tudo de novo a cada sessão" levou a duas investigações que pareciam a mesma causa mas não eram.

A primeira suspeita (`feedback_hook_projectid_loop.md`) foi resolvida em **06-17** (commit `8f0c1f7`): o próprio código chegava a *recomendar* fixar um `projectId` no `hook.config.mjs` como solução quando a resolução automática falhava — mas esse arquivo é compartilhado por todos os projetos do usuário, então fixar um id resolvia um projeto e quebrava silenciosamente todos os outros, gerando um ciclo diário de fixar/desfazer. A correção certa, documentada desde então: `PATCH /projects/:id { repoSlug }`, nunca editar o hook global.

A causa raiz de verdade, porém, era outra (`project_state_synthesis_incremental.md`): `ProjectStateService.refresh()` regenerava `nextSteps` do zero a cada chamada, via LLM, dando peso igual a eventos de agora e sínteses de dias atrás — um item já resolvido podia "ressuscitar" se uma síntese antiga ainda o mencionasse. Corrigido nos commits `29f1366`/`ca8aaba` (mesmo dia, 06-17): o refresh passa a ser incremental, ancorado no estado atual, buscando só eventos posteriores ao último update, com uma regra explícita no prompt — "remover item com evidência de resolução, manter o resto, adicionar só com evidência nova". Mesmo assim, em **06-22**, uma instabilidade residual foi confirmada mesmo *com* evento novo presente: duas chamadas consecutivas de `refresh()`, sobre o mesmo conjunto de eventos, produziram resultados divergentes (`goalProgress` variando 36→31 sem nenhuma mudança real de estado). Registrado como conhecido, não resolvido — se for preciso garantir consistência, o caminho é `PATCH /projects/:id/state/planning` direto, não confiar em `refresh()` repetido.

## O drift de role-policy começa a aparecer

Ainda em junho, o mesmo padrão que a onda 1 do bugchain já tinha exposto (ações existindo em uma whitelist mas não na outra) vira processo formal: a **Fase 0-A** de auditoria de role-policy. **ADR-001** (06-23) formaliza que `supervised_session` e `run_graphify` são DESKTOP-only — o primeiro estava mapeado como `'server'` em `execution.service.ts` mas ausente de `SERVER_ACTIONS` em `role-policy.ts`, causando rejeição silenciosa toda vez que o sistema tentava despachar a ação. **ADR-002** (06-25) fecha um gap gêmeo: `graphify_sync` estava na whitelist e no executor, mas ausente de `DESKTOP_ACTIONS` — sem esse fix, `graphify update .` nunca funcionava de fato quando disparado pelo agent. A auditoria continua — e se fecha, com um terceiro ADR, no início do capítulo seguinte.

## Dois parênteses: o Widget e o RCP

Em **06-04**, em meio ao próprio bugchain, nasce o scaffold do **Widget Electron** (Ciclo 3-B) — app dedicado a um monitor próprio, voice nativo, push bidirecional via WebSocket (`68d87e9` traz o WebSocket Gateway da V2 na porta 3104 junto com o scaffold do widget). A decisão de arquitetura (`memory/project_widget_decision.md`) é explícita: Electron robusto, não um overlay leve, porque "Marcelo vai dedicar um monitor inteiro ao widget" — justificando UI própria e hotkey global.

Em paralelo, o **Rayzen Commerce Platform** (RCP) — um projeto cliente real e separado, `github.com/marcelorayzen/rayzen-commerce-platform` — funciona como dogfood do Ciclo 3-A: validar o fluxo missão→execução→entrega construindo, de fato, o e-commerce de um cliente através de missões no próprio Rayzen. Não é parte da história técnica do Rayzen em si, mas é o motivo pelo qual boa parte do bugchain foi descoberta contra uma "missão real" em vez de um teste sintético.
