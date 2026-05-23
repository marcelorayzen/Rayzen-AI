# Roadmap — Rayzen AI

Objetivo: transformar o Rayzen de "coleção de módulos" em **orquestrador de contexto de desenvolvimento** — um sistema que acompanha projetos, captura o que acontece no trabalho, e materializa documentação viva sem esforço manual.

Cada fase tem escopo mínimo e critério de done explícito. Nada avança sem o critério da fase anterior estar satisfeito.

---

## Fase 1 — Project-aware

**Objetivo:** o Rayzen passa a saber a qual projeto cada conversa e documento pertence.

### O que implementar

- [x] Tabela `projects` no Prisma: `id`, `name`, `description`, `status`, `goals`, `created_at`
- [x] FK `project_id` nullable em `documents` e `conversation_messages`
- [x] `ProjectModule` na API: CRUD básico (`POST /projects`, `GET /projects`, `GET /projects/:id`, `PATCH /projects/:id`)
- [x] Seletor de projeto ativo na UI (dropdown no header do Command Center)
- [x] `project_id` passado no body do `POST /chat/message` e salvo na sessão

### Critério de done

> Consigo abrir o Rayzen, selecionar "Rayzen AI" como projeto ativo, enviar uma mensagem e confirmar no banco que `conversation_messages.project_id` está preenchido.

---

## Fase 2 — Event log (captura bruta)

**Objetivo:** tudo que acontece no projeto entra como evento rastreável com origem, tipo e timestamp.

### O que implementar

- [x] Tabela `events` no Prisma: `id`, `project_id`, `source`, `type`, `content`, `metadata`, `ts`
- [x] `EventModule` na API: `POST /events`, `GET /events?project_id=&source=&type=`
- [x] Emitir evento automático em: novo `conversation_message`, novo `document` indexado, nova `execution` despachada
- [x] Timeline de eventos por projeto na UI (aba "Atividade" no projeto)

### Critério de done

> Indexo um arquivo, envio uma mensagem e executo uma ação — os três aparecem na timeline do projeto em ordem cronológica com origem correta.

---

## Fase 3 ? Captura de atividade Claude Code + workspace ? Rayzen

**Objetivo:** o trabalho no terminal e no workspace aparece automaticamente no Rayzen sem acao manual, sem depender exclusivamente de uma unica ferramenta.

### O que implementar

- [x] Endpoint `POST /events/cli` na API
- [x] Hook `PostToolUse` no `settings.json` do Claude Code
- [x] Hook `Stop` no `settings.json`
- [x] Campo `active_project_id` via `hook.config.mjs`
- [x] Teste manual: rodar Claude Code, editar um arquivo, verificar evento no Rayzen
- [x] Workspace watcher no Desktop Agent para capturar alteracoes feitas por Codex, VS Code, terminal comum ou outras ferramentas
- [x] Configuracao `AGENT_WORKSPACE_ROOTS` para observar multiplas pastas de projetos
- [x] Resolucao por `repoSlug` para manter eventos no projeto correto

### Criterio de done

> Trabalho 10 minutos no Claude Code, Codex, VS Code ou terminal comum. Ao abrir o Rayzen, vejo atividade no projeto correto: arquivos alterados, branch, commit atual e origem da captura, sem registrar manualmente.

**Limitacao documentada:** o hook do Claude captura detalhes internos da sessao do Claude. O watcher agnostico captura o efeito no workspace, mas nao sabe todos os comandos internos executados por cada ferramenta.

---

## Fase 4 — Síntese de sessão

**Objetivo:** ao encerrar uma sessão de trabalho, o Rayzen extrai automaticamente decisões, próximos passos e um resumo narrativo a partir dos eventos capturados.

### O que implementar

- [x] `SynthesisService`: `synthesizeSession(session_id, project_id)`
- [x] Tabela `session_artifacts`: `id`, `project_id`, `session_id`, `type`, `content` (JSON), `created_at`
- [x] Trigger automático: síntese roda quando hook `Stop` chega
- [x] Painel "Sessão" na UI: exibe o artefato gerado

### Critério de done

> Encerro uma sessão de trabalho. O Rayzen gera automaticamente: o que foi decidido, o que ficou pendente, o que aprendi.

