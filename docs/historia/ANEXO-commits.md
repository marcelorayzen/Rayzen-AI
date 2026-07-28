---
titulo: "Anexo — Log de Commits por Era"
periodo: "2026-04-02 a 2026-07-24"
confianca: "alta"
---

# Anexo — Log de Commits por Era

Evidência bruta por trás da narrativa dos capítulos 1-7: os commits reais do repositório, em ordem cronológica, agrupados pelos mesmos limites de data usados no livro. Gerado a partir de `git log --format="%ad|%h|%s" --date=short`, sem edição de conteúdo — só agrupamento. Total: **503 commits** entre 2026-04-02 e 2026-07-24 (último commit no momento da escrita deste livro), distribuídos de forma muito desigual entre os meses: abril 53, maio 278, junho 166, julho 6.

Para verificar qualquer commit citado neste livro: `git show <sha> --stat` a partir da raiz do repositório.

---

## Era 1 — Gênese (2026-04-01 a 04-02) · ver [Capítulo 1](01-genese.md)

```
2026-04-02  f396396  feat: v0.1.0 — plataforma Rayzen AI completa
2026-04-02  1685dc8  docs: README redesign com badges, grid e ícones
```

---

## Era 2 — V1: Hardening e Maturidade (2026-04-03 a 05-17) · ver [Capítulo 2](02-v1-hardening.md)

142 commits. Lista completa:

