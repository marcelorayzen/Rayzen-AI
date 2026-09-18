---
capitulo: 7
titulo: "Estado Atual — Hardening e V1+V2 Coexistindo"
periodo: "2026-07-01 a hoje (2026-07-27)"
fontes:
  commits: ["c5f27e7", "2fba2a1", "b434da9", "5447d54", "2fcba84", "b638dde"]
  docs: ["docs/architecture.md", "docs/roadmap.md"]
  memory: ["memory/project_predeploy_hardening.md", "memory/project_agent_env_trap.md", "memory/project_caddy_bindmount_inode_gotcha.md"]
confianca: "alta"
---

# Capítulo 7 — Estado Atual

Julho, até agora, é o mês mais silencioso do projeto em volume de commits (6, contra 278 em maio) — mas não em intensidade. É o mês de fechar contas: hardening de segurança, um incidente de produção real, e dois bugs operacionais que custaram tempo por razões quase idênticas às do bugchain de junho.

## O sweep de pré-deploy (07-02)

Uma varredura completa de hardening, registrada em `memory/project_predeploy_hardening.md`, aconteceu logo após os fixes do Guardian. O que foi zerado no mesmo dia:

- Lint zerado nas 3 apps (`b434da9`).
- Vulnerabilidades de dependência: **105 → 12 advisories** (`2fba2a1`).
- `JWT_SECRET` fail-fast nas duas APIs — removido o fallback `'changeme'` da api-v2.
- `ThrottlerModule` global na api-v2.
- Whitelist do agent revisada ação por ação (45 ações, todas confirmadas implementadas em `executor.ts` e `role-policy.ts`).
- Dois stale closures reais de `workMode` corrigidos em `page.tsx`.

No mesmo dia, `5447d54` reescreve `docs/architecture.md` e `docs/roadmap.md` para cobrir V1 e V2 juntos — os dois documentos que servem de "fotografia do presente" citados ao longo deste livro.

## O incidente do fastify override (07-02/03)

O sweep de dependências quase derrubou produção no mesmo dia em que devia endurecê-la. `memory/project_predeploy_hardening.md` registra o gotcha crítico: **nunca colocar `fastify` ou `@fastify/middie` em `pnpm.overrides`.** O adapter do NestJS 10 roda a cópia aninhada `fastify@4.28.1` de dentro de `@nestjs/platform-fastify` — o `fastify@^5.9` declarado direto no `package.json` das APIs não é o runtime real. Um override global colapsou essa cópia aninhada para 5.x, e os plugins compilados contra fastify 4 (`multipart` v8, `helmet` v11, `static` v7) travaram o boot com `FST_ERR_PLUGIN_VERSION_MISMATCH` — **api em crash-loop, produção derrubada**. Revertido no commit `2fcba84`. O cluster de vulnerabilidades ligado a essa dependência (`platform-fastify` 3 HIGH, `fastify`, `middie` critical, `@nestjs/core` moderate) continua sem fechar — só fecharia migrando NestJS 10 → 11 nas duas APIs, decisão adiada para ser avaliada junto da eventual Fase 6 (Mastra + AG-UI).

No mesmo dia, o sweep também deixou registrado o que decidiu **não** resolver, por custo/risco fora do escopo do pré-deploy: `.codex-tmp/id_ed25519` (cópia de chave SSH privada esquecida em disco, owner Administradores), moderates residuais sem patch seguro (`js-yaml`, `file-type`, `uuid`, `ip-address`, `@babel/core`), e `ALLOW_PLAINTEXT_ADMIN_PASSWORD` ainda default `true` — reversão que só faz sentido depois de migrar o `ADMIN_PASSWORD` do servidor para hash argon2, para não causar lockout.

## O agent que "nunca conectou" (07-03)