---

## Fase 5 — Documentação viva

**Objetivo:** o Rayzen materializa documentos derivados do histórico — sem digitar, revisáveis manualmente.

### O que implementar

- [x] `DocumentationService`: gera `project_state.md`, `decisions_log.md`, `next_actions.md`, `work_journal.md`
- [x] Endpoint `POST /documentation/generate/:project_id`
- [x] Tabela `project_documents`: `id`, `project_id`, `type`, `content`, `generated_at`, `reviewed_at`
- [x] UI: aba "Documentação" no projeto, exibe cada artefato em markdown, botão "Regenerar"
- [x] Regra: artefatos revisados manualmente não são sobrescritos sem confirmação

### Critério de done

> Clico em "Gerar documentação". O sistema produz `decisions_log.md` com decisões reais e `next_actions.md` com próximos passos pendentes.

---

## Fase 6 — Obsidian export

**Objetivo:** o vault do Obsidian espelha os artefatos do Rayzen.

### O que implementar

- [x] Endpoint `POST /obsidian/sync/:project_id`
- [x] Deep links `obsidian://open?vault=X&file=Y`
- [x] Criação automática de nota de projeto com frontmatter
- [x] Detecção de conflito por mtime
- [x] Configuração do vault path em `/configuration`

### Critério de done

> Gero documentação, clico em "Sincronizar Obsidian", encontro as notas atualizadas no vault. Se editar a nota no Obsidian e sincronizar de novo, o sistema detecta o conflito.

---

## Fase 7 — Estado estruturado do projeto

**Objetivo:** o Rayzen passa a *entender* o projeto, não só registrar. Um objeto tipado com estado derivado substitui o markdown livre de `project_state`.

**Por que agora:** com events + synthesis acumulando dados, é hora de sintetizar em algo navegável e confiável — não um blob de texto.

### O que implementar

- [x] Tabela `project_states`: `id`, `project_id`, `objective`, `stage`, `blockers[]`, `recent_decisions[]`, `next_steps[]`, `risks[]`, `doc_gaps[]`, `risk_level` (`low|medium|high`), `updated_at`
- [x] `ProjectStateService`: `refresh(project_id)` — agrega events + artifacts, chama LLM (json_object), upsert
- [x] Endpoint `GET /projects/:id/state` e `POST /projects/:id/state/refresh`
- [x] Campo `intent` em `events`: `decision | idea | problem | reference | checkpoint`
- [x] `POST /synthesis/checkpoint` — checkpoint manual: sintetiza eventos recentes (últimas 2h ou desde último checkpoint)
- [x] UI: painel de estado estruturado no header do projeto (objetivo, stage, risk_level, blockers)
- [x] UI: botão "Checkpoint" na barra de ações
- [x] UI: botões de captura rápida ("+ Decisão", "+ Ideia", "+ Problema") com modal leve

### Critério de done

> Abro um projeto no Rayzen e vejo o painel de estado: objetivo atual, estágio, nível de risco, bloqueios. Clico em "Checkpoint" e em 10 segundos aparece uma síntese do que aconteceu na última hora. Clico em "+ Decisão" e registro uma decisão em menos de 5 segundos.

---

## Fase 8 — Confiança e rastreabilidade

**Objetivo:** cada artefato gerado pela IA tem proveniência clara — o que foi usado, qual a confiança, o que mudou desde a última versão.

**Por que agora:** sem isso, o Rayzen acumula artefatos mas não gera confiança. A confiança vem de saber de onde veio cada coisa.

### O que implementar

- [x] Tabela `project_document_versions`: `id`, `document_id`, `content`, `diff` (text), `reason`, `source_event_ids[]`, `created_at`
- [x] Quando `DocumentationService` regenera um doc: salva versão anterior + diff antes de atualizar
- [x] Campo `confidence` (`low|medium|high`) e `sources[]` no `SessionArtifact`
- [x] Endpoint `GET /documentation/:project_id/:type/versions` — histórico de versões
- [x] UI: botão "Ver histórico" no doc → lista de versões com diff colapsável
- [x] UI: badge de confiança nos artefatos de síntese
- [x] Endpoint `GET /events/:id/why` — eventos e artefatos que referenciam este evento (trilha de causalidade)