```
2026-04-03  91dcf75  fix: corrige outlook, screenshot, pdf-parse e chat SSE
2026-04-03  c99affc  fix: auth headers, API URL env var, SSE parser e sessionId
2026-04-03  255bd91  fix: corrige erros de tipo TypeScript (implicit any)
2026-04-04  190f9d0  refactor: enterprise portfolio refactor — rename modules, validation layer, tests, docs, CI
2026-04-05  f334ad9  fix: corrige URLs antigas do frontend apos rename de modulos
2026-04-05  8a0921f  fix: corrige CI — prisma generate, PUPPETEER_SKIP_DOWNLOAD, typecheck web
2026-04-05  110d438  docs: adiciona roadmap de evolucao para orquestrador de contexto
2026-04-05  8771517  feat: fase 1 — project-aware (tabela projects + seletor na UI)
2026-04-05  6a4125b  feat: fase 2 — event log (tabela events + emissao automatica)
2026-04-05  7d4e7ad  feat: fase 2 — timeline de atividade na UI
2026-04-05  a1e54c4  feat: fase 3 — hooks Claude Code -> Rayzen
2026-04-05  fae9132  fix: corrige import ESM no Windows (file:// URL para hook.config.mjs)
2026-04-05  b9bd5d9  feat: fase 4 — sintese de sessao (decisions, next_steps, learnings)
2026-04-05  03df5ce  feat: fase 5 — documentacao viva (project_state, decisions_log, next_actions, work_journal)
2026-04-05  bb99f0e  feat: fase 6 — Obsidian export com deteccao de conflito
2026-04-05  9c9e2c4  feat: fase 7 — estado estruturado, checkpoint, captura rápida
2026-04-05  eea8847  feat: fase 8 — rastreabilidade, diff auditável e trilha de causalidade
2026-04-05  dfe1f56  feat: fase 9 — git-aware context
2026-04-05  1e26bcb  feat: fase 10 — inteligência proativa com 5 regras e agente de consistência
2026-04-05  617a350  docs: roadmap — fases 7-10 marcadas como concluídas
2026-04-05  0485af1  docs: add phases 11-14 to roadmap (planning, health score, memory, work modes)
2026-04-05  53084c0  feat(phase-11): planning operational — milestones, backlog, activeFocus, resume endpoint
2026-04-05  abfceaa  feat(phase-12): health score — compute, history, badge, breakdown modal
2026-04-05  d78338c  feat(phase-13): hierarchical memory — memory_class on events, auto-promotion, filtered context
2026-04-05  1ac7239  feat(phase-14): work modes — implementation, debugging, architecture, study, review
2026-04-05  b729a73  docs: mark phases 11-14 complete, update README with new capabilities
2026-04-05  418130c  fix(web): move activeProjectId useEffect after all useCallback declarations
2026-04-06  8009e64  feat: Notion, Mermaid, run_tests, inspect_schema, PrismaService global, doc confirmation, voice unification
2026-04-06  f14b36f  docs: upgrade enterprise do GitHub — README PT-BR, arquivos da comunidade, templates de issue
2026-04-07  78733ed  docs: atualiza README com descrição institucional e grid de screenshots real
2026-04-07  3d6ab83  docs: atualiza caption e imagem do PC Agent com fluxo real de 3 ações
2026-04-07  da46766  docs: adiciona 9 screenshots restantes e corrige captions
2026-04-07  a5359f9  fix(web): textarea no chat — Shift+Enter quebra linha, foco automático após envio
2026-04-07  f42894c  fix(tests): corrige mock EventService — emit → create em execution, orchestrator e memory specs
2026-04-07  b225462  fix(ci): ajusta coverage thresholds para valores medidos (functions 70%, branches 25%, lines 50%)
2026-04-07  cd1b824  fix(ci): deploy condicional via vars.DEPLOY_ENABLED — evita falha quando VPS não está configurada
2026-04-07  740a874  fix: corrige inconsistências de credibilidade documental apontadas em auditoria
2026-04-07  7a0c1cb  fix(web): corrige TS2322 — typeof narrowing em git.branch e git.commitHash
2026-04-08  442cede  Update README.md to add new badges and Tech Stack Visual section
2026-04-08  129cde9  Update README.md with new badges and tech stack visual section.
2026-04-08  fdfd53e  Revise README with project information and layout
2026-04-11  65973ac  feat: Brain + Wiki modules, Notion indexer, memory panel, project management
2026-04-11  e64aff2  test(memory): adiciona cobertura para indexGithub, indexFile, indexUrl, indexNotion, listDocuments e deleteDocument
2026-04-11  ece9eb9  fix(tsconfig): bump typescript to ^5.5.0 para suportar ignoreDeprecations=6.0 no CI
2026-04-11  0c03b83  docs(readme): corrige inconsistências — 103 testes, Brain/Wiki modules, Notion indexer, Next.js 15, threshold 70%
2026-04-11  a4eab08  fix: atualiza pnpm-lock.yaml após bump typescript ^5.5.0
2026-04-11  732a6c4  fix(docker): add platform linux/amd64 to postgres service
2026-04-11  eb08bcc  fix(docker): remove obsolete version field
2026-04-11  3c67a73  fix(docker): troca pgvector/pgvector por ankane/pgvector com suporte multi-arch
2026-04-11  0fddcb8  fix(bat): usa caminho relativo e copia .env para apps/api automaticamente
2026-04-14  1a86187  fix(docker): volta para pgvector/pgvector:pg16 com platform linux/amd64
2026-05-03  57363ab  chore: prepare isolated Rayzen local setup
2026-05-04  6a2a476  feat: improve memory imports and action confirmation
2026-05-06  425fcce  chore: stabilize remote rayzen setup and web client
2026-05-06  bb815a9  feat(memory): escopo de projeto por evento na atividade
2026-05-07  8e328ef  feat(agent): master bat + watchdog para notebook
2026-05-07  08d2f1d  feat(agent): restart_api + CLAUDE.md completo
2026-05-07  6165e1e  fix(agent): restart_api só executa no agente com AGENT_ROLE=notebook
2026-05-07  c2ac720  feat(web): polling automático no painel de atividade (5s)
2026-05-07  5245f95  fix(notebook): API e ngrok com janelas visíveis, agente em background
2026-05-07  9ed8c25  fix(notebook): mata processos Node antes do build para evitar EPERM
2026-05-07  6688be7  fix(notebook): taskkill antes do prisma generate para evitar EPERM no dll
2026-05-07  ae9e2e9  fix(notebook): mata ngrok.exe antes de subir novo tunnel
2026-05-07  bad5b35  feat: auto-index edited files into pgvector via Claude Code hook
2026-05-07  ffcb569  fix: teach orchestrator to recognize and dispatch jarvis:restart_api
2026-05-07  1b5e1b7  feat: auto-resolve project by name in hook — no UUID needed per project
2026-05-07  dbaea41  docs: add QA + data governance expansion roadmap (3 layers, 9 phases)
2026-05-07  a297ac9  feat(qa): Phase 1.1 — JUnit/Allure report parser + QA tracking module
2026-05-07  4a78d5e  feat(qa): Phase 1.2 — flaky test detection + QA summary action
2026-05-07  b06ea33  docs: mark QA phases 1.1 and 1.2 as complete
2026-05-07  c0b5c48  feat(qa): Phase 1.3 — CI/CD webhook for test report ingest
2026-05-07  f957311  feat(data-quality): Phase 2.1 — data quality rules and contracts
2026-05-07  aa535a9  feat(data-quality): Phase 2.2 — schema change alerts
2026-05-07  9b657b6  feat(data-catalog): Phase 3.1+3.2 — conversational catalog and lineage
2026-05-07  3f6331c  feat(compliance): Phase 3.3 — LGPD compliance artifacts
2026-05-07  f75b160  docs: mark all QA+governance phases as complete in roadmap
2026-05-07  44a3f33  feat(notion): per-project database sync
2026-05-07  d2b8339  feat(notion): auto-create project pages from root page
2026-05-07  aeec572  config: set Obsidian vault path and Notion root page ID
2026-05-07  ecdde1c  feat(web): memory panel with type badges and project color tags
2026-05-07  d4db761  fix: synthesis JSON parse + Notion indexing error handling
2026-05-07  36e9f31  fix(web): show inferred project badge and relative path in memory panel
2026-05-07  3088df2  fix(synthesis): remove response_format, add robust JSON extraction for Claude
2026-05-07  1b714f0  fix(memory): type badge priority + robust Notion title extraction
2026-05-07  f2b6ee9  feat(web): scoped memory panel by project + clearer chunk display
2026-05-08  ffb9447  feat: repoSlug auto-detect + filter empty session events
2026-05-08  30ed063  feat: Rayzen Goal Graph — meta vs estado + gap analysis + repoSlug
2026-05-08  6f6c12b  docs: Goal Graph — ideia, plano e resultado documentados
2026-05-09  61c4ca1  fix(web): remove onLoad do Script Mermaid — Server Component não aceita event handlers
2026-05-09  4507f7f  fix(web): Mermaid via render() + dangerouslySetInnerHTML, auto-load ambos modos ao abrir grafo
2026-05-09  16bd9f8  fix(web): mermaid render com fallback texto + openGraph com erro explícito se API falhar
2026-05-09  3ce04ac  feat(web): botão 'gerar estado' no painel Grafo — dispara state/refresh sem sair do modal
2026-05-09  2d27e7b  fix(web): substituir CDN Mermaid por import npm dinâmico — resolve falha de carregamento
2026-05-09  e7dc3f6  fix(graph): corrigir Mermaid travado em gerando diagrama
2026-05-09  6629982  fix(web): usar CDN mermaid injetado dinamicamente em vez de npm import — mais confiavel no browser
2026-05-09  2a1157a  fix(web): mostrar mmd como texto quando SVG nao disponivel — elimina 'Gerando diagrama' preso
2026-05-09  2be5b5c  fix(graph): usar mermaid npm package direto (CDN v11 nao suporta UMD global) + remover emoji do fallback
2026-05-09  3026267  fix(graph): remover emojis dos labels mermaid + serverExternalPackages para mermaid npm
2026-05-09  499d389  fix(web): checar res.ok antes de parsear json do graph — ignora respostas 500 sem quebrar o painel
2026-05-09  19729b7  feat(web): substituir Mermaid por React Flow — GraphCanvas com nodes interativos para estado e goal graph
2026-05-09  9f5b05b  feat(graph): visual futurista com glow + CRUD nodes (criar/editar/deletar/status) + salvar via API
2026-05-09  9c4a70d  fix(web): corrigir tipos NodeProps para @xyflow/react v12 — build passando
2026-05-09  88d2eaf  docs: atualizar CLAUDE.md e goal-graph.md — React Flow Fase 2, CRUD, ADR 016, stack atualizada
2026-05-09  0dab3f8  docs: adicionar templates de projeto (CLAUDE.md + project.md) para onboarding de novos projetos
2026-05-10  ece7411  feat(graph): Fase 3 — KPI tracking, goal history, stagnation alert, onboarding wizard, criteria CRUD
2026-05-10  3b15034  feat(graph): Event Graph — eventos mapeados por milestone via LLM
2026-05-10  f662e04  fix(bat): remover chcp 65001 que quebrava parsing de comandos no cmd.exe
2026-05-10  455377e  feat(mcp): Rayzen MCP Server — Claude lê e escreve no Rayzen durante sessão
2026-05-10  4ddbf0d  fix(mcp): usar pathToFileURL para importar hook.config.mjs no Windows
2026-05-10  f0f3d65  fix(bat): notebook-api-tunnel vira script principal — agente watchdog incluido, pause no final
2026-05-10  0d15318  fix(web): exibir erro do orchestrator no placeholder da mensagem vazia
2026-05-10  c4e9629  feat(settings): provider switcher LLM (Groq/Claude) + dashboard de uso e custo
2026-05-10  badff1a  fix(bat): reiniciar LiteLLM sempre ao abrir notebook-api-tunnel
2026-05-10  d94e50b  feat(wiki): POST /wiki para criacao direta sem pipeline LLM
2026-05-10  70b706a  feat(graph): Event Graph sofisticado — todos os sources, swim lanes, legenda de cores
2026-05-10  8783b10  fix(graph): filtrar eventos de ruído do Event Graph (Sessão encerrada/iniciada)
2026-05-11  7e81c85  feat(graph): rename endpoint + accordion de critérios no histórico de metas
2026-05-11  07bd3a1  fix(graph): ocultar goals cancelados do histórico de metas
2026-05-12  7e27dea  Improve Goal Graph CRUD and persistent links
2026-05-13  2265460  fix(orchestrator): injetar contexto de projeto e brain em todo chat
2026-05-13  d8f31cc  fix(p0): estabilizar verdade do sistema — qualidade, QA, catálogo, api-client
2026-05-13  b26b488  refactor(web): extrair hooks de domínio de page.tsx (P1)
2026-05-13  a7e0e2f  fix(orchestrator): isolamento de projeto no chat + contexto rico (P2)
2026-05-13  24306ec  fix(scripts): adicionar prisma generate antes do build no restart-api.ps1
2026-05-16  d8158d9  feat(agent): runners maven/gradle/pytest/newman no jarvis:run_tests (QA Etapa 1)
2026-05-16  6dc0500  feat(agent): jarvis:capture_test_failure — captura falhas Selenium + indexação (QA Etapa 2)
2026-05-16  2544335  feat(web): dashboard QA — resumo, tendência e histórico de runs (QA Etapa 3)
2026-05-16  ad28cc7  feat(qa): organizar screenshots por projeto + template rayzen + manual de QA
2026-05-16  0058569  fix(scripts): matar API antes do prisma generate para evitar EPERM na DLL
2026-05-16  228cc34  feat(agent): roteamento por role — notebook vs desktop
2026-05-16  b4e39dd  docs(templates): adicionar seção 8.2 Rayzen AI ao onboarding de projeto
2026-05-16  7ba65a0  feat(agent): criar projeto no Rayzen automaticamente + hook auto-detect por repoSlug
2026-05-16  09c9d07  docs: atualizar hook para auto-detect por repoSlug em todos os docs
2026-05-17  d3d450d  fix(web): add safe session id fallback without secure crypto
2026-05-17  dc6e27d  docs: align project templates with VPS agent setup
2026-05-17  acc8859  feat(web): explain how to create and link projects
2026-05-17  95d232a  feat(agent): split desktop and server roles
2026-05-17  f4f9f8c  fix(agent): include base tsconfig in server image
2026-05-17  20b7d17  fix(agent): label server role in startup logs
2026-05-17  53507a4  chore(agent): expose server docker logs action
2026-05-18  3f791fb  fix(agent): allow desktop launcher on node 20 plus
```

