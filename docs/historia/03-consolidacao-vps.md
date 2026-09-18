---
capitulo: 3
titulo: "Consolidação VPS e Último Polimento"
periodo: "2026-05-18 a 2026-05-28"
fontes:
  commits: ["7f1e6d8", "27aa90e", "03e0484", "a263256", "ce640ae", "ce15c6a", "9bb0661", "71219dc", "1d70c4b", "4177d39", "e23b941", "faffcd8", "eebbd96"]
  docs: ["docs/diary.md"]
  memory: ["memory/project_hook_slug_resolution.md", "memory/project_fase4_pendencias.md", "memory/project_notion_indexing_bug.md", "memory/reference_vps_ssh.md"]
confianca: "media"
---

# Capítulo 3 — Consolidação VPS e Último Polimento

`docs/diary.md` termina com duas entradas em 2026-05-18, e depois para. É o último dia em que o projeto teve um diário em primeira pessoa. Tudo que vem a partir daqui neste capítulo — 10 dias densos, ~150 commits — é reconstruído a partir de mensagens de commit e memória auto-persistida, sem a narrativa direta que existia até aqui. Por isso este capítulo carrega `confianca: media`.

## A última entrada do diário (05-18)

Duas decisões, registradas no mesmo dia:

**Consolidação VPS e Agents por papel.** Contexto: "o Rayzen deixou de operar com API/banco no notebook e passou a usar uma VPS central, mantendo ações locais no PC de trabalho". Decisão: `main` consolidada como branch principal, Agents separados por papel (`desktop` e `server`), `repoSlug` como identidade técnica por projeto. Impacto: API, Web, Postgres, Redis, LiteLLM e Agent server passam a rodar na VPS; o Agent desktop mantém a execução local e a separação entre projetos. (Essa VPS, confirma `memory/reference_vps_ssh.md`, era uma VM Azure — que seria desativada um mês depois, em 06-10, quando a infraestrutura migrou de volta para o notebook local; ver capítulo 5.)

**Evidências visuais como artefato de QA.** Screenshots deixam de ser soltos e passam a salvar em `Pictures\Rayzen\<repoSlug>`, com upload para a API, aparecendo na aba **Evidências** e alimentando o documento **Evidências de teste**. O texto após `:` no comando de captura vira descrição, nome de arquivo e categoria automática (`api_test`, `manual_test`, `bug`, `fix`, `general`). O commit do mesmo dia, `7f1e6d8` — *"feat(evidence): sync project screenshots to web"* — é a implementação exata dessa decisão.

## A limpeza que se seguiu (05-19/20)

No dia seguinte, dois problemas antigos se resolvem juntos, ambos documentados em memória mas não no diário: a **indexação do Notion** finalmente funciona — não por um fix de código, mas porque o usuário conecta a integração Rayzen AI às páginas via `Connections` no próprio Notion (`memory/project_notion_indexing_bug.md`) — e um bug de persistência mais sério aparece pela primeira vez: eventos do hook não vinculavam ao projeto certo. A causa raiz completa só seria descoberta em 05-30 (ver abaixo), mas os sintomas — e os primeiros fixes de UI (`b345935`, `9ba1225`, `863ff4d`, `bed16e7`, todos "fix(web): corrige persistência de projeto") — já aparecem aqui.

Em 05-20, dois recursos novos: o **Blueprint module** — importação estruturada de planos externos (`27aa90e`) — e o **Universe**, um canvas livre de conhecimento por projeto com CRUD e posicionamento livre (`b52efc0`, schema `3603de2`). No dia seguinte (05-21), o Blueprint ganha profundidade rápida: upload de `.md` com drag&drop (`8b11695`), geração de Blueprint via LLM a partir do `ProjectState` (`f7b3efb`), histórico de imports (`795fc59`), e uma revisão "V1.1" (`03e0484`) com slug hash, avisos deduplicados e limite de conteúdo.

## A auditoria de segurança da Fase 4 (05-22)

O dia 05-22 concentra uma varredura de segurança e estabilização que `memory/project_fase4_pendencias.md` documenta em detalhe, com bugs numerados e resolvidos um a um no mesmo dia. A própria memória cita commits para cada fix (`efbeb6c`, `7677fef`, `a8701ba`, `194fc95`) — mas nenhum desses hashes foi encontrado no histórico atual do repositório ao verificar este capítulo, provavelmente por reescrita de histórico (rebase/squash) entre a data da memória e hoje. Os fixes em si ficam registrados abaixo com `confiança: media` — o que aconteceu é confiável (a memória é datada e específica), mas a rastreabilidade até o commit exato se perdeu:

