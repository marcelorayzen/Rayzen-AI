# Catalog Guardian

Camada de governança, segurança e resposta em linguagem natural sobre um catálogo de dados existente (OpenMetadata nesta primeira implementação). Ver `BLUEPRINT.md` para a arquitetura completa em 6 fases e o posicionamento do produto.

**App isolado** — Prisma/DB/deploy próprios, não lê `public` nem `v2` do Rayzen em runtime. Reaproveita apenas *padrões de arquitetura* do resto do monorepo (replicados aqui como código próprio, sem import cross-app), para poder ser extraído e deployado sozinho na infra de um cliente de consultoria.

Estado atual: Fases 0-3 do blueprint implementadas **e validadas ponta a ponta contra um sandbox OpenMetadata 1.9.17 real** (não só typecheck/unit test) — golden dataset completo rodou duas vezes contra o `QueryController` real com LLM real via LiteLLM:

| Rodada | Acurácia | Alucinação | Recusa correta | Vazamento de permissão |
|---|---|---|---|---|
| 1ª (design original) | 26% | 0% | 66.7% | 10 |
| 2ª (pós-fix de permissão) | 34% | 0% | **100%** | **0** |

Acurácia abaixo de 90% é esperado, não é regressão: o catálogo de teste usado tem só 5 tabelas contra os ~30+ conceitos que os 50 casos referenciam (ver Roadmap). Fases 4-6 (motor proativo, auditoria/relatório de maturidade, segundo adapter) ainda não implementadas — ver `BLUEPRINT.md` § Fases.

**Vazamento de permissão corrigido (decisão de produto confirmada):** citar o nome de um ativo fora do domínio do usuário — mesmo com conteúdo redigido — conta como vazamento (mesmo padrão que `NEG-002` já cobre para dado de terceiro). `OpenMetadataAdapter.getUserAccessLevel()` agora trata domínio como portão primário (fora do domínio → `'none'` sempre, independente de PII — antes um ativo não-PII cross-domain ainda saía liberado); `PermissionGuardService.buildContext()` exclui ativos `'none'` do contexto inteiro, não só redige o conteúdo.

**Bugs reais de shape de API corrigidos nesta validação** (`src/adapters/openmetadata.adapter.ts`, comentados no código como "confirmado empiricamente"): OMD 1.9.17 devolve `owners`/`domains` no plural (não os singulares que a primeira versão assumia); lineage vem em `upstreamEdges`/`downstreamEdges` separados (não um `edges` único) com ids em string pura; a própria entidade consultada não aparece em `nodes` do response de lineage; comparação de domínio deve usar `name` (slug estável), nunca `displayName` (rótulo livre — usar displayName chegou a quebrar o próprio domínio "rh").

---

## Setup local

```bash
cd apps/catalog-guardian
cp .env.example .env          # ajustar OPENMETADATA_TOKEN depois de subir o sandbox
pnpm install                  # a partir da raiz do monorepo (workspace pnpm) — ou npm install aqui dentro isoladamente
```

### 1. Banco e fila próprios

```bash
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate
```

### 2. Sandbox OpenMetadata

O `docker-compose.yml` deste app **não** sobe o OpenMetadata — ele é um produto com stack própria (server + banco + Elasticsearch/OpenSearch + Airflow de ingestão) e mantém seu próprio compose oficial. Suba-o separadamente:

```bash
git clone --depth 1 https://github.com/open-metadata/OpenMetadata.git /tmp/omd
cd /tmp/omd/docker/docker-compose-quickstart
docker compose -f docker-compose-postgres.yml up -d
```

(`docker/development/*` são os composes de build-a-partir-do-source dos mantenedores — bem mais lentos, evite. `docker/docker-compose-quickstart/` é o que usa imagens prontas de `docker.getcollate.io`. No Windows, o clone completo do repo pode falhar em alguns arquivos Java de teste com "Filename too long" — inofensivo, não afeta `docker/docker-compose-quickstart/`.)

A UI sobe em `http://localhost:8585` (usuário/senha padrão `admin@open-metadata.org` / `admin`). No primeiro boot, o próprio OMD oferece ingerir o **sample data** dele (tabelas como `dim_customer`, `fact_sale`, `dim_product`...) — aceite, é a base mais rápida pra validar o pipeline.