---

## Era 3 — Consolidação VPS e Último Polimento (2026-05-18 a 05-28) · ver [Capítulo 3](03-consolidacao-vps.md)

```
2026-05-18  7f1e6d8  feat(evidence): sync project screenshots to web
2026-05-19  6a551e5  fix(docs): prompts usam Estado atual como fonte autoritativa
2026-05-19  5668319  fix(docs): auto-refresh ProjectState antes de gerar + limitar sínteses a 30 dias
2026-05-19  836d2e1  feat(pipeline): checkpoint dispara auto-refresh de estado + docs em background
2026-05-19  9619b43  feat(graphify): integração graphify → ProjectState em 3 camadas
2026-05-19  37882b7  docs(claude-md): atualizar documentação — ADRs 023-027, pipeline automático, graphify
2026-05-19  09b890f  fix(web): atualizar tela de boas-vindas com guia de primeiro dia
2026-05-19  e7b01d0  feat(web): seletor de pasta no modal de novo projeto
2026-05-19  bed16e7  fix(web): persistir projeto ativo no localStorage ao auto-selecionar
2026-05-19  863ff4d  fix(web): mover setActiveProjectId antes do useEffect que o usa
2026-05-19  9ba1225  fix(web): inicializar activeProjectId direto do localStorage no useState
2026-05-19  b345935  fix(web): corrigir persistência de projeto — SSR descartava lazy initializer
2026-05-19  6ba5ada  fix(ci): remover version: 10 do pnpm/action-setup — conflito com packageManager no package.json
2026-05-19  5f2a7ae  fix(ci): corrigir filter glob e adicionar --if-present nos scripts lint e typecheck
2026-05-19  62d2fd4  fix(web): substituir padrão useRef-during-render por useEffect em GraphCanvas
2026-05-19  1bb0b8e  fix(web): substituir @ts-ignore por @ts-expect-error em page.tsx
2026-05-20  3603de2  feat(schema): adicionar ProjectKnowledgeMap para Universe canvas
2026-05-20  b52efc0  feat(universe): canvas livre de conhecimento por projeto — CRUD, posicionamento livre, import de dados do projeto
2026-05-20  01f5991  fix(universe): corrigir erros de tipo Prisma Json e lint no UniverseCanvas
2026-05-20  2b59dea  feat(rayzen): Universe auto-build on checkpoint + recomendacoes com modulos
2026-05-20  c38054f  feat(signal-contract): filtro de ruído + intent + checkpoint automático ao Stop
2026-05-20  31f755d  fix(docs): corrigir ordem do diário e filtro agressivo de next_actions
2026-05-20  1371b3d  fix(web): Regenerar sempre passa force=true + expõe erro no console
2026-05-20  27aa90e  feat(blueprint): módulo de importação estruturada de planos externos
2026-05-21  11f25bd  docs(blueprint): template de intake e guia de uso
2026-05-21  9d77c71  feat(web): botão Blueprint com modal de templates de planejamento
2026-05-21  03e0484  feat(blueprint): V1.1 — slug hash, Set warnings, content limit, resolveProjectId, blueprint-intake no template
2026-05-21  795fc59  feat(blueprint): histórico de imports — BlueprintImport model, GET /projects/:id/blueprint/imports, aba Histórico na web
2026-05-21  f7b3efb  feat(blueprint): rayzen_blueprint_create_feature_plan — LLM gera Blueprint com contexto do ProjectState
2026-05-21  8b11695  feat(blueprint): upload de .md na web — aba Upload no modal BP com drag&drop, preview e import direto
2026-05-22  6513f5f  feat(qa): camadas 2 e 3 — abas Qualidade de Dados e Catálogo no QA Dashboard
2026-05-22  5f772a9  feat(notion): botão Publicar no Notion no painel de Docs — fecha milestone m2
2026-05-22  a263256  fix(security): auditoria estática — 10 fixes SEC-1 a SEC-10
2026-05-22  bdcdc1c  feat(perf): LLM cache + Redis cache + cost analysis
2026-05-22  68682cd  fix(event): rayzen_add_event MCP envia content direto para /events/cli
2026-05-22  cb58312  fix(brain): invalidar cache de busca ao indexar documento
2026-05-22  aed45a7  fix(litellm): remover similarity_threshold ignorado em type:redis
2026-05-22  8bb0b35  feat(costs): registrar ConversationMessage em todos os módulos LLM
2026-05-22  fd52276  docs: atualizar README, architecture e roadmap para estado v1.0.0
2026-05-22  031908a  fix(ops): fechar achados de auditoria — env, healthchecks e DEPLOYMENT.md
2026-05-22  6ccd027  feat(coverage): elevar thresholds + corrigir testes + hardening run_command
2026-05-22  8afaf03  fix(docker): healthcheck usa node ao invés de wget (wget não existe na imagem slim)
2026-05-22  4ee13c5  fix(security): fechar achados auditoria — C2/C4/C5/C6/C7/C8
2026-05-22  eddf932  feat(security): testes auth/agent-bridge/path-guard + prod hardening
2026-05-22  f73f14c  feat(security): helmet headers + agent audit log
2026-05-23  5dd234d  feat(observability): E2E tests + Prometheus /metrics endpoint
2026-05-23  ce15c6a  fix(helmet): downgrade @fastify/helmet v13→v11 (NestJS 10 usa Fastify 4.x)
2026-05-23  b5e2032  docs: atualiza README PT/EN com todos os entregáveis da sessão
2026-05-23  ce640ae  feat(observability): Prometheus hookup + unit tests + CI E2E
2026-05-23  3052cce  ci: remove deploy job — Azure NSG bloqueia IPs do GitHub Actions
2026-05-23  27540a5  docs: sincroniza toda documentação com entregáveis da sessão
2026-05-23  14d00eb  feat(metrics): hookup LLM token counters in all remaining modules
2026-05-23  12d5a1b  docs: atualizar nome do repositório de rayzen-ai para Rayzen-AI
2026-05-23  71219dc  security: remover IP da VPS de todos os arquivos commitados
2026-05-23  9b26e40  fix(web): passar API_URL como build arg no docker-compose
2026-05-23  3d2bad4  docs(presentations): atualizar com entregáveis recentes
2026-05-23  50334ba  feat(qa): strategy doc + 25 security tests + README fixes
2026-05-23  9bb0661  feat(web): redesign visual — dashboard profissional (Linear/Vercel)
2026-05-23  bf3f511  fix(web): nav pills com borda visivel + botoes mais definidos
2026-05-23  4a03507  fix(web): nav items com borda visivel no estado padrao
2026-05-24  4f3b570  feat(brand): ícone Rayzen AI — grafo de nós (SVG)
2026-05-24  9c8590f  docs(readme): adiciona logo Rayzen AI no topo
2026-05-24  c75feb2  fix(brand): ícone maior no readme (120px) e no header (34px, sem quebra)
2026-05-24  c938333  feat(infra): Caddy reverse proxy com HTTPS para MCP (nip.io + Let's Encrypt)
2026-05-24  b6394eb  fix(mcp-http): parsear body como JSON antes de passar ao transport
2026-05-24  688b2b7  fix(header): brand shrink-0 — impede truncar atrás do seletor de projeto
2026-05-24  28e5ae9  docs: slides interativos + cover LinkedIn (HTML)
2026-05-24  a1b6086  fix(header): left container shrink-0 — brand não encolhe mais
2026-05-24  28c29fe  chore(privacy): CLAUDE.md versão pública + .gitignore atualizado
2026-05-24  1d70c4b  chore(privacy): dois repos — privado (workflow pessoal) + público (código limpo)
2026-05-24  19f94c1  fix(cost): trocar modelos premium por Groq no checkpoint pipeline
2026-05-24  8ad8a9d  fix(checkpoint): async response + limit tokens + state-refresh fallback
2026-05-24  f151fd4  fix(universe): reimportar sempre após checkpoint + filtrar artifacts inválidos
2026-05-24  aaee35f  feat(cost): Ollama local + 3-tier LLM — classify, graph e proactive em Tier 0
2026-05-23  a4a4abf  feat(mcp): HTTP/SSE transport para Claude Desktop
2026-05-25  950e85b  fix(graph): Goal Graph auto-atualiza após checkpoint
2026-05-25  4177d39  feat(supervisor): Claude Code + Telegram bridge para sessões autônomas
2026-05-25  be4ebbd  fix(supervisor): usar child_process.spawn em vez de node-pty
2026-05-25  8d15707  fix(cost): remover fallback Claude de gpt-4o/gpt-4o-mini — Groq rate limit nao deve gastar credito Anthropic
2026-05-25  d1fdbfe  feat(settings): toggle Qualidade Premium no estado do projeto
2026-05-25  575b3c5  fix(project): add cascade deletes + fix deletion UI bug
2026-05-25  e23b941  feat(docker): auto-run prisma migrate deploy on API startup
2026-05-25  4fd7463  fix: unify database name to rayzen_ai across all references
2026-05-25  d1614f4  fix(telegram): bot responde mensagens sem sessão ativa + comando /status
2026-05-25  6743dc1  fix(docker): migrate deploy não bloqueia startup em caso de erro
2026-05-25  1a92173  fix(ui): folder picker usa input[webkitdirectory] em vez de showDirectoryPicker
2026-05-26  a0afcd2  fix(graph): universe filtra wiki pages por projeto via source documents
2026-05-28  c658740  feat(caddy): adicionar domínio rayzen.com.br (provisório na VPS)
2026-05-28  57915c3  fix(web): remover campo de URL da tela de login
2026-05-28  7e7dc52  fix(web): getApiUrl sempre usa DEFAULT_API_URL como fallback
2026-05-28  faffcd8  security: bind portas 3100/3101/3102 ao localhost
2026-05-28  194e754  fix(wiki): remover response_format json_object — Groq json_validate_failed
2026-05-28  eebbd96  fix(wiki): extração JSON robusta com sanitização de control chars
```