### Critério de done

> Regenero um documento. O sistema mostra: o que mudou (diff), quais eventos geraram a mudança, e o nível de confiança do artefato. Consigo rastrear "de onde saiu essa decisão" em menos de 3 cliques.

---

## Fase 9 — Git-aware context

**Objetivo:** o Rayzen entende o que foi codificado, não só o que foi dito.

**Por que depois de 8:** sem diff e causalidade, os dados git chegam mas não se conectam a nada útil.

### O que implementar

- [x] Hook `PostToolUse` enriquecido: inclui branch atual + hash do último commit no payload
- [x] Endpoint `POST /events/git` — recebe push/PR webhook do GitHub, salva como evento
- [x] `GitContextService`: `getProjectContext(project_id)` — agrega branch, commits recentes, arquivos mais tocados
- [x] Correlação na síntese: ao sintetizar sessão, inclui contexto git do período
- [x] UI: na timeline, eventos de código mostram branch + arquivo alterado com link

### Critério de done

> Faço commits durante uma sessão. A síntese gerada ao encerrar inclui: branch, arquivos mais alterados, mensagens de commit. Na timeline, consigo ver "em qual commit essa decisão foi aplicada".

---

## Fase 10 — Inteligência proativa

**Objetivo:** o Rayzen deixa de reagir e começa a sugerir — o que fazer a seguir, o que está inconsistente, o que precisa de atenção.

**Por que por último:** requer dados acumulados de múltiplas sessões para ter sinal suficiente. Implementar antes é dar recomendações sem base.

### O que implementar

- [x] `ProactiveService`: roda a cada 6h por projeto ativo
  - detecta projetos sem atividade há >7 dias → alerta
  - detecta docs com `reviewed_at` > 30 dias → sugere revisão
  - detecta `blockers[]` que não diminuíram em 3+ sessões → escalona
  - detecta next_steps que não viraram events → sugere ação
- [x] Endpoint `GET /projects/:id/recommendations` — lista de recomendações com prioridade
- [x] `ConsistencyAgent`: compara README vs project_state, decisions_log vs events recentes
- [x] UI: painel "Recomendações" com ações sugeridas e botão de dismiss

### Critério de done

> Abro o Rayzen após 3 dias sem usar. O sistema mostra: "2 projetos sem atividade", "decisions_log desatualizado há 8 dias", "3 next_steps pendentes há mais de uma semana". Consigo agir em cada um com um clique.

---

## Fase 11 — Planejamento operacional

**Objetivo:** o Rayzen passa de "onde estou" para "onde preciso chegar e o que está entre mim e lá". Fecha o loop entre memória e ação.

**Por que agora:** com estado estruturado (Fase 7) e inteligência proativa (Fase 10) funcionando, a lacuna evidente é que o sistema observa e sugere, mas não mantém um plano coerente e executável.

**Decisão de design:** não criar uma entidade `project_plan` separada — estender `ProjectState` com os campos de planejamento. Evita modelo duplicado e mantém uma única fonte de verdade sobre o projeto.

### O que implementar

- [x] Estender `ProjectState` com: `milestones[]` (com status `pending|active|done`), `backlog[]` (itens ordenados por prioridade), `activeFocus` (o que está sendo trabalhado agora), `definitionOfDone` (critério de aceite do milestone atual)
- [x] Heurística de promoção automática: blocker presente em 3+ refreshes do estado → sobe para `activeFocus`
- [x] `POST /projects/:id/resume` — assistente de retomada: dado projeto inativo >24h, retorna brief estruturado com último estado confiável, mudanças recentes, blockers ativos e próximo melhor passo
- [x] UI: painel "agora / depois / bloqueado" como view primária do estado do projeto
- [x] UI: botão "Retomar" no header quando projeto inativo >24h → abre resumption brief

### Critério de done

> Abro um projeto após 3 dias sem mexer. Clico em "Retomar" e em 10 segundos vejo: onde parei, o que mudou, o que está bloqueando e qual é o próximo melhor passo. O painel de estado mostra milestones, o que está em foco agora e o backlog em ordem.

---

## Fase 12 — Health score e consistência ampliada

