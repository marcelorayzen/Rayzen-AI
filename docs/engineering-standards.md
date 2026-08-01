# Engineering Standards — Rayzen AI

## Princípio
Mudanças estruturais relevantes devem ser deliberadas, rastreáveis e não devem quebrar contratos externos enquanto estão em andamento.

---

## Estrutura do repositório

```
apps/api/src/
  modules/          # módulos de domínio — um por responsabilidade
  prisma/           # PrismaService compartilhado (global)
apps/web/           # Next.js 16 App Router
apps/agent/         # PC Agent local
packages/types/     # contratos compartilhados API ↔ agent ↔ web
docs/               # arquitetura, operação, workflows
```

---

## Regras de arquitetura

### Banco de dados
- Usar `PrismaService` injetado via NestJS DI — nunca `new PrismaClient()` diretamente em services
- `PrismaModule` é global — não precisa ser importado em cada módulo

### Injeção de dependências
- Dependências declaradas no construtor com `private readonly`
- Services não instanciam dependências manualmente

### Acoplamento
- Evitar múltiplas responsabilidades num único service
- Lógica de domínio de execução (`buildJarvisPayload`) fica em `execution/`, não no `orchestrator/`
- Contratos compartilhados nascem ou refletem em `packages/types/src/index.ts`

### LLM
- Toda chamada ao LLM vai via proxy LiteLLM (`LITELLM_BASE_URL`)
- Nunca apontar diretamente para OpenAI/Groq/Anthropic no código dos services

---

## Regras de segurança

- Inputs validados antes de chamadas LLM críticas (`ValidationService.assertValidPrompt`)
- Toda execução local passa por `ALLOWED_ACTIONS` em `whitelist.ts`
- `jarvis:run_command` é ação de risco elevado — payloads devem ser revisados
- Path traversal sempre bloqueado nas actions do agent
- Actions destrutivas implementam `dryRun: true` antes da execução real

---

## Regras de qualidade

- `pnpm typecheck` deve passar zero erros antes de qualquer commit
- Coverage mínimo: functions ≥ 65%, branches ≥ 45%, lines ≥ 67% (thresholds em `apps/api/package.json → jest.coverageThreshold`)
- Testes E2E em `test/e2e/` usam Fastify inject — sem banco real, sem servidor HTTP; rodar com `pnpm --filter api test:e2e`
- Testes de segurança do PC Agent não são opcionais (whitelist, path traversal, sandbox)

---

## Regras de documentação

- `README.md` e `docs/` não podem divergir silenciosamente do código
- Mudanças de stack atualizam o README
- Mudanças comportamentais no orquestrador ou agent atualizam `docs/workflows.md`
- Mudanças de arquitetura atualizam `docs/architecture.md`

---

## Quando criar uma spec antes de implementar

Mudanças que exigem alinhamento antes da implementação:

- mudança de contrato entre API e agent
- novo módulo com mais de uma responsabilidade
- mudança de comportamento de memória ou validação
- nova action no PC Agent
- refactor que atravessa mais de 3 arquivos

Formato mínimo de spec:

```
docs/specs/<id>-<slug>.md

## Contexto
## Objetivo
## Arquivos afetados
## Invariantes (o que não pode quebrar)
## Tarefas
```

---

## Referência rápida

| Onde | O que fica |
|---|---|
| `packages/types/src/index.ts` | Tipos compartilhados: `Task`, `TaskModule`, `ChatMessage` |
| `apps/agent/src/security/whitelist.ts` | Lista de actions permitidas — não bypassar |
| `apps/agent/src/executor.ts` | Switch de dispatch das actions — não remover cases existentes |
| `apps/api/src/prisma/` | `PrismaService` global — único ponto de conexão com o banco |
| `apps/api/src/modules/execution/jarvis-payload-builder.ts` | Montagem de payloads do Jarvis |
| `apps/api/src/modules/orchestrator/work-modes.ts` | Configs dos 5 work modes |