---

## Era 4 — Nascimento da V2 (2026-05-29 a 05-31) · ver [Capítulo 4](04-nascimento-v2.md)

```
2026-05-29  4d6c200  feat(v2): scaffold completo do apps/api-v2 — Mission Engine fase 1
2026-05-29  4a62661  chore: atualizar pnpm-lock.yaml com workspace api-v2
2026-05-29  3d5cbc2  fix(v2): corrigir tipos Json nos campos Prisma + gerar client V2
2026-05-29  4dc76f2  docs(v2): adicionar Vault Engine (021) — camada de segredos
2026-05-29  00f34fd  docs(v2): fechar gaps de arquitetura — runtime, interface e dados
2026-05-29  b7e680f  fix(config): trocar provider LLM via API dinâmica do LiteLLM
2026-05-29  3410e71  docs(v2): criar blueprints de arquitetura Rayzen AI V2
2026-05-29  d9be558  docs(v2): adicionar blueprint 016-telegram-agent
2026-05-29  eed7403  docs(v2): adicionar ADR-016 e blueprint Knowledge Engine
2026-05-29  62ec7e9  docs(v2): refinamento da arquitetura V2 — Mission Oriented Engineering System
2026-05-29  9bc4490  docs(v2): corrigir numeração dos blueprints — sem conflitos
2026-05-29  1f0c8ef  feat(mcp): implement OAuth 2.0 Authorization Code flow for MCP HTTP server
2026-05-29  e23128a  feat(web): adicionar favicon.svg com ícone do Rayzen
2026-05-29  a40c91d  fix(caddy): adicionar rota /mcp no domínio rayzen.com.br
2026-05-30  efccdf8  fix(v2): mover Prisma client gerado para generated/ (fora de src/)
2026-05-30  3335fd3  feat(v2): Router + LlmService — POST /v2/route classifica e cria missões
2026-05-30  eb8b3f0  feat(v2): Memory Engine — lifecycle sobre storage V1
2026-05-30  bd587be  fix(v2): corrigir parsing de resposta V1 /memory/search — usar sources
2026-05-30  285a423  feat(v2): Fase 2 — AI Router + Context Engine + Skill Engine
2026-05-30  0b84245  feat(v2+v1): Vault Engine + Telegram Agent completos
2026-05-30  ea35484  fix(telegram): remover circular dep — orchestrate via HTTP local
2026-05-30  4f1f66a  feat(v2): Knowledge Engine + Project Memory — Fase 2 completa
2026-05-30  4ce318b  feat(v2): KnowledgeGraphBuilder — POST /v2/knowledge/build/:projectId
2026-05-30  3f78261  feat(v2): Fase 3 — Approval Gates + Dynamic Workflows + QA Engine + Documentation Engine
2026-05-30  9b53b6c  fix(mcp): persistir tokens OAuth em arquivo — elimina re-auth a cada restart
2026-05-30  cb183ce  feat(v2): Fase 5 — Specialists (Specialist Factory on-demand)
2026-05-30  3b80639  fix(hook): resolução robusta de projeto por slug — corrige eventos não vinculados
2026-05-30  60bd5f0  fix(mcp): JSON malformado não derruba mais o servidor
2026-05-30  277bf92  feat(hook): aviso ativo e visível quando resolução de projeto falha
2026-05-30  3eb3ace  docs(A-001): alinhar contagem de ações do Agent — 34 (whitelist é a fonte)
2026-05-30  6ec2114  feat(A-008): gerador de catálogo de ações + matriz de risco
2026-05-30  60230c7  fix(A-002): corrigir teste do Orchestrator + alinhar contagem real de testes
2026-05-30  68ae1f3  fix(hook): stale-while-error — hiccup de rede não desvincula mais eventos
2026-05-30  a00f6df  feat(web): badge de saúde do hook no painel de Atividade
2026-05-30  21acd5f  feat(A-009): scanner de dados sensíveis + inventário gerado
2026-05-31  8b497d9  docs: manual de uso operacional + arquitetura
2026-05-31  e4a7ad7  chore: remover Prisma client gerado do git (-71MB) + gitignore
2026-05-31  5af051b  docs: enxugar CLAUDE.md (227->~95) movendo tabelas de referência para docs
2026-05-31  6b42b72  fix: ancorar ProjectState na meta do Goal Graph + filtrar ruído operacional
2026-05-31  3cc8a29  fix: aplicar filtro de ruído + meta do Goal Graph na geração de docs
2026-05-31  f1c7386  fix: filtro de ruído pega formas PT (testar/checar) — faltava no regex
2026-05-31  8094fb0  chore: remover IP exposto do Caddyfile (nip.io) + legados .ps1
2026-05-31  fc58d35  docs: regenerar inventário — 0 segredos versionados (A-009 fechado)
2026-05-31  ea31c6b  feat(web+v2): painel Missões V2 + correção extractJson
2026-05-31  d94b577  fix(api-v2/router): planResult fora do try para log no catch
2026-05-31  5878bc3  feat(v2-6): docs automáticas ao concluir missão
2026-05-31  5e810ee  fix(workflow): docsGenerated no early return
2026-05-31  9b9df8b  feat(v2): Context Broker no fluxo + Conversation Pipeline + Work Panel
2026-05-31  3e7feee  fix(context-engine): renderização robusta de milestones/critérios (objeto vs string)
2026-05-31  25d6fa7  feat(agent): loop de aprovação por etapa no supervised-session
2026-05-31  f4b5c9a  feat(work-panel): ApprovalCard + sessão assistida com aprovação por etapa
2026-05-31  ce1b26b  fix(migration): agent_session_approval idempotente (ADD COLUMN IF NOT EXISTS)
2026-05-31  388ba90  feat(agent): Fase 1 — Broker→Claude real + protocolo de marcadores
2026-05-31  c341e3f  feat(web): botão 'work panel' no header principal
```