**Objetivo:** formalizar a saúde do projeto em um número contínuo com histórico — permite ver se o projeto está melhorando ou degradando ao longo do tempo.

**Por que agora:** a Fase 10 tem verificações binárias (tem/não tem recomendação). O health score dá leitura gradual, histórica e comparável entre projetos.

**Decisão de design:** score calculado por 6 dimensões com pesos definidos, persistido com timestamp para permitir curva histórica.

### Fórmula do health score (0–100)

| Dimensão | Peso | Critério |
|---|---|---|
| Atividade recente | 20% | dias desde último evento: 0d=100, 7d=70, 30d=0 |
| Documentação em dia | 20% | % de docs regenerados nos últimos 14 dias |
| Consistência | 20% | resultado do ConsistencyAgent (Fase 10) |
| Next steps claros | 15% | >0 next_steps com <5 dias de idade |
| Blockers resolvendo | 15% | blockers diminuíram entre os 2 últimos refreshes de estado |
| Foco definido | 10% | `activeFocus` preenchido (Fase 11) |

### O que implementar

- [x] Tabela `project_health_scores`: `id`, `project_id`, `score`, `breakdown` (JSON com as 6 dimensões), `created_at`
- [x] `HealthScoreService.compute(project_id)` — calcula e persiste score; roda ao final de cada refresh de estado
- [x] Adicionar regra de drift ao `ProactiveService`: compara `project.goals` com eventos e commits recentes — se foco divergiu, emite recomendação tipo `drift`
- [x] Endpoint `GET /projects/:id/health` — score atual + histórico dos últimos 30 dias
- [x] Ampliar categorias de inconsistência: `warning | inconsistency | missing_evidence | stale_knowledge | orphan_artifact | drift`
- [x] UI: badge numérico no header (`⬡ 74`) com cor por faixa (verde ≥70, âmbar 40–69, vermelho <40)
- [x] UI: mini-gráfico de curva histórica no painel de estado do projeto

### Critério de done

> O projeto mostra score `⬡ 68`. Clico nele e vejo: documentação em dia (100), atividade (82), mas consistência baixa (40) porque docs descrevem arquitetura antiga. O gráfico mostra que o score caiu 15 pontos na última semana.

---

## Fase 13 — Memória hierárquica

**Objetivo:** separar eventos de alto sinal de ruído de baixo valor — sínteses mais precisas e contexto de chat menos poluído.

**Por que depois de 12:** sem health score e planejamento operacional, não há critério claro para definir o que é "relevante". Com Fase 11 e 12 implementadas, as regras de promoção emergem naturalmente dos dados.

**Decisão de design:** começar simples — campo `memory_class` nos eventos, regras por intent e tempo, sem ML. Decay semântico é fase posterior quando houver dados suficientes.

### O que implementar

- [x] Campo `memory_class` em `Event`: `inbox | working | consolidated | archive` (default: `inbox`)
- [x] Regras de promoção automática:
  - evento com `intent: 'decision'` → `consolidated`
  - evento com `intent: 'problem'` + sem resolução em 48h → `working`
  - evento `inbox` sem referência em 30 dias → `archive`
- [x] `SynthesisService` filtra por class: usa `consolidated + working`, ignora `archive` no contexto enviado ao LLM
- [x] `DocumentationService` idem: contexto construído a partir de `consolidated` prioritariamente
- [x] Endpoint `PATCH /events/:id/class` — promoção/rebaixamento manual
- [x] UI: filtro por `memory_class` na timeline de atividade

### Critério de done

> Tenho 500 eventos no projeto. A síntese usa os 80 mais relevantes (consolidated + working). Um evento antigo de "leu arquivo config.ts" está em `archive` e não aparece no contexto. Consigo promover um evento manualmente para `consolidated` com um clique.

---

## Fase 14 — Work modes

**Objetivo:** o Rayzen adapta heurísticas, sínteses e sugestões ao tipo de trabalho da sessão — menos genérico, mais útil.

**Por que por último neste bloco:** modos dependem de síntese de qualidade (Fase 13), planejamento coerente (Fase 11) e saúde confiável (Fase 12) para ser relevante. Sem essas bases, modo é só estética.

