# Rayzen AI — Instruções para Claude Code (privado)

> Ponto de entrada. Detalhes operacionais em `docs/manual-de-uso.md`.
> Referências completas: rotas → blueprints/ · ações do agent → `docs/agent-actions.md` · modelos → `apps/api/prisma/schema.prisma`.

---

## Identidade

- **Dono:** Marcelo Rayzen — QA Automation Engineer / Full-stack Developer
- **Repositório:** `github.com/marcelorayzen/rayzen-ai-private` (privado)
- **Branch principal:** `main`
- **Web:** `http://192.168.0.175:3100` · **API:** `http://192.168.0.175:3101` · **Domínio:** `https://rayzen.com.br`

Plataforma pessoal de IA com automação, memória semântica, geração de documentos, QA e execução assistida. Monorepo TypeScript (pnpm workspaces).

**Duas gerações coexistindo:** V1 (`apps/api`, :3101, estável, uso diário) + V2 (`apps/api-v2`, :3103, prefixo `/v2`).

---

## Papéis — quem faz o quê

| Quem           | Papel                                                   |
|----------------|----------------------------------------------------------|
| **Rayzen**     | Context broker · memória semântica · governança · QA docs |
| **Claude Code** | Desenvolvimento · análise · code review · implementação |
| **Agent desktop** | Executor local — browser, screenshots, terminal, git  |

**Rayzen NÃO executa código.** V2 tem um motor de missões construído mas a função principal do Rayzen para o uso diário é entregar contexto comprimido, registrar decisões e armazenar artefatos QA.

---

## Setup e uso diário

| Componente | Onde | Como sobe |
|---|---|---|
| Postgres + Redis + LiteLLM + API + Web + MCP | Notebook local 192.168.0.175 (Docker) | `sudo docker compose up -d` |
| Agent desktop | PC de trabalho | `agent-start.bat` |
| Hook Claude Code | Esta máquina | `.claude/settings.json` (automático) |

**Diagnóstico de infraestrutura:** `GET /infra/health` — retorna status de postgres, redis, litellm, api-v2, mcp e validade do JWT.

**Token JWT (hook + AGENT_TOKEN) expira 4 de julho de 2026.** Renovar:
```bash
curl -X POST http://<VPS_IP>:3101/auth/login -H "Content-Type: application/json" -d '{"password":"<ADMIN_PASSWORD>"}'
# atualizar hook.config.mjs e AGENT_TOKEN no .env
```

**Deploy (no servidor local via SSH):** `git pull && sudo docker compose up -d --build <serviço>`. Acesso SSH em `memory/reference_vps_ssh.md` — notebook `rayzen@192.168.0.175`, chave `~/.ssh/id_ed25519`.

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

Next.js 16 (web) · NestJS 10 + Fastify (api) · LiteLLM (proxy) · PostgreSQL 16 + pgvector (`public`=V1, `v2`=V2) · Redis 7 + BullMQ · Prisma 5 · Jina embeddings (1024) · Puppeteer/docxtemplater · Node 20/22 (agent) · Docker Compose no notebook local (Ubuntu 26.04) · Cloudflare Tunnel (sem port forwarding).

**LiteLLM:** `gpt-4o`→Groq llama-3.3-70b (fallback Claude Sonnet) · `gpt-4o-mini`→Groq 8b · `gpt-4o-premium`→Claude Sonnet direto. Claude **não** suporta `response_format: json_object` — usar extração robusta (strip fences + regex).

---

## Protocolo de sessão Claude Code ↔ Rayzen

### Contexto automático (não requer ação manual)
O hook `UserPromptSubmit` injeta o estado do projeto Rayzen em cada prompt automaticamente (cache 5 min, injetado como `additionalContext`). Não é necessário chamar `rayzen_get_resume()` em toda sessão.

### Quando usar MCP manualmente

| Situação | Chamar |
|---|---|
| Início de task complexa (implementação / debugging) | `rayzen_get_context(mode, query)` → contexto cirúrgico |
| Decisão significativa tomada | `rayzen_add_event(type:'decision', content:'...')` |
| Fim de sessão com código real modificado | `rayzen_checkpoint()` → fecha o loop |
| Backlog / milestones para atualizar | `rayzen_update_planning()` |

**`rayzen_get_context`** é o mais importante: substitui grep amplo, retorna ProjectState + planejamento + memória semântica relevante para a query.

### Contrato de qualidade de sinal
- Não registrar ruído: tool calls de leitura não viram eventos
- Bash/PowerShell: o `description` é o sinal, `command` completo é ruído
- Checkpoint fecha o loop (state + docs + Universe) — síntese é parcial

---

## Regras de desenvolvimento

- TypeScript 100% — sem `any` explícito, sem `.js` puro
- Cada módulo NestJS tem system prompt próprio — nunca genérico
- Logar `tokens_used` e `duration_ms` em toda chamada LiteLLM
- LiteLLM sempre via proxy — nunca apontar direto p/ OpenAI/Anthropic
- Agente: whitelist é inegociável (ver `docs/agent-actions.md`); ações fora são rejeitadas
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
