# Deployment — Rayzen AI

Guia operacional para subir e manter a stack em produção na VPS Azure.

---

## Topologia atual

| Componente | Onde roda | Porta externa |
|---|---|---|
| PostgreSQL 16 + pgvector | VPS (Docker) | 55432 |
| Redis 7 | VPS (Docker) | 56379 |
| LiteLLM proxy | VPS (Docker) | 4100 |
| API NestJS (V1) | VPS (Docker) | 3101 |
| API NestJS (V2, `apps/api-v2`, prefixo `/v2`, schema `v2`) | VPS (Docker) | 3103 |
| Web Next.js | VPS (Docker) | 3100 |
| Agent server | VPS (Docker) | — (poll interno) |
| Agent desktop | PC de trabalho | — (poll para VPS) |

**VPS:** Ubuntu (Azure, GCP, AWS, etc.)  
**Acesso SSH:** `ssh -i ~/.ssh/<SUA_CHAVE>.pem <USUARIO>@<IP_DA_VPS>`  
**Diretório:** `/home/<USUARIO>/projects/rayzen-ai`

---

## Primeiro deploy (ambiente novo)

```bash
# 1. Clonar o repositório
git clone https://github.com/marcelorayzen/Rayzen-AI.git
cd Rayzen-AI

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Edite .env com as API keys e senhas reais
# IMPORTANTE: NEXT_PUBLIC_API_URL deve ser http://<IP_PUBLICO>:3101

# 3. Subir infraestrutura
docker compose up -d postgres redis litellm

# 4. Aguardar banco ficar healthy e aplicar schema
docker compose exec api pnpm --filter api db:migrate

# 5. Subir todos os serviços
docker compose up -d
```

---

## Atualizar após push para main

```bash
ssh -i ~/.ssh/<SUA_CHAVE>.pem <USUARIO>@<IP_DA_VPS> \
  "cd /home/<USUARIO>/projects/rayzen-ai && git pull && docker compose up -d --build api web"
```

Para rebuild completo (ex: mudança em schema Prisma ou Dockerfile):

```bash
ssh -i ~/.ssh/<SUA_CHAVE>.pem <USUARIO>@<IP_DA_VPS> \
  "cd /home/<USUARIO>/projects/rayzen-ai && git pull && docker compose down --remove-orphans && docker compose up -d"
```

---

## API V2 (`apps/api-v2`)

V2 roda como serviço Docker separado, com schema Prisma próprio (`v2`) no mesmo Postgres do V1.

```bash
# Env vars específicas do api-v2 (docker-compose.yml)
DATABASE_URL_V2   # postgresql://rayzen:<senha>@postgres:5432/rayzen_ai?schema=v2
DATABASE_URL      # mesma conexão V1 — V1BridgeService só lê o schema public
API_V2_PORT       # 3002 dentro do container (mapeado para 3103 no host)
LITELLM_BASE_URL  # http://litellm:4000/v1
V1_API_URL        # http://api:3001 — bridge interno para o V1
V1_API_TOKEN      # reusa AGENT_TOKEN
```

### Migrations do schema v2

```bash
# Local (desenvolvimento)
pnpm --filter api-v2 db:generate   # prisma generate

# Aplicar schema no notebook — migrate dev falha com shadow DB em setup multi-schema;
# usar db push diretamente:
docker compose exec api-v2 npx prisma db push --schema prisma/schema.prisma --accept-data-loss --skip-generate
```

> `V1BridgeService` (dentro do api-v2) só **lê** o schema `public` — nunca escreve. Regra inegociável, ver `CLAUDE.md`.

---

## Variáveis de ambiente obrigatórias

| Variável | Descrição |
|---|---|
| `GROQ_API_KEY` | API key Groq (llama-3.3-70b e whisper) |
| `ANTHROPIC_API_KEY` | API key Anthropic (fallback e gpt-4o-premium) |
| `JINA_API_KEY` | API key Jina AI (embeddings 1024-dim) |
| `LITELLM_MASTER_KEY` | Chave do proxy LiteLLM (`sk-rayzen-...`) |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL |
| `DATABASE_URL` | `postgresql://rayzen:<senha>@postgres:5432/rayzen_ai` (dentro do Docker) |
| `REDIS_URL` | `redis://redis:6379` (dentro do Docker) |
| `JWT_SECRET` | Gerar com `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | Senha do painel web |
| `AGENT_TOKEN` | Token do Agent server — gerar via `POST /auth/login` |
| `NEXT_PUBLIC_API_URL` | URL pública da API: `http://<IP>:3101` |
| `CORS_ORIGINS` | Origens permitidas (vírgula): `http://<IP>:3100,https://<DOMINIO>` |

> **Atenção:** `ADMIN_PASSWORD` com `$` no valor é interpolado pelo Docker Compose `env_file`.  
> Use uma senha sem `$` ou escape como `$$` no arquivo `.env`.

---

## Verificar status dos containers

```bash
docker compose ps
docker compose logs api --tail=50
docker compose logs web --tail=20
```

Healthchecks configurados em todos os serviços. Status esperado: `healthy`.

---

## Migrations de banco

Após qualquer alteração em `apps/api/prisma/schema.prisma`:

```bash
# Local (desenvolvimento)
pnpm db:migrate

# VPS (produção) — dentro do container api
docker compose exec api npx prisma migrate deploy
```

> `migrate deploy` aplica apenas migrations pendentes sem criar novas.  
> Nunca use `migrate dev` em produção.

---

## Renovar token do Agent

O token JWT do Agent expira conforme `JWT_AGENT_EXPIRY` (padrão: 30d).

```bash
curl -X POST http://<IP>:3101/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<ADMIN_PASSWORD>"}'
# Copie o token retornado → atualize AGENT_TOKEN no .env da VPS
# e apiToken no apps/agent/src/hooks/hook.config.mjs (PC local)
```

---

## Reiniciar serviço específico

```bash
# Apenas API (sem rebuild)
docker compose restart api

# API com rebuild (após mudança de código)
docker compose up -d --build api

# Web com rebuild
docker compose up -d --build web

# LiteLLM (após mudança em config.yaml)
docker compose restart litellm
```

---

## Backup do banco

```bash
# Exportar
docker compose exec postgres pg_dump -U rayzen rayzen_ai > backup-$(date +%Y%m%d).sql

# Restaurar
docker compose exec -T postgres psql -U rayzen rayzen_ai < backup-20260101.sql
```

---

## O que fica fora do versionamento

- `.env` (secrets reais)
- `apps/agent/src/hooks/hook.config.mjs` (token + projectId local)
- `storage/evidence/` (screenshots do Agent)
- Chaves SSH

---

## Próximos passos operacionais

- [ ] Configurar domínio + HTTPS via Nginx + Certbot
- [ ] Separar `docker-compose.prod.yml` com limites de memória e sem volumes de dev
- [ ] Rotação automática de AGENT_TOKEN via cron
- [ ] Backup automático do banco para Azure Blob Storage