**Decisão de design:** `mode` no nível da sessão/checkpoint, não do projeto (você muda de modo dentro do mesmo projeto). Implementação via config de sistema prompt + pesos — sem lógica ramificada nova.

### Modos e seus focos

| Modo | Foco da síntese | Peso elevado | Proativa prioriza |
|---|---|---|---|
| `implementation` | commits, arquivos, blockers, plano | git + events | blockers e next steps |
| `debugging` | erros, tentativas, stack traces, soluções | events de erro | consistência e drift |
| `architecture` | decisões, trade-offs, estrutura | decisions + docs | docs desatualizados |
| `study` | conceitos, links, comparações, resumos | captura manual | docs sem referência |
| `review` | o que mudou, o que divergiu, qualidade | versions + health | inconsistências |

### O que implementar

- [x] Campo `mode` em `ConversationMessage` e `SessionArtifact`
- [x] Objeto de configuração por modo: `systemPromptSuffix`, `eventWeights`, `synthesisFocus`
- [x] `OrchestratorService` aplica config do modo ativo na montagem do contexto
- [x] `SynthesisService` usa `synthesisFocus` do modo para ajustar o prompt de síntese
- [x] Seletor de modo na UI (junto ao seletor de projeto no header)
- [x] Modo persiste na sessão — novos eventos são tagged com o modo ativo

### Critério de done

> Seleciono modo `debugging`. Envio uma mensagem sobre um erro. A síntese no encerramento da sessão foca em: o que tentei, o que falhou, o que resolveu, e qual o próximo passo de investigação — sem ruído de decisões arquiteturais ou docs.

---

## Fase Polimento & Estabilização (pós Fase 14)

**Objetivo:** consolidar segurança, performance e observabilidade antes da próxima fase de features.

### O que foi implementado

- [x] **SEC-1 a SEC-10** — auditoria completa: throttle no login, JWT 8h, CORS whitelist, `timingSafeEqual`, `path.relative()`, pnpm 10.33.2, README de segurança
- [x] **CacheModule Redis @Global** — TTL por tipo (ProjectState 10 min, Wiki 15 min, Brain search 5 min), invalidação por `delPattern`, graceful degradation sem Redis
- [x] **LiteLLM cache Redis** — exact-match cache de respostas LLM (TTL 5 min) ativo no sidecar
- [x] **CostsModule** — `GET /costs/summary` agrega `ConversationMessage` por módulo e projeto; estimativa USD via tabela de preços; modal `◈ costs` na UI
- [x] **ConversationMessage logging** — todos os módulos que chamam LLM (synthesis, project-state, documentation, blueprint, graph) agora registram tokens e custo; custo real não é mais subestimado
- [x] **BlueprintModule** — importação de planos externos (ChatGPT, Claude, Notion, GitHub) para wiki + brain + estado + eventos em um único comando MCP (`rayzen_blueprint_import`)
- [x] **GraphModule / Goal Graph** — canvas `@xyflow/react` para CRUD de milestones/blockers/next-steps; `ProjectGoal` com critérios de sucesso (barra de progresso), KPIs com edição inline e auto-track via LLM; gap analysis (gpt-4o-mini) compara goal vs estado atual
- [x] **Proactive Regra 7** — `goal_stagnant`: detecta goal ativo sem progresso há 5+ dias
- [x] **Fix rayzen_add_event MCP** — payload direto (content + intent) agora é roteado corretamente em `/events/cli`, sem gerar `'unknown: {}'`
- [x] **Fix Brain cache invalidation** — `indexDocument()` invalida `brain-search:*` em created e updated
- [x] **ADR 023 a 027** — checkpoint pipeline, gpt-4o-premium para ProjectState, docs auto-refresh, sínteses dos últimos 30 dias, graphify → eventos
- [x] **Security headers (Helmet)** — `@fastify/helmet` v11 registrado em `main.ts`: CSP, HSTS 31536000s, XSS protection, noSniff, X-Frame-Options; desabilitado em dev para não quebrar Swagger
- [x] **Agent Audit Log** — model `AgentAuditLog` no Prisma, migration aplicada, `AuditLogService`, `GET /tasks/audit` com filtros; Agent envia campos completos (actor, hostname, durationMs, risk, dryRun, workspace) em todo PATCH de conclusão
- [x] **19 testes E2E com Fastify inject** — `auth.e2e.spec.ts` (5), `tasks.e2e.spec.ts` (8), `projects.e2e.spec.ts` (6); `jest.e2e.json` + script `test:e2e`; total agora: 198 testes, 20 suites
- [x] **Prometheus `/metrics`** — `MetricsModule` com `prom-client`: HTTP duration (Fastify hooks em `main.ts`), LLM tokens por módulo/modelo (hookup no `OrchestratorService`), Agent tasks por action/status/role (hookup no `AgentBridgeController`), queue size, totais DB, `collectDefaultMetrics` (heap, GC, event loop); protegido por JWT
- [x] **GitHub Actions CI** — `.github/workflows/ci.yml`: typecheck, lint, unit tests + cobertura, E2E (3 jobs paralelos); deploy manual via SSH (Azure NSG bloqueia IPs dinâmicos do GitHub Actions)

