# 024 — Data Strategy (V1 ↔ V2 Coexistence)

## Visão Geral

V1 e V2 compartilham o mesmo servidor Postgres mas usam **schemas separados**: `public` para V1, `v2` para V2. Isso garante isolamento total sem duplicar infraestrutura. O V2 pode ler dados do V1 diretamente via views ou queries cross-schema quando necessário.

---

## Estratégia de schemas

```
PostgreSQL (mesmo servidor, porta 5432)
├── schema: public          ← V1 (Prisma atual)
│   ├── Project
│   ├── Event
│   ├── Document
│   ├── WikiPage
│   ├── ProjectState
│   ├── ProjectGoal
│   └── ... (21 models existentes)
│
└── schema: v2              ← V2 (novo Prisma client)
    ├── Mission
    ├── MissionStep
    ├── KnowledgeNode
    ├── KnowledgeEdge
    ├── VaultAccessLog
    ├── ScheduledMission
    ├── ApprovalGate
    ├── TelegramSession
    ├── ResourceLimits
    ├── TraceSpan
    └── CostRecord
```

**Configuração Prisma V2:**
```
// apps/api-v2/prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL_V2")  // mesmo servidor, mesmo db, schema=v2
  schemas  = ["v2"]
}
```

**`DATABASE_URL_V2`:**
```
postgresql://rayzen:senha@postgres:5432/rayzen_ai?schema=v2
```

---

## Como V2 acessa dados V1

V2 precisa ler dados V1 (projetos, eventos, documentos, state) para:
- Montar contexto de missão com histórico do projeto
- Buscar na memória V1 durante execução
- Referenciar `projectId` que existe no schema V1

**Abordagem: V2 instancia um Prisma Client V1 em read-only**

```typescript
// apps/api-v2/src/core/v1-bridge.service.ts
import { PrismaClient } from '@prisma/client'  // client V1 (schema public)

@Injectable()
export class V1BridgeService {
  private readonly prismaV1: PrismaClient

  constructor() {
    this.prismaV1 = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } }  // V1 URL
    })
  }

  // Read-only — V2 nunca escreve no schema V1
  async getProject(id: string)       { return this.prismaV1.project.findUnique({ where: { id } }) }
  async getProjectState(id: string)  { return this.prismaV1.projectState.findFirst({ where: { projectId: id } }) }
  async getRecentEvents(id: string)  { return this.prismaV1.event.findMany({ where: { projectId: id }, orderBy: { ts: 'desc' }, take: 20 }) }
  async searchDocuments(q: string, projectId: string) { /* brain search via V1 API or direct query */ }
}
```

**Regra:** V2 nunca escreve no schema `public`. Apenas lê. Escrita continua sendo responsabilidade da API V1.

---

## Fluxo de dados por componente

| Componente V2 | Lê de | Escreve em |
|---|---|---|
| Mission Engine | `v2.Mission`, `v2.MissionStep` | `v2` |
| Context Engine | `public.ProjectState`, `public.Event` (via V1Bridge) | — |
| Memory Engine | `public.Document` (V1) + futuramente `v2.MemoryEntry` | `v2` |
| Knowledge Engine | `v2.KnowledgeNode`, `v2.KnowledgeEdge` | `v2` |
| Vault Engine | `vault/*.enc` (arquivo), `v2.VaultAccessLog` | `v2` + arquivo |
| Cost Controller | `v2.CostRecord` | `v2` |
| Observability | `v2.TraceSpan` | `v2` |
| Skill Runtime | Qualquer (via contexto da missão) | via V1 API (não direto) |

---

## Migração incremental

V2 começa coexistindo com V1. A migração é incremental:

```
Fase 1-2: V2 lê de V1, escreve em v2
Fase 3:   Novos projetos criados via V2 (Mission Engine) ainda referenciam Project do V1
Fase 4:   Avaliar se V1 continua necessário ou se V2 absorve todos os fluxos
Fase 5:   Opcional — migrar dados V1 para v2, descontinuar V1
```

Não há prazo para descontinuar V1. Ele roda em paralelo indefinidamente até que não faça mais sentido.

---

## Docker Compose

```yaml
# Adições ao docker-compose.yml para V2
api-v2:
  build:
    context: .
    dockerfile: apps/api-v2/Dockerfile
  restart: unless-stopped
  env_file: .env
  environment:
    DATABASE_URL_V2: postgresql://rayzen:${POSTGRES_PASSWORD}@postgres:5432/rayzen_ai?schema=v2
    DATABASE_URL:    postgresql://rayzen:${POSTGRES_PASSWORD}@postgres:5432/rayzen_ai  # para V1Bridge
  ports:
    - '127.0.0.1:3103:3002'
  depends_on:
    postgres:
      condition: service_healthy
    api:
      condition: service_healthy  # V2 depende de V1 estar up (V1Bridge)
```

**Caddy (nova rota):**
```
rayzen.com.br {
  handle /v2/* {
    reverse_proxy api-v2:3002
  }
  ...
}
```

---

## Dependências

- Todos os componentes V2 usam o Prisma Client V2 (schema `v2`)
- **V1BridgeService** (in `core/`) provê acesso read-only ao schema V1
- Database migration V2: `pnpm --filter api-v2 db:migrate` (schema isolado)

---

## Fase de Implementação

**Fase 1** — definir antes de escrever qualquer model V2.

Ordem:
1. Criar `apps/api-v2/prisma/schema.prisma` com `schema = "v2"`
2. `V1BridgeService` com métodos read-only
3. Configurar `DATABASE_URL_V2` no `.env`
4. Primeira migration: criar schema `v2` no Postgres
5. Adicionar `api-v2` ao docker-compose
6. Rota `/v2/*` no Caddyfile