**Gotcha de porta em máquina com múltiplos projetos:** o compose oficial do OMD mapeia `5432:5432` pro Postgres dele — se você já tem outro projeto com um Postgres nessa porta (ex: outro cliente), o `docker compose up` falha com "port is already allocated". Edite `docker-compose-postgres.yml` (linha do serviço `postgresql`, campo `ports`) pra outra porta livre no host, ex. `25432:5432` — a comunicação interna entre os serviços do OMD usa o nome do serviço na rede Docker (`DB_PORT` continua `5432` internamente), então só o mapeamento externo muda.

Gere um token de bot (Settings → Bots → ingestion-bot → Generate New Token) e coloque em `OPENMETADATA_TOKEN` no `.env`.

**Decisão sobre o dataset:** em vez de reescrever os 50 casos do golden dataset para os nomes do sample data (`dim_customer`...), o recomendado é criar no OMD sandbox entidades/domínios/termos de glossário customizados que espelhem os nomes já usados em `golden-dataset/golden-dataset.yaml` (`pedidos`, `estoque`, `clientes`, domínios `vendas/marketing/produto/financeiro/rh`) — via a própria API do OMD (`POST /api/v1/tables`, `POST /api/v1/domains`, `POST /api/v1/glossaries`). Preserva a curadoria já feita nos 50 casos. Se preferir o caminho inverso, ajuste só o YAML.

### 3. Subir a API

```bash
pnpm dev
# ou: docker compose up -d api
```

`GET http://localhost:4001/ping` deve responder `{ ok: true, service: 'catalog-guardian' }`.
Swagger em `http://localhost:4001/docs`.

### 4. Rodar o sync

```bash
pnpm sync:once
```

Confirma no log quantos ativos e edges de lineage foram sincronizados. Em produção, o `SyncModule` agenda isso automaticamente via BullMQ (`CATALOG_SYNC_INTERVAL_MS`, default 15 min).

### 5. Rodar o golden dataset

```bash
cd golden-dataset
pip install pyyaml requests   # requests só se você adaptar consultar_agente para chamar via HTTP
python avaliador.py --dataset golden-dataset.yaml --apenas-criticos
```

`consultar_agente`, `ativos_existentes` e `dominios_do_ativo` em `avaliador.py` já chamam a API real (`CATALOG_GUARDIAN_URL`, default `http://localhost:4001`) — nenhum stub `NotImplementedError` restante. `consultar_agente` mapeia `perfil` → `userId` assumindo um usuário de mesmo nome no sandbox OMD (`geral`/`financeiro`/`rh`/`steward`); ajuste via `CATALOG_GUARDIAN_USER_<PERFIL>` se os nomes reais forem outros.

---

## Estrutura

```
apps/catalog-guardian/
├── BLUEPRINT.md              # arquitetura completa em 6 fases (original, com encoding corrigido)
├── docker-compose.yml        # postgres + redis + api próprios (NÃO inclui o sandbox OMD)
├── Dockerfile                # build standalone (npm, não pnpm workspace) — deployável isolado
├── prisma/schema.prisma      # CatalogAsset, CatalogLineageEdge, QueryAudit, ReviewGate, CatalogRecommendation
├── golden-dataset/           # os 4 arquivos de referência (yaml, avaliador.py, gerar_planilha.py, README.md)
└── src/
    ├── adapters/              # CatalogAdapter (contrato) + OpenMetadataAdapter (Fase 1)
    ├── sync/                  # job BullMQ periódico + CLI manual (pnpm sync:once)
    ├── permission-guard/      # Fase 2 — retrieval permission-aware
    ├── risk-scorer/           # Fase 3 — CatalogRiskScorerService (padrão do Guardian do Rayzen)
    ├── review-gate/           # Fase 3 — gate de revisão (padrão do ApprovalGatesService do Rayzen)
    ├── audit/                 # QueryAuditService — append-only
    ├── llm/                   # cliente LiteLLM (nunca aponta direto pra provider)
    ├── query/                 # QueryController/QueryService — o "agente" que o avaliador.py chama
    └── catalog/                # endpoint de leitura pro avaliador.py consultar o catálogo sincronizado
```

## Testes

```bash
pnpm test
```

Cobertura atual: `CatalogRiskScorerService` e `PermissionGuardService` (mesmo padrão de `apps/api-v2/src/guardian/__tests__/`).

## Roadmap (ordem recomendada de ataque)

A ordem abaixo não é por número de fase do blueprint — é por dependência real: cada item destrava o próximo, ou evita retrabalho se feito fora de ordem.

### 1. Seed do sandbox como script (bloqueia tudo o mais)