### Critério de done

> Plataforma auditada em segurança, com custo real visível por módulo, cache em múltiplas camadas, observabilidade Prometheus ativa e CI cobrindo typecheck + lint + 198 testes.

---

## Fases futuras (não agora)

| Fase | O que é | Por que esperar |
|---|---|---|
| Deploy VPS Ubuntu/Azure | Colocar em produção | Ambiente atual em VPS Azure; proximo passo: dominio e HTTPS |
| Fase 15 — Checkpoints inteligentes | Checkpoint detecta automaticamente o melhor momento para síntese | Requer Fase 14 estável + dados de padrão de uso |
| Fase 16 — Knowledge graph leve | Relacionar projeto ↔ decisão ↔ doc ↔ arquivo ↔ conceito | Entidades precisam ter semântica estável (Fase 13) |
| Revisão semanal automática | Rotina: o que avançou, travou, envelheceu, está incoerente | Requer health score (Fase 12) + memória hierárquica (Fase 13) |
| Biblioteca de decisões | Camada transversal entre projetos: padrões, trade-offs, escolhas recorrentes | Requer múltiplos projetos ativos com dados consolidados |
| Playbooks pessoais | Detectar padrões de decisão do usuário | Requer Fase 16 + dados históricos extensos |
| Plugin nativo Obsidian | Plugin que lê o vault e fala com a API | Só após Fase 6 + 8 estáveis e VPS em produção |
| Multi-agent | Agentes especializados por modo de trabalho | Primeiro consolida work modes (Fase 14) |

---

## Estado atual

| Fase | Status |
|---|---|
| Fase 1 — Project-aware | ✅ Concluído |
| Fase 2 — Event log | ✅ Concluído |
| Fase 3 — Hooks Claude Code | ✅ Concluído |
| Fase 4 — Síntese de sessão | ✅ Concluído |
| Fase 5 — Documentação viva | ✅ Concluído |
| Fase 6 — Obsidian export | ✅ Concluído |
| Fase 7 — Estado estruturado | ✅ Concluído |
| Fase 8 — Confiança e rastreabilidade | ✅ Concluído |
| Fase 9 — Git-aware context | ✅ Concluído |
| Fase 10 — Inteligência proativa | ✅ Concluído |
| Fase 11 — Planejamento operacional | ✅ Concluído |
| Fase 12 — Health score | ✅ Concluído |
| Fase 13 — Memória hierárquica | ✅ Concluído |
| Fase 14 — Work modes | ✅ Concluído |
| Fase Polimento & Estabilização | ✅ Concluído |

---

## Princípios que guiam este roadmap

- **Captura é fácil** — entrada de dados com zero fricção
- **Consolidação é assíncrona** — síntese acontece em background, não bloqueia o trabalho
- **Publicação é revisável** — nada é publicado sem possibilidade de revisão humana
- **Automação é auditável** — tudo que a IA faz sozinha aparece na timeline
- **Edição humana tem precedência** — IA sugere merge, nunca sobrescreve
- **Confiança vem de rastreabilidade** — cada artefato tem proveniência clara
- **Simples antes de inteligente** — regras explícitas antes de ML; semântica antes de grafo
- **Execução fecha o loop** — memória sem plano é arquivo; plano sem execução é wishlist
