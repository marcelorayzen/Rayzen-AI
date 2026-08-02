# Política de Segurança

## Versões suportadas

Apenas a branch `main` recebe correções de segurança.

| Branch / Versão | Suportada |
|---|---|
| `main` | ✅ |
| Branches de feature | ❌ |
| Releases antigas | ❌ |

---

## Reportando uma vulnerabilidade

**NÃO abra uma issue pública** para reportar vulnerabilidades de segurança.

Envie um e-mail para **marcelo.rayzen@live.com** com:

1. Descrição da vulnerabilidade
2. Passos para reproduzir
3. Impacto potencial
4. Sugestão de correção (se tiver)

**SLA de resposta:**
- Triagem inicial: até 72 horas
- Atualização de status: a cada 7 dias até resolução
- Correção e disclosure: coordenado com o reportante

---

## Arquitetura de segurança

### Autenticação

- Modelo single-admin: uma variável `ADMIN_PASSWORD` por instância
- Senhas armazenadas como **argon2id** (produção) ou plaintext (dev)
- Plaintext desabilitado em produção via `ALLOW_PLAINTEXT_ADMIN_PASSWORD=false`
- Comparação em tempo constante (`timingSafeEqual`) — previne enumeração via timing
- JWT HS256 com expiração configurável; verificado em todas as rotas protegidas

### Agent Bridge

- Requisições do agente autenticadas via `AGENT_TOKEN` (Bearer)
- Tasks despachadas via fila BullMQ — sem execução direta a partir do HTTP
- Cada task carrega `targetRole` (`desktop` | `server`); agentes consomem apenas seu próprio role
- **Agent Audit Log** — toda execução gera entrada rastreável em `agent_audit_logs`: actor, taskId, module, action, command, risk, dryRun, durationMs, status, hostname, workspace; consultável via `GET /tasks/audit`

### PC Agent — sandbox de execução

- **`security/whitelist.ts`** — única fonte de verdade; ações fora são rejeitadas silenciosamente
- **`utils/path-guard.ts`** — acesso ao filesystem restrito a `SAFE_ROOTS`
  - Paths absolutos e traversal `../` bloqueados
  - Escapes cross-drive do Windows (`isAbsolute(rel)`) bloqueados
- **`actions/terminal.ts`** — comandos whitelistados com `risk` (`low/medium/high`) e modo `dryRun`

### V2 — isolamento de schema (`apps/api-v2`)

- V2 usa o schema Postgres `v2`, isolado do schema `public` (V1), no mesmo banco físico
- `V1BridgeService` (dentro do api-v2) tem acesso de leitura ao `public` para compor contexto — nunca escreve nele; qualquer PR que adicione uma escrita cruzando essa fronteira deve ser tratado como incidente de segurança
- Migrations do schema `v2` são aplicadas isoladamente (`prisma db push --schema prisma/schema.prisma`), sem tocar nas tabelas do V1
- Autenticação própria via `JwtAuthGuard` (mesmo `JWT_SECRET` do V1, tokens não são intercambiáveis entre módulos que esperam claims diferentes)

### Rede

- Postgres, Redis e LiteLLM ligados a `127.0.0.1` no Docker Compose (não expostos externamente)
- API e Web expostas em `0.0.0.0` (atrás do Nginx em produção)
- CORS restrito aos domínios listados em `CORS_ORIGINS` (variável de ambiente)
- Security headers via `@fastify/helmet` v11: CSP, HSTS, X-Frame-Options, XSS protection, noSniff
- **HTTPS pendente** — requer domínio pago; Nginx + certbot estão preparados, aguardando aquisição de domínio

### Gerenciamento de segredos

- Todos os segredos via variáveis de ambiente — nunca hardcoded
- Arquivos `.env` no `.gitignore`; `.env.example` contém apenas placeholders
- `hook.config.mjs` (hook Claude Code com JWT) no `.gitignore`
- `DEPLOYMENT.md` usa `<placeholders>` — sem IPs reais, chaves ou usuários no repositório

---

## Limitações conhecidas

| Área | Limitação | Mitigação |
|------|-----------|-----------|
| Docker socket | `agent-server` acessa o socket Docker para gerenciar containers | Restrito a `docker ps/start/stop` pela whitelist; socket proxy é melhoria planejada |
| Admin único | Sem RBAC por usuário; um JWT cobre todas as operações | Aceitável para plataforma de uso pessoal |
| Argon2 nativo | Requer build nativo; imagem `node:20-slim` depende de stage de build | Verificado no build; imagem de produção inclui dependências de compilação |

---

## Checklist de hardening para produção

- [ ] `ADMIN_PASSWORD` definido como hash argon2 (`node -e "require('argon2').hash('pwd').then(console.log)"`)
- [ ] `ALLOW_PLAINTEXT_ADMIN_PASSWORD=false`
- [ ] `JWT_SECRET` gerado com `openssl rand -hex 32`
- [ ] `CORS_ORIGINS` definido com domínio exato (sem wildcards)
- [ ] `NODE_ENV=production`
- [ ] Nginx com HTTPS ativo e certificado válido (requer domínio — pendente)
- [ ] Portas 55432, 56379 e 4100 **não expostas** (garantido por `ports: []` no `docker-compose.prod.yml`)
- [ ] `AGENT_TOKEN` rotacionado e armazenado apenas em `.env` e `hook.config.mjs`

---

## O que está no escopo

- Injeção de prompt no `OrchestratorService` ou `ValidationService`
- Bypass da `whitelist.ts` do PC Agent
- Path traversal em ações do Agent (`list_dir`, `file_search`, `run_command`)
- Vazamento de variáveis de ambiente ou chaves de API via endpoints
- Vulnerabilidades de autenticação JWT
- SQL injection via Prisma raw queries (`$queryRaw`, `$executeRaw`)
- XSS no frontend (Next.js)

---

## O que NÃO está no escopo

- A infraestrutura da VPS Azure (servidor pessoal, fora do escopo deste repositório)
- Credenciais pessoais armazenadas em `.env` (nunca devem ser commitadas)
- Serviços de terceiros (OpenAI, Groq, Jina, Notion)
- Issues de disponibilidade ou performance sem impacto de segurança

---

## Dependências

Executar periodicamente:

```bash
pnpm audit
pnpm --filter api audit
pnpm --filter agent audit
```

Advisories críticos ou altos em dependências de produção devem ser corrigidos antes do próximo deploy.
