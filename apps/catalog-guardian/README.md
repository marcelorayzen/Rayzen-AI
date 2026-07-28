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

Gere um Personal Access Token do admin logo após o primeiro boot (não precisa de bot dedicado pra este sandbox de teste):

```bash
curl -X POST http://localhost:8585/api/v1/users/login -H "Content-Type: application/json" \
  -d '{"email":"admin@open-metadata.org","password":"YWRtaW4="}'
# copiar accessToken da resposta, pegar o id do admin:
curl http://localhost:8585/api/v1/users/name/admin -H "Authorization: Bearer <accessToken>"
# gerar o PAT de longa duracao:
curl -X PUT http://localhost:8585/api/v1/users/generateToken/<admin-id> \
  -H "Authorization: Bearer <accessToken>" -H "Content-Type: application/json" \
  -d '{"JWTTokenExpiry":"Unlimited"}'
```

Coloque o `JWTToken` retornado em `OPENMETADATA_TOKEN` no `.env`.

**Gotcha confirmado:** gerar esse PAT pro usuário `admin` quebra o login por senha dele depois (`POST /users/login` passa a devolver `NullPointerException`/"charSequence is null"). O token em si continua funcionando normalmente — só não dá pra logar de novo por senha. Gere o PAT uma vez, guarde o token, não tente relogar.

**Decisão sobre o dataset:** em vez de reescrever os 50 casos do golden dataset para os nomes do sample data (`dim_customer`...), o recomendado é popular o sandbox com entidades/domínios que espelham os nomes já usados em `golden-dataset/golden-dataset.yaml` (`pedidos`, `estoque`, `clientes`, domínios `vendas/marketing/produto/financeiro/rh`). Preserva a curadoria já feita nos 50 casos.

### 3. Popular o catálogo de teste (seed automatizado)

```bash
cd golden-dataset
python seed_sandbox.py --token "<OPENMETADATA_TOKEN>"
```

Cria os 5 domains, 4 usuários (`geral`/`financeiro`/`rh`/`steward`, com `dominios_permitidos` espelhando `golden-dataset.yaml`), o service/database/schema, as 5 tabelas com colunas e tags PII, e 1 edge de lineage. **Idempotente** — usa `PUT` (create-or-update nativo do OMD; `POST` numa entidade existente devolve 409) em vez de `POST`, então rodar de novo não duplica nem falha. Validado nesta sessão rodando duas vezes seguidas contra o mesmo sandbox sem erro.

### 4. Subir a API

```bash
pnpm dev
# ou: docker compose up -d api
```

`GET http://localhost:4001/ping` deve responder `{ ok: true, service: 'catalog-guardian' }`.
Swagger em `http://localhost:4001/docs`.

### 5. Rodar o sync

```bash
pnpm sync:once
```

Confirma no log quantos ativos e edges de lineage foram sincronizados. Em produção, o `SyncModule` agenda isso automaticamente via BullMQ (`CATALOG_SYNC_INTERVAL_MS`, default 15 min).

### 6. Rodar o golden dataset

```bash
cd golden-dataset
pip install pyyaml
python avaliador.py --dataset golden-dataset.yaml --apenas-criticos
```

`consultar_agente`, `ativos_existentes` e `dominios_do_ativo` em `avaliador.py` já chamam a API real (`CATALOG_GUARDIAN_URL`, default `http://localhost:4001`) — nenhum stub `NotImplementedError` restante. `consultar_agente` mapeia `perfil` → `userId` assumindo um usuário de mesmo nome no sandbox OMD (`geral`/`financeiro`/`rh`/`steward`); ajuste via `CATALOG_GUARDIAN_USER_<PERFIL>` se os nomes reais forem outros.

**Cuidado com quota de LLM ao rodar o conjunto completo (50 casos):** cada caso consome ~500-600 tokens via LiteLLM. O Groq tem limite diário de 100k tokens (TPD) compartilhado com o resto do Rayzen nesta mesma infra — rodar o conjunto completo repetidas vezes no mesmo dia pode esgotar a quota (confirmado nesta sessão: 429 do Groq com o fallback Anthropic também bloqueado por falta de crédito). Isso é uma restrição externa de provider, não bug do Catalog Guardian — ver `docs/architecture.md` § Riscos conhecidos. Prefira `--apenas-criticos` (13 casos) pra iteração rápida e reserve o conjunto completo pra quando precisar do número real.