Nota: um incidente de governança de dados (limpeza de corrupção `U+FFFD`, quase-exclusão da meta ativa de um projeto cliente) aconteceu em 2026-05-31, dentro desta era — narrado no capítulo 5 por pertencer tematicamente ao padrão de fragilidade operacional daquele capítulo, não a este.

---

## Era 5 — Turbulência de Junho (2026-06-01 a 06-25) · ver [Capítulo 5](05-turbulencia-junho.md)

```
2026-06-01  f53447d  fix(api-v2): permitir header ngrok-skip-browser-warning no CORS
2026-06-01  694d3d0  feat(v2): Fase 3.1 — BDE descoberta conversacional + geração de Blueprint
2026-06-01  6ebcc31  fix(discovery): blueprint resiliente — gpt-4o-premium com fallback p/ mini + erro claro (evita 500 no 429 do Groq)
2026-06-01  e14260b  fix(discovery): tipar messages como LlmMessage (as const) — corrige build
2026-06-01  b291073  feat(web): kit de retomada por projeto nos Comandos rápidos
2026-06-01  b142351  feat(v2): Fase 3.2 — UI de descoberta (BDE) + criação de projeto padrão Rayzen
2026-06-01  1cb1336  fix(agent): resolução robusta da raiz do monorepo no create_project_folder
2026-06-01  ab17e5f  fix(auth): token JWT do web expira em 30d (alinhado ao cookie)
2026-06-01  12c2aab  fix(discovery): 400 em blueprint/spec (corpo vazio) + entendimento melhor
2026-06-01  a3cbd01  feat(security+v2): guard JWT global + sessão supervisionada com transcript ao vivo
2026-06-02  b241c4b  feat(discovery): persistencia de sessoes no DB + template extract_from_client
2026-06-03  1941b69  feat(v2): SkillOpt — skills como first-class assets com uso rastreado
2026-06-03  04d2fff  feat(v2): Lineage Engine — rastreabilidade Requirement→Decision→ADR→Code→Test
2026-06-03  ab725e1  feat(v2): Policy Engine — regras de governança configuráveis por projeto
2026-06-03  1b106c8  feat(knowledge): Knowledge Governance Layer — ECC + Trust Score
2026-06-03  916c742  fix(work-panel): Suspense boundary para useSearchParams (Next.js 16 Turbopack)
2026-06-03  a6acfd5  fix(work-panel): force-dynamic para suportar useSearchParams sem prerender error
2026-06-03  11f4ffd  fix(work-panel): carregar sessao supervisionada via ?session=<id> na URL
2026-06-04  3c3a517  feat(v2): Ciclo 1 + Ciclo 2 Peça 1 — Context Broker, Mission Bridge, Specialist Agents
2026-06-04  5760128  feat(web): Voice Input — botão mic no work-panel transcreve via Whisper
2026-06-04  9c221f7  feat(v2): Catalog Service — projetos como assets formais com owner, provenance e tags
2026-06-04  2106606  feat(web): Mission Dashboard — /mission e /mission/:id
2026-06-04  68ec3bc  fix(web): remove 'novo projeto' do nav principal
2026-06-04  b3ac0c5  feat(web): botão 'trabalhar' em /mission/:id abre work-panel com objetivo pré-carregado
2026-06-04  1b77a06  fix(web): unificar nav de missões + corrigir loading infinito em /mission
2026-06-04  68d87e9  feat: WebSocket Gateway (api-v2 :3104) + Electron Widget scaffold
2026-06-04  fc00838  fix(api-v2): configure WsAdapter for WebSocket gateway on port 3104
2026-06-04  c3d636a  fix(infra): expose WebSocket port 3104 in docker-compose for widget
2026-06-04  da3b8a5  feat(widget): script widget-start.bat + atalho desktop + dotenv auto-load
2026-06-04  475c8ce  fix(widget): node-fetch → fetch nativo + rayzen-start.bat (agent+widget juntos)
2026-06-04  d9e9796  fix(widget): align outDir dist→out (electron-vite v3 default)
2026-06-04  7876e35  fix(widget): electron binary — onlyBuiltDependencies no root workspace
2026-06-04  f742dca  fix(widget): remove Tray+empty icon crash, simplify main process startup
2026-06-04  77c90c7  feat(widget): project selector, mission objectives, filter, history toggle, chat input
2026-06-04  81e170c  fix(widget): ws dot verde ao conectar + timer 2min no connected event
2026-06-04  09e1ce9  fix(widget): remove auto-openDevTools em dev mode
2026-06-04  4ac7744  revert(widget): restore DevTools in dev mode (useful for debugging)
2026-06-04  5a0df66  feat(agent): quality upgrade — 43 actions, file ops, smart terminal, git completo, prisma
2026-06-04  c6e3204  fix(widget): ws dot timing — query status on mount + renderer:ready handshake
2026-06-05  1a96bcf  fix(router): wrap classify LLM call in try/catch — evita 500 quando Groq/LiteLLM falha
2026-06-05  2509203  fix(work-panel): MissionParamLoader re-injetava input em loop infinito
2026-06-06  4b36348  feat: fases A+B+C — infra health, context broker, agent executor
2026-06-06  59b69f1  fix(widget): clear ELECTRON_RUN_AS_NODE before spawning Electron
2026-06-06  f51d2db  fix(infra): docker-compose env para health check v2 e mcp
2026-06-11  f6531cc  feat(mcp+infra): add rayzen_list_specialists to HTTP MCP + Fable 5 no LiteLLM
2026-06-11  669be0c  fix(web): executar/retomar mission chama workflow engine via /v2/workflows/missions/{id}/execute
2026-06-11  b9ffcf2  feat(rayzen): pivot para cérebro de memória/QA — executor de missões congelado
2026-06-11  0512df2  infra: deploy.sh determinístico para notebook local
2026-06-11  c26a1b4  docs: atualiza manual-de-uso para nova direção do Rayzen (2026-06-11)
2026-06-12  bdcee43  feat(web): login scanline reveal + HUD constellation background
2026-06-12  0b8a538  fix(login): imagem 404, scan loop infinito, autofill escuro
2026-06-12  8a1f3cb  fix(constellation): nós maiores — dot 5px+glow, anel interno, halo 44px, label 12px bold, opacidade 75%
2026-06-12  8bd1526  feat(hook): UserPromptSubmit inteligente — classifica intenção + contexto cirúrgico
2026-06-12  03e80a9  feat(qa): pipeline de ingest + badge no HUD
2026-06-12  1e7e4d3  feat(catalog): auto-register de assets via hook PostToolUse
2026-06-12  4f0695a  feat(checkpoint): proposta de goal progress após checkpoint
2026-06-14  17ba6cd  feat(context-broker): surgical context endpoint + SkillOpt auto-sync
2026-06-14  3dc3a97  fix(context-broker): deduplica policy_constraints (project rule vence system rule)
2026-06-14  319e923  feat(conversation-persistence): turns indexados no Brain + hook Stop
2026-06-14  e54c68d  feat(conv-to-mission): bridge NL para Mission V2
2026-06-14  92be0e4  feat(result-loop): automatic result loop completo no MissionEngine
2026-06-14  da726dc  feat(context): missão ativa no hook + GET /v2/missions/next-pending + help system
2026-06-14  ed52ed0  feat(help): HelpTip no work-panel
2026-06-15  950a57e  fix(hook): blockers como objetos causavam [object Object] no fallback
2026-06-15  43acf0a  feat(ciclo2): Specialist dispatch + step execution loop
2026-06-15  7ec9a58  feat(ciclo2): auto-chain de steps + live WebSocket update
2026-06-15  e32edd6  feat(riom): Fase 1+2 — SOUL, SecurityWall, Services, Agents, Skills, ToolRegistry
2026-06-17  b631a1f  feat(audit): Fases 1-4 do plano de melhorias — gate-resume, SkillEngine, health UX e decomposição do page.tsx
2026-06-17  bb9a49e  feat(cicd): webhook do GitHub builda imagens automaticamente, agente promove via run_command
2026-06-17  ce1179d  fix(caddy): desabilitar HTTPS automatico nos sites por tras do Cloudflare Tunnel
2026-06-17  e22f7dc  fix(agent): instalar plugin docker compose v2 na imagem do agent-server
2026-06-17  c661615  fix(agent): montar projeto no agent-server para docker compose enxergar o compose file
2026-06-17  577af18  fix(agent): fixar COMPOSE_PROJECT_NAME=rayzen-ai no agent-server
2026-06-17  d55976e  fix(ci): gerar Prisma client v2 antes do typecheck/lint/test
2026-06-17  70f9b08  fix(lint): adicionar eslint.config.mjs no api-v2 e corrigir erros reais no web
2026-06-17  4eae487  fix(web): surfar erros do Goal Graph/Estado em vez de falhar silenciosamente
2026-06-17  8412f2b  fix(agent): montar projeto no mesmo path absoluto do host (nao /host)
2026-06-17  8f0c1f7  fix(hook): aviso de resolucao falha nao recomenda mais hardcode de projectId
2026-06-17  29f1366  feat(project-state): refresh incremental ancorado no estado atual
2026-06-17  ca8aaba  fix(project-state): nextSteps incremental nao resampleia criterios pendentes
2026-06-18  80d0d3f  fix(router): planejamento de missao nao inventa mais skillId invalido
2026-06-18  96a1e73  fix(mission): StepExecutorService.runNext finaliza status da missao
2026-06-18  9c93f4e  fix(mission): chamar processCompletion na finalizacao automatica tambem
2026-06-19  e2acb22  feat(mission): tool-use real para executor "ai" via SkillEngine
2026-06-20  357030f  fix(mission): corrige schema de jarvis:file_read e escalacao indevida pro Claude
2026-06-20  123a716  fix(skills): dispatch real do executor:skill estava sempre quebrado
2026-06-20  fc012a4  fix(agent): file_read/file_write resolvem path relativo contra AGENT_PROJECT_ROOT
2026-06-21  fed0172  fix(mission): corrige 3 bugs estruturais no motor de missoes V2
2026-06-21  c1a9732  feat(qa): fecha o loop do qa-1 — CI ingere JUnit no Rayzen automaticamente
2026-06-21  4219f7b  fix(mission): respeita executor:human nos dois engines de step
2026-06-21  e689444  fix(mission): StepExecutorService despacha executor:skill direto via SkillEngine
2026-06-21  1632087  fix(mission): WorkflowEngineService nao marcava step 'done' quando specialist era interrompido por gate
2026-06-21  13ef071  fix(mission): reaproveita gate ja aprovado em vez de criar outro a cada retry
2026-06-22  21a90f1  feat(web): UI para concluir steps de acao humana em missoes
2026-06-22  3f9bbb5  fix(graph): toggleCriteria sincroniza ProjectState — sem isso nextSteps fica desatualizado pra sempre
2026-06-22  df5a5fc  fix(graph): toggleCriteria cria evento de decisao — refresh() sozinho nao bastava
2026-06-22  da71a4c  fix(graph): forwardRef no import de EventModule — corrige crash-loop em producao
2026-06-22  d01aec4  feat(qa): padroes de flaky tests viram learnings e surfaceiam em rayzen_get_context
2026-06-22  afc6b8e  fix(graph): valida saida do gap-analysis antes de usar em sanitize() — corrige 500 em /graph/goal
2026-06-22  6f7d964  fix(graph): sanitize() aceita unknown — corrige causa raiz real do 500 em /graph/goal
2026-06-22  581a6e7  feat(lineage): cat-2 — lineage real de arquivo via graphify, sincronizado pro servidor
2026-06-22  bf9a87b  feat(lineage): cat-3 — impact analysis antes do deploy (script local + step de CI)
2026-06-22  db6a9bc  feat(synthesis): goal-2 — checkpoint avisa sobre criterios possivelmente concluidos
2026-06-22  3275aef  fix(goal-2): proposta de criterio sobrevive entre sessoes via nextSteps
2026-06-22  4f6bfad  chore: limpeza de repo — remove infra Azure morta, fecha drift de docs, corrige IP stale
2026-06-22  855238b  fix(ci): CI quebrado nos ultimos 3 pushes — OpenAI client sem fallback de apiKey
2026-06-23  6192f0d  fix: uuid-curto literal nos milestones + persistência de projeto no reload
2026-06-23  0ede0b5  fix: dedup de memória duplicada no search + Glob/Web fora do ruído de eventos
2026-06-23  0ab0567  feat(fase-0): estabilização + Langfuse + gate events + V2 missions UI
2026-06-23  dead225  chore(api-v2): atualiza lockfile para @nestjs/platform-ws e websockets ^10.0.0
2026-06-23  d3a8f39  fix(api-v2): corrige specs após injeção de EventsService + Langfuse v2 no compose
2026-06-24  9abf86a  fix(langfuse): banco dedicado langfuse — evita conflito com schema public do Rayzen
2026-06-24  9daafc8  feat(infra): adiciona cloudflared ao compose — tunnel nunca mais vira orphan
2026-06-24  7f56633  feat(benchmark): Fase 1 — Benchmark Engine com BenchmarkCase/BenchmarkResult
2026-06-24  4049df4  feat(agent-dialogue): Fase 2 — clarificação ativa antes de agir em contexto ambíguo
2026-06-24  9fed27b  feat(evolutionary): Fase 3 — Evolutionary Prompting com ciclo mutação/benchmark/gate
2026-06-24  ce4d27a  fix(api-v2): remove prefixo /v2 duplicado nos controllers benchmark e evolutionary
2026-06-24  64b6870  fix(graph): retornar state junto com mermaid no GET /projects/:id/graph
2026-06-24  8d369c2  fix(specialists): crash ao executar step com domain desconhecido no registry
2026-06-24  b1fca41  fix(specialists): false-positive de 'adr' em palavras portuguesas + architect sem approval
2026-06-24  b523a5d  feat(web): adiciona botão Missões V2 no header
2026-06-24  72a1176  feat(qa-scientist): Fase 5 — AI Scientist QA com ciclo autônomo hipótese/experimento/gate
2026-06-24  a4e4f65  fix(qa-scientist): extrair JSON do LLM com regex mais robusto (ignora code fences)
2026-06-24  e4d78ea  fix(qa-scientist): aumentar maxTokens para 1024 para evitar truncamento do JSON
2026-06-24  ea1c889  fix(qa-scientist): simplificar prompt LLM para JSON compacto sem markdown aninhado
2026-06-24  c16aeee  fix(qa-scientist): usar extrator de JSON balanceado para evitar múltiplos objetos no response
2026-06-24  f52b586  fix(specialist): abortar loop após 3 falhas consecutivas da mesma skill + erro V1 com contexto
2026-06-24  4739372  fix(qa-scientist): filtrar falhas jarvis:* de infra antes de virar sinal de hipótese
2026-06-24  6854e05  fix(goal-graph): preservar rastreabilidade de critérios ao conquistar meta
2026-06-24  ef7b345  docs(manual): atualizar com Fases 1-5, QA Scientist, fixes jarvis + goal graph
2026-06-24  b407da2  fix(audit): corrigir 14 bugs críticos do audit estático (P01–P14)
2026-06-25  da948e8  feat(hooks): H01 — instrumentar latência do context hook (p50/p95/p99)
2026-06-25  a4eb94a  fix(specialist): sanitizar nomes de tool para compatibilidade com Anthropic
2026-06-25  1a6740c  fix(litellm): corrigir model IDs claude-sonnet-4 e claude-fable-5
2026-06-25  1a07dbf  fix(step-executor): injetar prevOutputs de steps de dependência no contexto do specialist
2026-06-25  6f6218f  fix(litellm): adicionar fallback gpt-4o→Claude quando Groq rate-limita
2026-06-25  f212e1b  fix(approvals): aceitar reason como alias de comment no DecideDto
2026-06-25  f7dc47d  feat(step-executor): robustez end-to-end — synthesizer, clarification, dependsOn
2026-06-25  6ade5fe  fix(fase-0a)+feat(benchmark): graphify_sync no role-policy + POST /benchmark/cases
2026-06-25  1683e7e  fix(specialist): researcher ganha file_read + infer captura read+report
2026-06-25  d85135b  fix(specialist): word boundary em tester regex evita falso-positivo em specialist/inspect
2026-06-25  d675f29  fix(specialist): synthesizer captura tabela/com-base patterns
2026-06-25  7a09275  fix(context): prevOutputs injeta só result + truncagem 12k; researcher pagina arquivo
2026-06-25  fb07ee4  docs: 10 documentos técnicos de estabilização (V1+V2)
```

