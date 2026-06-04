# Rayzen AI — Instruções para Claude Code (privado)

> Ponto de entrada. Detalhes operacionais estão em `docs/manual-de-uso.md`.
> Referências completas: rotas → blueprints/ · ações do agent → `docs/agent-actions.md` · modelos → `apps/api/prisma/schema.prisma`.

---

## Identidade

- **Dono:** Marcelo Rayzen — QA Automation Engineer / Full-stack Developer
- **Repositório:** `github.com/marcelorayzen/rayzen-ai-private` (privado)
- **Branch principal:** `main`
- **Web:** `http://<VPS_IP>:3100` · **API:** `http://<VPS_IP>:3101` · **Domínio:** `rayzen.com.br`
- **Notion root:** `359c784498d680e68a15e71c90ff9f22`

Plataforma pessoal de IA com automação, memória semântica, geração de documentos, QA e execução assistida entre a VPS Azure e o PC de trabalho. Monorepo TypeScript (pnpm workspaces).

**Duas gerações coexistindo:** V1 (`apps/api`, :3101, estável, uso diário) + V2 (`apps/api-v2`, :3103, prefixo `/v2`, Mission Oriented — construída, em adoção). Ver `docs/manual-de-uso.md` e `blueprints/`.

---

## Setup e uso diário

Resumo (passo a passo completo em `docs/manual-de-uso.md`):

| Componente | Onde | Como sobe |
|---|---|---|
| Postgres + Redis + LiteLLM + API + Web + MCP | VPS (Docker) | `docker compose up -d` (auto-restart) |
| Agent desktop | PC de trabalho | `agent-start.bat` |
| Hook Claude Code | Esta máquina | `.claude/settings.json` (automático) |

O hook detecta o projeto pelo `repoSlug` do git remote (resolução robusta: normaliza case/`-private`/`_`). Badge de saúde no painel Atividade; diagnóstico via `GET /events/hook/health`.

**Token JWT (hook + AGENT_TOKEN) expira 4 de junho de 2026.** Renovar:
```bash
curl -X POST http://<VPS_IP>:3101/auth/login -H "Content-Type: application/json" -d '{"password":"<ADMIN_PASSWORD>"}'
# atualizar hook.config.mjs e AGENT_TOKEN no .env
```

**Deploy (na VPS via SSH):** `git pull && docker compose up -d --build <serviço>`. Acesso SSH em `memory/reference_vps_ssh.md`.

---

## Comandos essenciais

```bash
pnpm dev:api / dev:web              # :3101 / :3100
pnpm --filter api db:generate       # após mudança no schema Prisma
pnpm --filter api test              # 198 unit · test:e2e p/ E2E
pnpm typecheck / lint
pnpm gen:catalog                    # regenera docs/agent-actions.md
pnpm scan:secrets                   # varre segredos versionados
```

---

## Stack (resumo)

Next.js 16 (web) · NestJS 10 + Fastify (api) · LiteLLM (proxy) · PostgreSQL 16 + pgvector (`public`=V1, `v2`=V2) · Redis 7 + BullMQ · Prisma 5 · Jina embeddings (1024) · Puppeteer/docxtemplater · Node 20/22 (agent) · Docker Compose na VPS Azure.

**LiteLLM:** `gpt-4o`→Groq llama-3.3-70b (fallback Claude Sonnet) · `gpt-4o-mini`→Groq 8b · `gpt-4o-premium`→Claude Sonnet direto. Claude **não** suporta `response_format: json_object` — usar extração robusta (strip fences + regex).

---

## Protocolo de sessão Claude Code ↔ Rayzen

**Obrigatório. Não pode ser quebrado entre sessões.**

### Ao iniciar trabalho neste projeto
Antes da primeira ação técnica, ler contexto via MCP:
```
rayzen_get_resume()   → o que mudou desde a última sessão, blockers ativos
rayzen_get_goal()     → meta ativa, progresso, next best action
```

### Ao iniciar uma task específica de implementação / debugging / review
Antes de explorar o código, chamar:
```
rayzen_get_context(mode:'<implementation|debugging|review|architecture>', query:'<descrição da task>')
```
Retorna pacote cirúrgico: ProjectState + planejamento + blockers + memória semântica relevante.
Substitui grep amplo e re-explicação de estado — use como primeiro passo antes de ler arquivos.

### Durante a sessão
Ao tomar decisão significativa ou concluir entrega, registrar **intenção** (não só execução):
```
rayzen_add_event(type:'decision', content:'Implementado X para resolver Y — motivo: Z')
```
O hook captura mecanicamente o que foi executado; cabe ao Claude registrar o **porquê** e o **resultado**.

### Ao fim de sessão com código real modificado
```
rayzen_checkpoint()         → sintetiza, atualiza ProjectState, reconstrói docs e Universe
rayzen_update_planning()    → fecha milestones, adiciona tasks ao backlog
```
Sem checkpoint, a próxima sessão começa com estado desatualizado.

### Contrato de qualidade de sinal
- **Não registrar ruído:** tool calls de leitura (Read, ToolSearch, MCP queries) não viram eventos.
- **Bash/PowerShell:** o `description` é o sinal; o `command` completo é ruído.
- **Checkpoint ≠ síntese:** síntese é parcial; checkpoint fecha o loop (state + docs + Universe).
- ⚠️ Sessões com muito ruído operacional poluem a Doc viva (ver limitação no manual). Goal Graph é a fonte estratégica confiável.

---

## Regras de desenvolvimento

- TypeScript 100% — sem `any` explícito, sem `.js` puro
- Cada módulo NestJS tem system prompt próprio — nunca genérico
- Logar `tokens_used` e `duration_ms` em toda chamada LiteLLM
- LiteLLM sempre via proxy — nunca apontar direto p/ OpenAI/Anthropic
- Agente: whitelist é inegociável (34 ações — ver `docs/agent-actions.md`); ações fora são rejeitadas
- Path traversal (`../`) sempre bloqueado em list-dir e similares
- Ações de risco médio/alto: `dryRun: true` antes de executar
- Após mudança no schema Prisma: `pnpm --filter api db:generate`
- V2: schema `v2` isolado; V1BridgeService só lê o schema `public`, nunca escreve

---

## Referências

- **Manual de uso completo:** `docs/manual-de-uso.md`
- **Arquitetura V2 (24 docs):** `blueprints/`
- **Catálogo de ações + risco:** `docs/agent-actions.md` (gerado)
- **Inventário de dados sensíveis:** `docs/security/data-inventory.md` (gerado)
- **Acesso VPS:** `memory/reference_vps_ssh.md`
- **graphify:** grafo de código em `graphify-out/`. `graphify query "<pergunta>"` para perguntas de codebase; `graphify update .` após mudar código.