- **`rayzen_add_event` retornava "content: unknown"** — causa raiz: o MCP mandava `content`/`intent` diretamente, mas o controller só sabia ler campos de evento de hook.
- **Cache do BrainSearch não invalidava ao indexar** — corrigido adicionando `delPattern('brain-search:*')` nos dois branches (criado/atualizado) de `indexDocument()`.
- **Cache semântico do LiteLLM** — investigado e simplificado: `similarity_threshold` era silenciosamente ignorado com `type: redis` (precisaria de `type: redis-semantic`, overhead não justificado); ficou o cache exato de 5 min.
- **`ConversationMessage.module` não preenchido por todos os módulos** — logging adicionado (synthesis, project-state, documentation, blueprint, graph), habilitando o painel de custos a refletir gasto real de todo o sistema, não só de alguns módulos.
- **Suspeita de bug do argon2 no Docker** — investigada e descartada como falso alarme: a resolução de módulo do Node parte do arquivo executado (`dist/main.js`), não do CWD, então o pacote é encontrado normalmente.

No mesmo dia, uma auditoria estática de segurança fecha 10 achados (`a263256`, "SEC-1 a SEC-10") e outra fecha achados C2/C4 a C8 (`4ee13c5`). É o primeiro exercício formal de auditoria de segurança do projeto — antes do Guardian (capítulo 6) automatizar esse tipo de verificação.

## Rebranding, observabilidade e separação pública/privada (05-23/24)

Em 05-23, um salto de maturidade operacional: **Prometheus** com endpoint `/metrics`, testes E2E cobrindo o fluxo, e CI atualizado (`ce640ae`, `5dd234d`); redesign visual completo da web inspirado em Linear/Vercel (`9bb0661`); downgrade de `@fastify/helmet` v13→v11 para compatibilidade com Fastify 4.x do NestJS 10 (`ce15c6a`); e uma decisão de segurança operacional simples mas necessária — **remover o IP da VPS de todos os arquivos commitados** (`71219dc`).

Em 05-24, o projeto formaliza a separação entre **dois repositórios: um privado (workflow pessoal) e um público (código limpo)** (`1d70c4b`, `28c29fe`) — decisão que explica por que `CLAUDE.local.md` existe como arquivo gitignored separado de `CLAUDE.md` até hoje. No mesmo dia: MCP com transporte HTTP/SSE para Claude Desktop (`a4a4abf`), Caddy como reverse proxy HTTPS via nip.io + Let's Encrypt (`c938333`), e um sistema de **3 tiers de custo de LLM** com Ollama local para classificação/grafo/proatividade em Tier 0 (`aaee35f`) — o embrião direto do Cost Controller que a V2 formalizaria dias depois.

## Últimos dias antes da V2 (05-25 a 05-28)

Em 05-25: bridge Claude Code + Telegram para sessões autônomas (`4177d39`), toggle de "Qualidade Premium" por projeto (`d1fdbfe`), remoção do fallback Claude em `gpt-4o`/`gpt-4o-mini` — decisão explícita de custo: "Groq rate limit não deve gastar crédito Anthropic" (`8d15707`), unificação do nome do banco para `rayzen_ai` em todas as referências (`4fd7463`), `prisma migrate deploy` automático no startup da API (`e23b941`).

Em 05-28, três últimos ajustes de segurança e robustez antes do salto para a V2: bind das portas 3100/3101/3102 ao `localhost` (`faffcd8`), extração JSON mais robusta na Wiki com sanitização de caracteres de controle (`eebbd96`) — o primeiro de uma série de fixes de parsing de JSON de LLM que se repete com mais intensidade no QA Scientist (capítulo 5) — e a remoção do `response_format: json_object` nas chamadas Groq, que falhava com `json_validate_failed` (`194e754`). Essa é a origem direta da regra hoje documentada em `CLAUDE.md`: *"Claude não suporta `response_format: json_object` — usar extração robusta (strip code fences + regex)"*.

## O que este capítulo deixa pronto para a V2

Sem que ninguém tivesse anunciado "vamos construir uma V2", os últimos dez dias de maio já tinham construído, em miniatura, quase todos os componentes que a V2 nomearia formalmente dias depois: um sistema de custo em camadas (Cost Controller), um Blueprint module (Documentation Engine embrionário), um Universe/canvas de conhecimento (Knowledge Engine embrionário), MCP com OAuth em construção. O capítulo 4 é, em boa medida, a formalização arquitetural do que já existia em protótipo aqui.
