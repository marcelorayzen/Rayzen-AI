# Catalog Guardian

Camada de governança, segurança e resposta em linguagem natural sobre um catálogo de dados existente (OpenMetadata nesta primeira implementação). Ver `BLUEPRINT.md` para a arquitetura completa em 6 fases e o posicionamento do produto.

**App isolado** — Prisma/DB/deploy próprios, não lê `public` nem `v2` do Rayzen em runtime. Reaproveita apenas *padrões de arquitetura* do resto do monorepo (replicados aqui como código próprio, sem import cross-app), para poder ser extraído e deployado sozinho na infra de um cliente de consultoria.

Estado atual: Fases 0-3 do blueprint implementadas **e validadas ponta a ponta contra um sandbox OpenMetadata 1.9.17 real** (não só typecheck/unit test) — golden dataset completo rodou contra o `QueryController` real com LLM real via LiteLLM. Resultado em `golden-dataset/resultado-completo.json`: 26% de acurácia, 0% de alucinação, 10 vazamentos de permissão — número baixo de acurácia é esperado, não é regressão: o catálogo de teste usado tem só 5 tabelas contra os ~30+ conceitos que os 50 casos referenciam. Fases 4-6 (motor proativo, auditoria/relatório de maturidade, segundo adapter) ainda não implementadas — ver `BLUEPRINT.md` § Fases.

**Achado de design real dos 10 vazamentos** (não é bug de infra): `PermissionGuardService` inclui o ativo fora do domínio permitido no contexto do LLM com conteúdo redigido, mas o **nome** do ativo continua visível — e o LLM às vezes cita esse nome mesmo declarando que está restrito, o que o `avaliador.py` conta como vazamento (mesmo padrão que `NEG-002` já cobre: nem a localização de um dado deve vazar). Se essa leitura estiver certa, o fix é `QueryService.findRelevantAssets()` excluir o ativo do contexto inteiro quando fora do domínio, não só redigir o conteúdo — ainda não implementado, ver `memory/project_catalog_guardian_status.md` para o achado completo.

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

## Próximos passos (não implementados nesta rodada)

- **Decisão de produto sobre os 10 vazamentos** achados na validação real (ver acima) — provavelmente exige `QueryService.findRelevantAssets()` excluir ativo fora de domínio do contexto inteiro, não só redigir conteúdo.
- Fechar de verdade o mapeamento de identidade em `OpenMetadataAdapter.getUserAccessLevel()` — a implementação atual é uma heurística por domínio (`name`, não `displayName`), não a avaliação completa da policy engine nativa do OMD (Teams/Roles/Policies/Personas). Maior risco em aberto do blueprint.
- Fase 4 — motor proativo de qualidade de catálogo (5 regras).
- Fase 5 — exportação de auditoria + relatório de maturidade DAMA.
- Fase 6 — segundo adapter (Unity Catalog ou Dataplex) provando a abstração.
- Busca de ativos hoje é substring simples (`QueryService.findRelevantAssets`) — os casos DESC-003/SEM-002/SEM-005 do golden dataset (busca semântica/glossário) vão exigir embeddings ou um glossário estruturado.
- Catálogo de teste usado na validação (`golden-dataset/resultado-completo.json`) tem só 5 tabelas — para fitness real do dataset, popular os outros ~25 conceitos referenciados (glossário de negócio, siglas internas, classificações LGPD detalhadas, lineage multi-hop).

## Ambiente de validação desta sessão (2026-07-27)

Sandbox OpenMetadata 1.9.17 + dados de teste ficaram no ar para inspeção — ver `memory/project_catalog_guardian_status.md` para como reconectar (token, portas, decisões) ou desligar (`docker compose down` no app e no sandbox OMD clonado em `docker/docker-compose-quickstart/`).