---

## Era 6 — Guardian (2026-06-26 a 06-30) · ver [Capítulo 6](06-guardian.md)

```
2026-06-26  d67d67a  fix(web): normalizar content vs synthesis no POST checkpoint/synthesis
2026-06-26  2cc9fb9  fix(infra): WebSocket via Caddy + deploy com git fetch --prune
2026-06-26  54e0fec  test(approval-gates): atualizar spec para retries:0 no approve
2026-06-26  202bf85  docs(claude): adicionar seção Guardian ao CLAUDE.md
2026-06-26  e1fa2c7  feat(guardian): migration guardian_reports + schema v2
2026-06-26  2928e46  feat(guardian): GuardianModule — TestGapDetector, RiskScorer, Service, Controller
2026-06-26  76eaf44  feat(guardian): agent client + context hook + whitelist
2026-06-26  fa758f7  fix(guardian): corrigir prefixo duplicado /v2/v2/guardian → /v2/guardian
2026-06-26  673ba08  feat(guardian): fase 2 — pre-push hook + webhook notification
2026-06-26  c7a7efa  feat(guardian): fase 3 — history endpoint + página /guardian na web
2026-06-26  37bb1a6  feat(guardian): fase 4 — MCP tools + docs/GUARDIAN.md
2026-06-26  daf57cc  fix(guardian): escrever cache no tmpdir do agent, não só no container
2026-06-26  c4ed609  fix(guardian): pre-push hook lê apps/agent/.env além do .env raiz
2026-06-26  590fc4e  test(api-v2): specs para GuardianService e StepExecutorService
2026-06-26  c3b1c14  test(api-v2): spec para WorkflowEngineService
2026-06-26  55e5ea6  fix(fase-0-a): sincronizar ACTION_ROLE, DESKTOP_ACTIONS e skill-registry
2026-06-29  fe0b2c3  feat(guardian): risk score deterministico, test gap discriminado e review gate
2026-06-29  a310122  feat(guardian): item 6 do Blueprint v1.1 - 6 subagentes read-only
2026-06-29  9e22056  feat(guardian): item 7 do Blueprint v1.1 - 6 skills Guardian no skill-engine
2026-06-30  8419b52  feat(guardian): item 8 do Blueprint v1.1 - Plan Mode com entrevista por riskLevel
2026-06-30  f08803c  feat(guardian): item 9 do Blueprint v1.1 - Ultraplan com 6 perspectivas paralelas
2026-06-30  14a4a49  feat(guardian): item 10 do Blueprint v1.1 - Politica Synthesizer com excecoes formalizadas
```

*(ADR-003, fechando a Fase 0-A, é datado 2026-06-27 — dentro desta janela, ver capítulo 6.)*

---

## Era 7 — Estado Atual (2026-07-01 a hoje) · ver [Capítulo 7](07-estado-atual.md)

```
2026-07-02  c5f27e7  fix(guardian): corrige deteccao de gaps, dedupe de gates, override e risk scorer
2026-07-02  2fba2a1  chore(deps): atualiza dependencias vulneraveis (105 -> 12 advisories)
2026-07-02  b434da9  chore(security): JWT fail-fast, throttler global na api-v2 e lint zerado
2026-07-02  5447d54  docs: reescreve architecture.md e roadmap.md cobrindo V1 + V2
2026-07-02  2fcba84  fix(deps): remove overrides de fastify/middie que quebravam o adapter Nest 10
2026-07-24  b638dde  fix(infra): corrige porta do proxy WebSocket no Caddyfile (3002 -> 3104)
```
