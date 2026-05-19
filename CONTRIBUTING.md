# Contribuindo para o Rayzen AI

Obrigado por considerar contribuir! Este documento descreve como reportar problemas, sugerir melhorias e enviar código.

---

## Reportando bugs

Use o template de issue **Bug Report** disponível ao abrir uma nova issue.

Inclua sempre:
- Comportamento esperado vs. comportamento observado
- Passos para reproduzir
- Versão do Node.js, SO, Docker
- Logs relevantes (remova credenciais antes de colar)

---

## Sugerindo features

Use o template de issue **Feature Request**.

Antes de abrir:
- Verifique se já existe uma issue similar
- Descreva o problema que a feature resolve, não só a solução

---

## Desenvolvimento local

```bash
git clone https://github.com/marcelorayzen/rayzen-ai.git
cd rayzen-ai
pnpm install
cp .env.example .env  # preencha as chaves

docker compose up -d postgres redis litellm
pnpm db:migrate

pnpm dev:api    # http://localhost:3101
pnpm dev:web    # http://localhost:3100
pnpm dev:agent  # PC Agent local
```

---

## Convenções de código

- **TypeScript 100%** — sem arquivos `.js` na stack principal
- **Sem `any` explícito** — use tipos de `packages/types/src/index.ts` ou crie tipos locais
- **NestJS DI** — injete `PrismaService` via construtor, nunca `new PrismaClient()`
- **LLM sempre via proxy** — `baseURL` aponta para LiteLLM (`:4100/v1`), nunca direto para OpenAI/Anthropic
- **Consulte `CLAUDE.md`** e `docs/engineering-standards.md` para padrões detalhados

---

## Processo de PR

1. Crie uma branch descritiva: `feat/notion-sync`, `fix/voice-cleanup`, `refactor/prisma-di`
2. Garanta que `pnpm typecheck` e `pnpm test` passam localmente
3. Preencha o template em `.github/pull_request_template.md`
4. PRs sem typecheck verde não serão mergeados

---

## O que NÃO modificar sem justificativa explícita

| Arquivo | Motivo |
|---|---|
| `apps/agent/src/security/whitelist.ts` | Controle de segurança do PC Agent — mudanças exigem review de segurança |
| `apps/agent/src/executor.ts` | Dispatcher tipado — novos casos seguem o padrão documentado em `docs/agent-runtime.md` |
| `ADR.md` | Decisões arquiteturais aprovadas — abra uma issue antes de propor reversão |
| `infra/litellm/config.yaml` | Configuração de proxy LLM — mudanças afetam todos os módulos |

---

## Código de conduta

Este projeto segue o [Contributor Covenant](CODE_OF_CONDUCT.md). Seja respeitoso.