---

## Estrutura

```
apps/catalog-guardian/
├── BLUEPRINT.md              # arquitetura completa em 6 fases (original, com encoding corrigido)
├── docker-compose.yml        # postgres + redis + api próprios (NÃO inclui o sandbox OMD)
├── Dockerfile                # build standalone (npm, não pnpm workspace) — deployável isolado
├── prisma/schema.prisma      # CatalogAsset, CatalogLineageEdge, QueryAudit, ReviewGate, CatalogRecommendation
├── golden-dataset/           # os 4 arquivos de referência (yaml, avaliador.py, gerar_planilha.py, README.md) + seed_sandbox.py
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

### 1. ✅ Seed do sandbox como script — feito

`golden-dataset/seed_sandbox.py` substitui os `curl` manuais desta validação — usa `PUT` (create-or-update nativo do OMD) pra ser idempotente, validado rodando duas vezes seguidas contra o mesmo sandbox sem erro nem duplicação. Ver "Setup local" § 3 acima.

**Achado colateral ao revalidar:** rodar o conjunto completo do golden dataset múltiplas vezes no mesmo dia esgotou a quota diária do Groq (100k tokens TPD, compartilhada com o resto do Rayzen) — o fallback pro Anthropic também falhou por falta de crédito. É uma restrição externa de provider (ver `docs/architecture.md` § Riscos conhecidos), não algo pra "consertar" aqui; só planejar validações completas com essa quota em mente.

### 2. ✅ Catálogo de teste mais rico — seed feito, validação por LLM bloqueada por quota externa

`seed_sandbox.py` cresceu de 5 para **10 tabelas** (+ `produtos`, `cadastro_fornecedores`, `acordos_comerciais`, `clientes_cancelamentos`, `contas_a_receber`), ganhou um **glossário** (`termos_de_negocio`, 7 termos: `venda_bruta`, `pmr`, `cliente_ativo`/`cliente_vigente`, `cliente`/`consumidor`, `churn`), **owners** (`pedidos` → `steward`; domínio `financeiro` → usuário `financeiro`; domínio `rh` → usuário `rh`), uma tag `Tier.Tier1` em `clientes`, e **lineage multi-hop** (`produtos → estoque → pedidos`, `contas_a_receber → fin_faturamento_mensal`). Mapeamento completo caso-a-caso nos comentários do próprio script. Casos de `PROCESSO` (`PRO-001..004`) ficaram de fora de propósito — são perguntas de política institucional, não metadado de catálogo.

Validado **sem custo de LLM**: 10 tabelas sincronizadas, owners corretos em `pedidos`/`financeiro`/`rh` confirmados via API direta do OMD, lineage `produtos→estoque→pedidos` traçado corretamente em 2 hops, script rodado duas vezes seguidas sem duplicar nada.

**Bloqueado:** rodar o golden dataset de novo pra medir o ganho real de acurácia — a quota diária do Groq (100k tokens TPD) **continuava esgotada** no dia seguinte à primeira validação (99935/100000 usados, mesma organização compartilhada com o resto do Rayzen), e o fallback Anthropic segue sem crédito. Duas sessões seguidas bateram nessa parede. **Ação recomendada para o dono do projeto:** colocar crédito na conta Anthropic usada pelo fallback do LiteLLM (`infra/litellm/config.yaml`) — sem isso, qualquer pico de uso do Groq (não só deste app) derruba toda chamada de LLM do Rayzen sem rede de segurança. Depois de resolvido, rodar `avaliador.py --apenas-criticos` (13 casos, mais barato) contra este catálogo pra medir o ganho real antes do conjunto completo.

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

O sandbox OpenMetadata e o stack próprio do app foram **derrubados** de novo ao fim de cada rodada de validação (`docker compose down` nos dois lugares) — não há nada rodando para reconectar. Para retomar, seguir "Setup local" acima do zero — agora com `seed_sandbox.py` fazendo o trabalho pesado do catálogo em segundos.
