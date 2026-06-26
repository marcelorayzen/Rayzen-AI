# Rayzen AI — Developer Guide

> Workflow pessoal e operação em `CLAUDE.local.md` (gitignored). Manual de uso em `docs/manual-de-uso.md`.

---

## O que é

Plataforma pessoal de IA com memória semântica, automação, geração de documentos, QA, qualidade de dados e execução assistida. Monorepo TypeScript com pnpm workspaces.

**Duas gerações coexistindo:**
- **V1** — `apps/api` (:3101), assistente + automação, schema Postgres `public`. Uso diário.
- **V2** — `apps/api-v2` (:3103, prefixo `/v2`), Mission Oriented Engineering System, schema `v2`. Construída, em adoção. Design em `blueprints/`.

---

## Stack

Next.js 16 · NestJS 10 + Fastify · LiteLLM (proxy LLM) · PostgreSQL 16 + pgvector · Redis 7 + BullMQ 5 · Prisma 5 · @xyflow/react (grafo) · Puppeteer (PDF) · docxtemplater (DOCX) · Jina embeddings (1024) · Node 20/22 (agent) · Docker Compose (notebook local) · Caddy + Cloudflare Tunnel (sem port forwarding).

**LiteLLM:** `gpt-4o`→Groq llama-3.3-70b (fallback Claude Sonnet) · `gpt-4o-mini`→Groq 8b · `gpt-4o-premium`→Claude Sonnet direto.
> Claude não suporta `response_format: json_object` — usar extração robusta (strip code fences + regex).

---

## Estrutura

```
rayzen-ai/
├── apps/
│   ├── api/                    # NestJS V1 (28 módulos) · prisma/schema.prisma
│   ├── api-v2/                 # NestJS V2 (26 módulos, schema v2)
│   ├── web/                    # Next.js App Router
│   └── agent/
│       ├── src/
│       │   ├── poller.ts · executor.ts
│       │   ├── security/whitelist.ts   # CRÍTICO — 44 ações, nunca bypassar
│       │   ├── actions/                # implementações jarvis:*
│       │   ├── mcp/                    # MCP stdio + HTTP
│       │   └── hooks/
│       │       ├── rayzen-hook.mjs         # PostToolUse/Stop → POST /events/cli
│       │       └── rayzen-context-hook.mjs # UserPromptSubmit → injeta contexto
├── blueprints/                 # design da V2 (24 docs)
├── docs/                       # manual-de-uso.md · agent-actions.md · security/
└── infra/                      # caddy · litellm · postgres
```

---

## Comandos essenciais

```bash
pnpm install
pnpm dev:api          # API → :3101
pnpm dev:web          # Web → :3100
pnpm --filter api db:generate   # após mudança no schema
pnpm typecheck · lint · test    # 220 testes unit (api)
pnpm gen:catalog      # regenera docs/agent-actions.md a partir do código
pnpm scan:secrets     # varre segredos em arquivos versionados
```

---

## Referências (em vez de tabelas inline)

| Quer saber | Onde |
|---|---|
| Como usar o sistema (painéis, checkpoint, fluxo) | `docs/manual-de-uso.md` |
| Rotas completas da API V1 / V2 | `blueprints/` + Swagger `/docs`, `/v2/docs` |
| Ações do agent + matriz de risco | `docs/agent-actions.md` (gerado por `pnpm gen:catalog`) |
| Modelos de dados | `apps/api/prisma/schema.prisma` · `apps/api-v2/prisma/schema.prisma` |
| Arquitetura V2 (engines) | `blueprints/` (24 documentos) |
| Dados sensíveis | `docs/security/data-inventory.md` (gerado por `pnpm scan:secrets`) |

---

## Regras de desenvolvimento

- TypeScript 100% — sem `any` explícito, sem `.js` puro
- Cada módulo NestJS tem system prompt próprio — nunca genérico
- Logar `tokens_used` e `duration_ms` em toda chamada LiteLLM
- Sempre via LiteLLM — nunca apontar direto p/ OpenAI/Anthropic
- Agent whitelist é inegociável — ações fora são silenciosamente rejeitadas
- Path traversal (`../`) sempre bloqueado em list-dir e similares
- Ações de risco médio/alto: `dryRun: true` antes de executar
- Após mudança no schema Prisma: `pnpm --filter api db:generate`
- V2: schema `v2` isolado; V1BridgeService só lê `public`, nunca escreve

---

## graphify

Grafo de código em `graphify-out/`. Para perguntas de codebase: `graphify query "<pergunta>"` (subgrafo escopo, mais barato que grep amplo). `graphify path "<A>" "<B>"` para relações. Após modificar código: `graphify update .` (AST-only, sem custo de API).

---

## Guardian

O Rayzen Guardian monitora mudanças de código em tempo real e avisa o que vai quebrar **antes** do push.

```
workspace-watcher detecta mudanças (30s)
  → POST /v2/guardian/analyze
  → Analisa impacto via lineage + detecta arquivos sem teste
  → Escreve cache local em tmpdir()
  → rayzen-context-hook lê cache antes de você pensar
  → Claude Code já começa sabendo o que está em risco
```

**Risk levels:** low (silencioso) · medium (widget + contexto) · high (notify + contexto) · critical (notify + webhook + bloqueia pre-push)

**Variáveis de ambiente (agent):**
```env
AGENT_GUARDIAN_ENABLED=true
AGENT_GUARDIAN_RISK_THRESHOLD=medium
GUARDIAN_WEBHOOK_URL=               # N8N webhook (opcional)
GUARDIAN_WEBHOOK_TOKEN=             # token do webhook (opcional)
```

**Instalar git hooks:** `pnpm guardian:install-hooks`

**Mapa de convenções de teste:**

| Arquivo modificado | Spec esperado |
|---|---|
| `apps/api-v2/src/X/X.service.ts` | `apps/api-v2/src/X/__tests__/X.service.spec.ts` |
| `apps/api/src/modules/X/X.service.ts` | `apps/api/src/modules/X/__tests__/X.service.spec.ts` |
| `apps/agent/src/actions/X.ts` | `apps/agent/src/actions/__tests__/X.spec.ts` |

**Estrutura:** `apps/api-v2/src/guardian/` · `apps/agent/src/guardian-client.ts` · `apps/widget/src/renderer/components/GuardianPanel.tsx` · `apps/vscode-extension/`

**Blueprint completo:** Wiki do Rayzen — "Rayzen Guardian — Sistema de Acompanhamento Proativo"