Nesta validação, os 5 domains + 4 usuários + 5 tabelas do OMD foram criados via `curl` manual, não versionado. Sem um script idempotente (`golden-dataset/seed-sandbox.py` ou similar, usando a REST API do OMD), **toda validação futura exige redescobrir os mesmos comandos**. Primeiro passo antes de qualquer outro, porque os itens 2 e 3 abaixo só valem a pena repetir se puderem rodar de novo sem esforço manual.

### 2. Catálogo de teste mais rico

Com o seed automatizado, popular os ~25 conceitos que os 50 casos do golden dataset referenciam e ainda não existem (glossário de negócio, siglas internas como PMR, classificações LGPD detalhadas, lineage multi-hop, ativos sem owner de propósito para os casos `OWN-004`/`SEM-005`). Sem isso, nenhuma melhoria de código consegue empurrar a acurácia muito além de ~35%, porque a maioria das falhas é "conceito não existe no catálogo", não erro do agente.

### 3. Rota dedicada para pergunta de metadado administrativo (regressão potencial do fix de hoje)

O fix do vazamento (item confirmado nesta sessão) trocou "ativo fora do domínio aparece redigido" por "ativo fora do domínio some do contexto inteiro". Isso é correto para descoberta geral, mas **piora especificamente os casos `OWN-003`/`OWN-004`/`OWN-005`** (perguntas sobre *quem é responsável*, que devem ser respondidas mesmo sem acesso ao domínio) — hoje esses ativos são excluídos do contexto e a informação de ownership fica inacessível. `PermissionGuardService.getOwnerOnly()` já existe pronto para isso, só não está ligado a nenhuma rota. Fazer antes do item 5 (identidade real), porque sem isso o golden dataset vai continuar reportando falha crítica em `OWN-003` mesmo com identidade perfeita.

### 4. Busca semântica/glossário em `QueryService.findRelevantAssets()`

Hoje é substring simples. Os casos `DESC-003`, `SEM-002`, `SEM-005` (busca por conceito de negócio, não nome técnico) só têm chance real de passar com embeddings ou um glossário estruturado. Fazer depois do item 2 (catálogo mais rico) — não adianta melhorar a busca sobre um catálogo que ainda não tem os conceitos.

### 5. Identidade real em `OpenMetadataAdapter.getUserAccessLevel()`

Trocar a heurística por domínio pela avaliação real da policy engine do OMD (Teams/Roles/Policies/Personas). Maior risco de segurança em aberto do blueprint original — mas só vale a pena depois dos itens 1-3, porque sem seed automatizado e sem a rota de metadado administrativo, não dá para validar a mudança de forma repetível.

### 6. Fases 4-6 do blueprint (nessa ordem)

- **Fase 4** — motor proativo de qualidade de catálogo (5 regras: `unclassified_asset`, `orphan_owner`, etc.) — só faz sentido com catálogo real povoado (item 2).
- **Fase 5** — exportação de auditoria + relatório de maturidade DAMA — depende de já ter rodado validações reais o suficiente pra ter dado histórico.
- **Fase 6** — segundo adapter (Unity Catalog ou Dataplex) provando que a abstração não é lock-in — só compensa depois do adapter OpenMetadata estar maduro (itens 1-5), senão duplica retrabalho de shape de API duas vezes.

### 7. Polimento operacional (qualquer momento, baixo risco, sem dependência)

- `SyncProcessor` sem listener de falha do BullMQ (`worker.on('failed', ...)`) — job falho fica silencioso, sem log visível.
- `SyncService.syncOnce()` conta a mesma lineage edge duas vezes no log quando descoberta dos dois lados — upsert no banco é idempotente (correto), só o contador do log superestima.
- Sem `.dockerignore` explícito — o `Dockerfile` já faz `COPY` seletivo, então não vaza segredo, mas seria mais à prova de futuro.
- `pnpm test` na raiz do monorepo só roda `apps/api` (script fixo, não glob) — os testes do Catalog Guardian rodam via `pnpm --filter catalog-guardian test`. Mesmo padrão já existia para `api-v2`, não é regressão nova.

## Ambiente de validação

O sandbox OpenMetadata e o stack próprio do app foram **derrubados** ao fim da validação desta sessão (`docker compose down` nos dois lugares) — não há nada rodando para reconectar. Para retomar, seguir "Setup local" acima do zero (e, idealmente, começar pelo item 1 do Roadmap antes de repetir o seed manual).