Um incidente de diagnóstico enganoso: o widget mostrava o agent desktop como "nunca conectou". A causa, documentada em `memory/project_agent_env_trap.md`, era quase um replay do gotcha de `.env` duplicado descoberto no bugchain de junho (capítulo 5) — mas com um arquivo a mais: **três** arquivos de env candidatos (`.env` raiz, `.env.agent.local` raiz, `apps/agent/.env`), lidos por launchers diferentes (`rayzen-start.bat` vs. `agent-start.bat`), com tokens divergentes — um hexadecimal pré-JWT, outro um JWT de secret já trocado. Havia ainda duas instâncias do agent rodando ao mesmo tempo, cada uma de um launcher, cada uma com um token velho. O diagnóstico não é óbvio porque o processo está vivo e a rede parece normal — o problema é o token carregado na inicialização do processo, que não recarrega sozinho.

A lição prática registrada: ao renovar o `AGENT_TOKEN` (o próximo vencimento é **2026-07-29** — dois dias depois de hoje), é preciso atualizar os três arquivos e matar/subir o agent de novo, não só um.

## O WebSocket que apontava para a porta errada (07-24)

Três semanas depois, um relato de usuário sobre erro de WebSocket ao fazer checkpoint (`wss://api.rayzen.com.br/ws` retornando 404 repetidamente) leva a `memory/project_caddy_bindmount_inode_gotcha.md`. Causa raiz: o `EventsGateway` (`apps/api-v2/src/gateway/events.gateway.ts`) escuta numa porta dedicada, `@WebSocketGateway(3104, { path: '/ws' })` — não na porta HTTP principal (3002). O `Caddyfile` estava proxyando `/ws` para `api-v2:3002`. Corrigido para `3104` no commit `b638dde`.

Um segundo gotcha, sem relação com o bug em si, mascarou a validação do fix e custou cerca de 15 minutos: o `docker-compose.yml` monta o `Caddyfile` como bind mount de **arquivo único**, que no Docker prende no **inode**, não no path. `git pull` recria o arquivo (unlink + create = inode novo), então `caddy reload` continuava servindo o conteúdo do inode antigo, sem erro nenhum. Só `docker compose restart caddy` reancora o container no inode atual. O diagnóstico rápido documentado: comparar `stat -c "%i"` do arquivo no host contra o mesmo comando dentro do container — inodes diferentes confirmam o mount estagnado.

## Onde V1 e V2 estão hoje

`docs/architecture.md`, reescrito neste mesmo período, descreve o estado que fecha este livro: **V1** (`:3101`, schema `public`, 28 módulos) segue como o sistema de uso diário — orquestração, Brain/Memory, execução via BullMQ, documentação viva, Goal Graph, QA. **V2** (`:3103`, prefixo `/v2`, schema `v2`, 26 módulos) é a "Mission Oriented Engineering System" descrita no capítulo 4, hoje com Router, Missions, WorkflowEngine, StepExecutor, 7 tipos de Specialist, Approval Gates, Agent Dialogue, Benchmark Engine e QA Scientist (ciclo autônomo de 24h) todos ativos. A convivência entre os dois é um risco conhecido e aceito, não um acidente: *"V1/V2 coexistindo indefinidamente"* está listado em `docs/architecture.md` como risco, mitigado pelo `V1BridgeService` — V2 lê o schema `public`, nunca escreve nele.

`docs/roadmap.md` fecha o estado da V2 com uma definição de "pronto" ainda parcialmente cumprida: das 4 condições para considerar a V2 estabilizada (missão de 3 steps sem intervenção manual; QA Scientist com fitness > 0.6 em 2 tipos de tarefa; traces de specialists visíveis no Langfuse; testes automatizados para `StepExecutorService` e `SpecialistRegistry.infer()`), só a primeira está confirmada. A **Fase 6 — Mastra + AG-UI** permanece deliberadamente represada: *"não antes — a arquitetura atual de polling + BullMQ resolve os casos de uso atuais"*.

## Uma nota sobre este próprio livro

Este capítulo foi escrito, em parte, com o auxílio do próprio sistema de memória do Rayzen: uma consulta ao histórico de eventos ao vivo (via `rayzen_get_events`) durante a pesquisa para este livro confirmou os detalhes exatos do incidente de 07-24 (porta 3002→3104, ~15 minutos perdidos por causa do inode) diretamente da timeline operacional do projeto — não apenas da memória já escrita. É, em pequena escala, o próprio caso de uso que motivou o pivot NORTE do capítulo 5: o Rayzen como fonte de contexto confiável para reconstruir o que aconteceu, muito depois do fato.
