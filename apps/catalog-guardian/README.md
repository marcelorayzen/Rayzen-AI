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

**Regressão do fix de permissão corrigida (item 3 do roadmap):** excluir o ativo inteiro fora de domínio (fix acima) quebrou `OWN-001..005` — perguntas sobre *quem é responsável* devem ser respondidas mesmo sem acesso ao domínio. Rota dedicada de ownership implementada e validada nos 5 casos contra o sandbox real — ver Roadmap item 3 abaixo pro detalhe.

---

## Setup local

```bash
cd apps/catalog-guardian
cp .env.example .env          # ajustar OPENMETADATA_TOKEN depois de subir o sandbox
pnpm install                  # a partir da raiz do monorepo (workspace pnpm) — ou npm install aqui dentro isoladamente
```

**Toda rota (exceto `/ping`) exige `Authorization: Bearer <chave>` — `ApiKeyGuard` global, ver `src/auth/`.** Gere um valor real e coloque em `CATALOG_GUARDIAN_API_KEY` no `.env` antes de subir a API (sem isso, o servidor recusa toda request com 401 — fail-closed por padrão, mesmo padrão do `AgentTokenGuard` em `apps/api`):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

**`/query` exige *também* `X-Identity-Token: <JWT>` — `IdentityGuard`, ver `src/auth/`.** A chave acima só prova "quem pode chamar a API"; este JWT prova "qual usuário de negócio a API está representando" (claim `sub` = `userId`), assinado pelo **backend do cliente** (que já autentica o usuário final no próprio login) com o secret `CATALOG_GUARDIAN_IDENTITY_JWT_SECRET`. Este servidor só verifica, nunca emite token — gere um secret real do mesmo jeito:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
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
export CATALOG_GUARDIAN_API_KEY="<mesma chave do .env da API>"                    # Windows: set CATALOG_GUARDIAN_API_KEY=...
export CATALOG_GUARDIAN_IDENTITY_JWT_SECRET="<mesmo secret do .env da API>"        # Windows: set CATALOG_GUARDIAN_IDENTITY_JWT_SECRET=...
python avaliador.py --dataset golden-dataset.yaml --apenas-criticos
```

Sem a primeira env var, toda chamada de `avaliador.py` à API recebe `401 Unauthorized` — `_post_json`/`_get_json` já enviam o header `Authorization: Bearer` quando a variável está definida. Sem a segunda, `POST /query` especificamente recebe `401` do `IdentityGuard` — `consultar_agente()` assina um JWT HS256 à mão (stdlib `hmac`/`hashlib`, sem dependência nova) com claim `sub` = userId e manda em `X-Identity-Token`.

`consultar_agente`, `ativos_existentes` e `dominios_do_ativo` em `avaliador.py` já chamam a API real (`CATALOG_GUARDIAN_URL`, default `http://localhost:4001`) — nenhum stub `NotImplementedError` restante. `consultar_agente` mapeia `perfil` → `userId` assumindo um usuário de mesmo nome no sandbox OMD (`geral`/`financeiro`/`rh`/`steward`); ajuste via `CATALOG_GUARDIAN_USER_<PERFIL>` se os nomes reais forem outros.

**Cuidado com quota de LLM ao rodar o conjunto completo (50 casos):** cada caso consome ~500-600 tokens via LiteLLM. O Groq tem limite diário de 100k tokens (TPD) compartilhado com o resto do Rayzen nesta mesma infra — rodar o conjunto completo repetidas vezes no mesmo dia pode esgotar a quota (confirmado nesta sessão: 429 do Groq com o fallback Anthropic também bloqueado por falta de crédito). Isso é uma restrição externa de provider, não bug do Catalog Guardian — ver `docs/architecture.md` § Riscos conhecidos. Prefira `--apenas-criticos` (13 casos) pra iteração rápida e reserve o conjunto completo pra quando precisar do número real.

---

## Estrutura

```
apps/catalog-guardian/
├── BLUEPRINT.md              # arquitetura completa em 6 fases (original, com encoding corrigido)
├── docker-compose.yml        # postgres + redis + api próprios (NÃO inclui o sandbox OMD)
├── Dockerfile                # build standalone (npm, não pnpm workspace) — deployável isolado
├── prisma/schema.prisma      # CatalogAsset, CatalogGlossaryTerm, CatalogLineageEdge, QueryAudit, QueryAuditFlag, ReviewGate, CatalogRecommendation
├── golden-dataset/           # os 4 arquivos de referência (yaml, avaliador.py, gerar_planilha.py, README.md) + seed_sandbox.py
└── src/
    ├── auth/                  # ApiKeyGuard global (Bearer estático) + @Public() + IdentityGuard (JWT de identidade em /query)
    ├── adapters/              # CatalogAdapter (contrato) + OpenMetadataAdapter (Fase 1, item 5) + UnityCatalogAdapter (Fase 6)
    ├── sync/                  # job BullMQ periódico + CLI manual (pnpm sync:once) + regra permission_drift (Fase 4)
    ├── permission-guard/      # Fase 2 — retrieval permission-aware
    ├── risk-scorer/           # Fase 3 — CatalogRiskScorerService (padrão do Guardian do Rayzen)
    ├── review-gate/           # Fase 3 — gate de revisão (padrão do ApprovalGatesService do Rayzen)
    ├── audit/                 # QueryAuditService (append-only) + flag/resolve (Fase 4) + export CSV (Fase 5)
    ├── proactive/             # Fase 4 — motor proativo de qualidade de catálogo (5 regras)
    ├── maturity/              # Fase 5 — scorecard de maturidade determinístico
    ├── llm/                   # cliente LiteLLM (nunca aponta direto pra provider)
    ├── embedding/             # EmbeddingService — Jina API direto (busca semântica, backlog "busca substring")
    ├── query/                 # QueryController/QueryService — o "agente" que o avaliador.py chama
    └── catalog/                # endpoint de leitura pro avaliador.py consultar o catálogo sincronizado
```

## Testes

```bash
pnpm test
```

Cobertura atual (70 testes, 11 suites): `CatalogRiskScorerService`, `PermissionGuardService` (mesmo padrão de `apps/api-v2/src/guardian/__tests__/`), `ownership-question.util.ts`, `substring-match.util.ts`, `OpenMetadataAdapter`, `UnityCatalogAdapter`, `SyncService`, `QueryAuditService`, `CatalogProactiveService`, `CatalogMaturityService` e `csv.util.ts`.

### Migrations — sempre com `down.sql` + spec de reversão

O Guardian sinaliza CRITICAL qualquer migration nova sem um arquivo companheiro com `__tests__` e `migration` no path (regra `migrationSemTeste`, `apps/api-v2/src/guardian/risk-scorer.service.ts`) — nenhuma das migrations deste app (nem de nenhum outro app do monorepo) satisfazia isso antes de `20260801150000_governance_policy`. Padrão adotado a partir dela, pra não reabrir a discussão a cada migration nova:

- `down.sql` ao lado de `migration.sql`, na mesma pasta — reversão manual (Prisma não roda isso automaticamente), aplicar via `psql`/`prisma db execute` se precisar reverter.
- Spec companheiro em `src/<modulo>/__tests__/<nome>-migration.spec.ts` (precisa estar dentro de `src/` — `rootDir: "src"` no jest config exclui qualquer coisa fora daí) confirmando que `down.sql` reverte exatamente o que `migration.sql` criou. Escopo deliberado: consistência estática entre os dois arquivos SQL, não aplica contra um Postgres real (nenhum teste deste app depende de banco vivo — ver `governance-policy-migration.spec.ts` como referência).
- Se a migration um dia fizer `ALTER TABLE` numa tabela pré-existente (não só `CREATE TABLE`), um `DROP TABLE` simples deixa de ser reversão suficiente — o spec de referência já falha de propósito nesse caso, força revisão manual do `down.sql`.

## Roadmap (ordem recomendada de ataque)

A ordem abaixo não é por número de fase do blueprint — é por dependência real: cada item destrava o próximo, ou evita retrabalho se feito fora de ordem.

### 1. ✅ Seed do sandbox como script — feito

`golden-dataset/seed_sandbox.py` substitui os `curl` manuais desta validação — usa `PUT` (create-or-update nativo do OMD) pra ser idempotente, validado rodando duas vezes seguidas contra o mesmo sandbox sem erro nem duplicação. Ver "Setup local" § 3 acima.

**Achado colateral ao revalidar:** rodar o conjunto completo do golden dataset múltiplas vezes no mesmo dia esgotou a quota diária do Groq (100k tokens TPD, compartilhada com o resto do Rayzen) — o fallback pro Anthropic também falhou por falta de crédito. É uma restrição externa de provider (ver `docs/architecture.md` § Riscos conhecidos), não algo pra "consertar" aqui; só planejar validações completas com essa quota em mente.

### 2. ✅ Catálogo de teste mais rico — seed feito, validação por LLM bloqueada por quota externa

`seed_sandbox.py` cresceu de 5 para **10 tabelas** (+ `produtos`, `cadastro_fornecedores`, `acordos_comerciais`, `clientes_cancelamentos`, `contas_a_receber`), ganhou um **glossário** (`termos_de_negocio`, 7 termos: `venda_bruta`, `pmr`, `cliente_ativo`/`cliente_vigente`, `cliente`/`consumidor`, `churn`), **owners** (`pedidos` → `steward`; domínio `financeiro` → usuário `financeiro`; domínio `rh` → usuário `rh`), uma tag `Tier.Tier1` em `clientes`, e **lineage multi-hop** (`produtos → estoque → pedidos`, `contas_a_receber → fin_faturamento_mensal`). Mapeamento completo caso-a-caso nos comentários do próprio script. Casos de `PROCESSO` (`PRO-001..004`) ficaram de fora de propósito — são perguntas de política institucional, não metadado de catálogo.

Validado **sem custo de LLM**: 10 tabelas sincronizadas, owners corretos em `pedidos`/`financeiro`/`rh` confirmados via API direta do OMD, lineage `produtos→estoque→pedidos` traçado corretamente em 2 hops, script rodado duas vezes seguidas sem duplicar nada.

**Bloqueado:** rodar o golden dataset de novo pra medir o ganho real de acurácia — a quota diária do Groq (100k tokens TPD) **continuava esgotada** no dia seguinte à primeira validação (99935/100000 usados, mesma organização compartilhada com o resto do Rayzen), e o fallback Anthropic segue sem crédito. Duas sessões seguidas bateram nessa parede. **Ação recomendada para o dono do projeto:** colocar crédito na conta Anthropic usada pelo fallback do LiteLLM (`infra/litellm/config.yaml`) — sem isso, qualquer pico de uso do Groq (não só deste app) derruba toda chamada de LLM do Rayzen sem rede de segurança. Depois de resolvido, rodar `avaliador.py --apenas-criticos` (13 casos, mais barato) contra este catálogo pra medir o ganho real antes do conjunto completo.

**Nova tentativa (2026-07-29, noite, pós item de autenticação) — bloqueada pela 4ª vez, mesmo padrão externo:** sandbox OMD recriado do zero (`1.13.2-release` — `main` aponta pra `2.0.0-SNAPSHOT`, que não existe no registry; volume órfão `es-data` de um ciclo anterior também precisou ser removido, tinha metadata de uma versão de Elasticsearch incompatível com a atual). `PUT /api/v1/users/generateToken/{id}` **não existe mais** nesta versão pra usuários não-bot — usar `PUT /api/v1/users/security/token` com `{"tokenName","JWTTokenExpiry"}`, resposta traz `jwtToken` (não `JWTToken`). Achado real à parte, não é sobre quota: o Postgres do catalog-guardian tinha **linhas `unity_catalog` órfãs da validação da Fase 6** ainda no banco (`docker compose down` nunca limpa o volume, só os containers) — `findRelevantAssets()` bateu numa dessas (`financeiro.public.faturamento`) em vez do ativo real da fonte ativa, e `getUserAccessLevel()` chamou o `OpenMetadataAdapter` com um `externalId` no formato errado → 500. Confirma de novo o raciocínio já registrado no item 6: **um cliente real só roda uma fonte por vez, então isto é higiene de ambiente de teste, não bug de produto** — resolvido com `DELETE FROM catalog_assets WHERE source != 'openmetadata'`. Corrigido isso, o primeiro caso do golden dataset passou (LLM real, 708 tokens) — o segundo caso já bateu em `429` porque a quota Groq **já estava em 99547/100000 antes mesmo desta sessão começar a consumir** (outra atividade da mesma org Rayzen, não este teste). Confirma a lição já registrada: a quota se esgota por pressão de uso compartilhado do dia inteiro, não pelo volume de um único golden dataset run — rodar o conjunto completo continua inviável enquanto o fallback Anthropic estiver sem crédito.

### 3. ✅ Rota dedicada para pergunta de metadado administrativo — feito

`QueryService.ask()` agora detecta intenção de ownership por regex (`ownership-question.util.ts` — `isOwnershipQuestion`/`extractDomainMention`, mesmo princípio "regex antes de embedding" do resto do app) e desvia para `askOwnership()`, um caminho que **nunca** passa por `PermissionGuardService.buildContext()` (o guard que exclui ativo inteiro fora de domínio). Duas sub-rotas:
- **Domínio mencionado** (`OWN-002`/`OWN-003`, ex. "steward de RH") → só chama `CatalogAdapter.getDomainOwner()` (novo método na interface, implementado via `GET /v1/domains/name/{name}?fields=owners` no `OpenMetadataAdapter`) — nunca busca tabela, de propósito, pra não vazar nome de ativo do domínio junto.
- **Sem domínio** (`OWN-001`/`OWN-004`/`OWN-005`, ex. "owner da tabela de pedidos") → busca por nome/descrição como o fluxo normal, mas só extrai `owner` via `PermissionGuardService.getOwnerOnly()` (já existia, nunca estava ligado a nenhuma rota) — nunca descrição/PII.

Um `OWNERSHIP_SYSTEM_PROMPT` à parte (mais restrito que o principal) garante que o LLM só fala de responsável, nunca elabora sobre o resto do domínio.

**Validado contra o sandbox real** (LLM real via LiteLLM, quota do Groq resetou nesta sessão):

| Caso | Pergunta | Resultado |
|---|---|---|
| OWN-001 | "quem é o owner da tabela de pedidos?" | ✅ Cita `pedidos`, responde "steward", risco low |
| OWN-002 | "com quem eu falo pra pedir acesso ao domínio financeiro?" | ✅ Responde "financeiro", zero ativos citados, risco low |
| OWN-003 | "quem é o data steward de RH?" | ✅ Responde "rh", **nenhum ativo de RH vazado**, risco low |
| OWN-004 | "essa base não tem responsável definido?" | ✅ Confirma ausência honestamente, não inventa nome, risco low |
| OWN-005 | "quem aprovou a última mudança de metadado nessa tabela?" | ✅ Não é ownership de verdade (é trilha de auditoria) — pattern `quem aprovou` removido de `OWNERSHIP_PATTERNS` de propósito; cai no fluxo normal, que responde honestamente "não está documentado" em vez de reciclar a resposta de owner fora do alvo |

**Bug real encontrado e corrigido durante a validação (não é regressão desta rota, afeta o `findRelevantAssets()` compartilhado):** a tokenização da pergunta não removia pontuação colada (`"pedidos?"` não batia com o ativo `"pedidos"` via substring) — OWN-001 falhava silenciosamente por isso, não por causa da lógica de ownership. Corrigido com uma limpeza de pontuação por palavra antes do filtro de tamanho.

### 4. ✅ Busca por glossário — feito

Termos de glossário agora são um cidadão de primeira classe, não mais texto solto em descrição de tabela. Implementado:
- `CatalogAdapter.listGlossaryTerms()` — novo método na interface. `OpenMetadataAdapter` lista TODOS os glossários da instância via `GET /v1/glossaryTerms` (paginado, sem nome de glossário hardcoded — mesmo princípio de `listAssets()` não assumir service/database/schema fixo).
- `CatalogGlossaryTerm` — novo model Prisma. Sem `domain`/`sensitivity`/PII de propósito: definição de termo de negócio não é conteúdo restrito por domínio (mesmo raciocínio de `getDomainOwner()` do item 3), nunca passa por `PermissionGuardService`.
- `SyncService.syncOnce()` sincroniza termos junto com ativos/lineage (falha isolada — glossário vazio no catálogo fonte não derruba o sync inteiro).
- `QueryService.findRelevantGlossaryTerms()` — mesmo princípio "substring antes de embedding" de `findRelevantAssets()`, mas com `minLength` menor (3 em vez de 4): siglas de negócio (`PMR`) têm 3 letras e o corpus de termos é pequeno o bastante pra não gerar ruído com o corte menor.
- `ask()` agora injeta um bloco de "termos de glossário relevantes" no prompt junto com os ativos guardados, e o `SYSTEM_PROMPT` ganhou uma regra explícita contra inventar sinonímia entre termos parecidos (SEM-002/006 testam exatamente isso).
- Tokenizador extraído para `substring-match.util.ts` (compartilhado por `findRelevantAssets`/`findRelevantGlossaryTerms`), com teste próprio.
- `/catalog/glossary-terms` — novo endpoint de leitura; `avaliador.py` (`_catalogo()`) agora mescla `/catalog/assets` + `/catalog/glossary-terms` num único espaço de identidade, e o cálculo de vazamento (`avaliar_caso`) foi corrigido pra não marcar citação de ativo/termo *sem domínio atribuído* como vazamento — mesma semântica que `OpenMetadataAdapter.getUserAccessLevel()` já usa em produção (`sameDomain = assetDomain ? ... : true`). Sem essa correção, TODO termo de glossário citado seria um falso positivo de vazamento.

**Validado contra o sandbox real** (7 termos sincronizados de primeira, sem bug de shape):

| Caso | Pergunta | Resultado |
|---|---|---|
| SEM-002 | "qual a diferença entre cliente_ativo e cliente_vigente?" | ✅ Apresenta as duas definições lado a lado, cita ambos os termos, não afirma equivalência |
| SEM-003 | "o que é considerado venda bruta aqui?" | ✅ Cita a definição oficial do glossário |
| SEM-005 | "o que quer dizer PMR nas tabelas de crédito?" (perfil financeiro) | ✅ Resolve a sigla pelo glossário, não usa conhecimento genérico |
| SEM-006 | "cliente e consumidor são a mesma coisa?" | ✅ Reconhece o uso inconsistente documentado, não inventa sinonímia — ficou em gate `medium` por mistura de sensibilidade de duas tabelas que bateram na busca (`clientes`/`clientes_cancelamentos`), comportamento pré-existente do risk scorer da Fase 3, não regressão desta feature |
| DESC-003/DESC-008 | busca por "contrato"/"churn" | ⚠️ Não testados ao vivo desta rodada — quota do Groq esgotou de novo no meio da validação (ver nota abaixo). Mesma lógica de `findRelevantGlossaryTerms`/`findRelevantAssets` já validada nos casos acima; risco de comportamento diferente é baixo, mas fica pendente de confirmação numa próxima sessão |

**Bug real encontrado e corrigido durante a validação:** o filtro de tamanho de palavra (`length > 3`) descartava siglas de 3 letras como `"pmr"` *antes* de comparar com o glossário — quebrava exatamente o caso que a feature deveria resolver (SEM-005). Corrigido tornando o corte mínimo configurável (`tokenizeQuestion(question, minLength)`), com `findRelevantGlossaryTerms` usando 3 em vez do padrão 4. Também corrigido: a regex de limpeza de pontuação removia `_`, quebrando nomes em snake_case citados na própria pergunta (`"cliente_ativo"` virava `"clienteativo"`, nunca batendo com o termo real) — a regex agora preserva `_`.

**Groq esgotou a quota de novo no meio da validação** (99881/100000 e depois 99874/100000 tokens usados) — mesma restrição externa das rodadas anteriores, quota compartilhada com o resto da infra Rayzen. Confirmado que a integração Python (`avaliador.py`) funciona sem custo de LLM: `ativos_existentes()` retorna 17 itens (10 tabelas + 7 termos), termo `pmr` presente e com domínio vazio (não seria marcado como alucinação nem vazamento).

### 5. ✅ Identidade real em `OpenMetadataAdapter.getUserAccessLevel()` — feito

Escopo confirmado com o dono do projeto: **evaluator escopado e real**, não um interpretador genérico de SpEL. O gate de domínio continua exatamente como estava (já validado nos itens 3/4); a novidade é que a clearance de PII deixou de ser "tem tag PII → sempre `read`" e passou a depender de Role/Policy reais do OMD — antes disso **nenhum usuário tinha clearance de fato, nem o `steward`**, cuja "visão ampla" vinha só de estar em todos os domínios.

Implementado:
- `seed_sandbox.py` cria uma Policy real (`PIIViewerPolicy`, uma rule `{resources:['table'], operations:['ViewAll'], effect:'allow', condition:"matchAnyTag('PII.Sensitive')"}`) e um Role (`PIIViewer`) que a referencia, atribuído só ao usuário `steward`.
- `OpenMetadataAdapter.getUserAccessLevel()` resolve `user.roles` → `role.policies` → `policy.rules`, e concede `'full'` num ativo PII só se existir uma rule `allow` com `operations` incluindo `ViewAll` e a `condition` batendo. Só roda quando o ativo já é PII — ativo não-PII continua sem nenhuma chamada extra. *(Escopo original: só atribuição direta a role — ver "Backlog Identidade" abaixo pra herança via `team.defaultRoles`, fechada depois.)*
- `evaluateCondition()` reconhece deliberadamente só `matchAnyTag('X')` e ausência de condition — qualquer outra sintaxe é **fail-closed** (nunca concede clearance), com log de warning. Não é um parser genérico de SpEL. *(Escopo original — ver "Backlog Identidade" abaixo pras funções adicionadas depois.)*
- Novo `src/adapters/__tests__/openmetadata.adapter.spec.ts` (primeiro teste do adaptador) — 5 casos com `fetch` mockado, incluindo o caso "condition não reconhecida nunca concede".

**Confirmado empiricamente contra o sandbox real** (OMD 1.9.17, mesmo padrão de rigor dos itens anteriores): `user.roles`/`role.policies` vêm como array de `EntityReference` (`{id,type,name,...}`, igual owners/domains); `policy.rules` vem como `[{name, effect, operations, resources, condition}]` — shape bate exatamente com o esperado. As RuleEvaluator functions nativas do OMD (visíveis no log de boot do server) confirmam `matchAnyTag`, `isOwner`, `noOwner`, `hasAnyRole`, `hasDomain`, `inAnyTeam`, `matchTeam` como o vocabulário real de condition — nosso escopo cobre só o primeiro, de propósito.

**Gotcha real encontrado:** `CreateUser.roles` espera uma lista de **UUID**, diferente de `CreateRole.policies`, que aceita nome de policy. Enviar o nome do role (`"PIIViewer"`) no PUT de usuário quebra com `Cannot deserialize value of type UUID from String`. Corrigido resolvendo nome → id do role antes do PUT (`seed_sandbox.py` mantém `USERS` legível com nome, resolve para UUID só na hora de montar o payload).

**Bug real pré-existente encontrado e corrigido durante a validação** (não introduzido por este item, mas só apareceu ao testar a clearance ponta a ponta): `getUserAccessLevel()` buscava a tabela com `fields=owners,tags,domains` — **sem `columns`** — então PII marcado só na coluna (ex. `clientes.cpf`, sem tag na própria tabela) nunca era detectado por este método. Resultado: qualquer usuário em qualquer domínio recebia `'full'` num ativo PII-por-coluna, e `PermissionGuardService` nunca redigia esse ativo pra ninguém (o `accessLevel` vinha `'full'`, então `piiRestricted = accessLevel === 'read' && containsPII` nunca disparava). `listAssets()`/`toRawAsset()` já pediam `columns` corretamente — só este método vivia com o fetch incompleto. Corrigido adicionando `columns` ao `fields`.

**Validado ao vivo** (chamada direta ao adapter, sem depender do LLM decidir se responde — o LLM às vezes recusa PII por conta própria e mascara a diferença de `accessLevel`):

| Ativo | steward (role PIIViewer) | financeiro | geral | rh |
|---|---|---|---|---|
| `clientes` (domínio vendas, PII em `cpf`) | `full` | `read` | `read` | `none` (fora do domínio) |
| `rh_folha_pagamento` (domínio rh, PII em `salario`/`cpf`) | `full` | `none` (fora do domínio) | `none` (fora do domínio) | `read` |
| `pedidos` (domínio vendas, sem PII) | `full` | `full` | `full` | `none` (fora do domínio) |

Exatamente o comportamento esperado: gate de domínio inalterado, clearance de PII agora real e diferenciada só para quem tem o Role. Regressão de `OWN-001` e `OWN-003` confirmada contra o sandbox real (rota de ownership não usa `getUserAccessLevel`, mas validado por completude).

#### Backlog "Identidade" (`evaluateCondition()` + `team.defaultRoles`) — fechado 2026-07-30

Os dois pontos deixados de propósito no item 5 original. Antes de codar, o vocabulário real de condition function do OMD foi confirmado direto no source Java da versão clonada (`RuleEvaluator.java`/`SubjectContext.java`, tag `1.13.2-release`), não em documentação de terceiros — método já usado nos outros achados empíricos deste projeto.

**Implementado:**
- `evaluateCondition()` passou a reconhecer `isOwner()`, `hasAnyRole('R1','R2',...)`, `inAnyTeam('T1','T2',...)` e `hasDomain()`, além de `matchAnyTag('X')` e ausência de condition. `matchTeam()` é **reconhecida mas fica fail-closed de propósito** — depende de saber a qual Team a própria policy está *anexada* (`policyContext` no OMD real), um conceito que este adapter nunca modelou (busca Role→Policy→Rule direto por nome, não por atribuição a uma entidade). Documentado no código, não um bug silencioso.
- `resolveTeamHierarchy()` (novo, privado) sobe `team.parents` recursivamente a partir dos times diretos do usuário (`user.teams`), com proteção contra ciclo por `id` visitado — mesmo algoritmo do `SubjectContext.hasRole()`/`isUserUnderTeam()` real. Um único walk resolve, ao mesmo tempo: (a) roles herdadas via `team.defaultRoles` de qualquer time na hierarquia — usadas tanto pra *descobrir* quais policies checar quanto para `hasAnyRole()` responder por role indireta —, e (b) o conjunto de nomes de time "sob" os quais o usuário está, usado por `inAnyTeam()`.
- **Efeito real, não só de vocabulário:** antes, uma role concedida só via `team.defaultRoles` (sem atribuição direta ao usuário) nunca era nem *descoberta* — `hasPiiClearance()` só olhava `user.roles`. Agora a policy dessa role é examinada normalmente. Isto é o padrão mais comum de organização real (role fica no Team, não em cada pessoa) — antes saía sub-permissionado sem nenhum erro visível.
- `isOwner()`: dono direto (`owner.name === userId`) OU dono é um Team do qual o usuário é membro **direto** (sem subir hierarquia — o OMD real também não sobe aqui, confirmado no source).
- `hasDomain()`: sempre `true` neste ponto do fluxo — só é avaliada dentro de `hasPiiClearance()`, chamada depois que o gate de domínio de `getUserAccessLevel()` já rodou (se o usuário não tivesse acesso ao domínio do ativo, já teria retornado `'none'` antes de chegar aqui). Não reimplementa a hierarquia real de domínio do OMD (domínio pai acessa sub-domínio) — o gate deste app continua sendo slug exato, gap já documentado abaixo.
- 10 casos novos em `openmetadata.adapter.spec.ts` (16 no total): `isOwner()` direto/via-time/negativo, `hasAnyRole()` via time direto/via time-avô/proteção-contra-ciclo, `inAnyTeam()` positivo/negativo, `hasDomain()`, `matchTeam()` fail-closed documentado. 91 testes, 13 suites, tudo passando.

**Deliberadamente ainda fora de escopo** (não é o que foi pedido, evitar scope creep): reimplementar a hierarquia real de domínio (`hasDomains()` do OMD sobe FQN de domínio pai↔filho, nosso gate é slug exato); `matchTeam()` de verdade (exigiria modelar em qual entidade uma policy está atribuída); composição booleana de condições (`hasAnyRole('X') && matchAnyTag('Y')`) — cada condition string continua tendo que ser uma chamada de função única, não uma expressão.

#### Fase 4 — ✅ Motor proativo de qualidade de catálogo — feito

Implementadas as 5 regras do blueprint, com 2 correções de desenho feitas antes de codar (revisão do dono do projeto pegou os dois pontos antes de qualquer linha de código):

1. **`permission_drift` não vive no `CatalogProactiveService`.** A ideia original era comparar `CatalogAsset` local vs `adapter.listAssets()` fresco a cada 30min (TTL do cache de recomendação) — mas o `SyncService` já roda a cada 15min e reconcilia `CatalogAsset` com a fonte, então essa comparação sempre acharia "sem diferença" (mediria saúde do pipeline de sync, item 7, não drift de permissão). Corrigido: a detecção mora dentro do próprio `SyncService.syncOnce()`, no único momento em que "valor antigo vs valor novo" existe de verdade — antes do upsert sobrescrever a linha. Ao achar mudança de `domain` (prioridade `high`) ou `tags` (prioridade `medium`) num ativo que já existia, grava a `CatalogRecommendation` direto ali. `CatalogProactiveService.compute()` exclui `type: 'permission_drift'` do seu cleanup (`deleteMany`) pra não apagar o que o sync gravou — dois "donos" de tipos diferentes na mesma tabela, documentado em comentário.
2. **`flagged_unresolved` não podia usar update no `QueryAudit`.** `query-audit.service.ts` documenta "append-only por design, nenhum update/delete exposto" — `flag()`/`resolve()` são updates de verdade. Corrigido com uma tabela nova e separada, `QueryAuditFlag` (FK pra `QueryAudit`, `onDelete: Cascade`) — `QueryAudit` continua 100% imutável, mesmo padrão de `ReviewGate` já ser separado do que ele revisa.

Decisão adicional (não ambígua, só documentada): `CatalogAsset.sensitivity` tem `@default("internal")` (nunca null) e `syncedAt` é reescrito a cada sync — nenhum dos dois serve pra "sem classificação há N dias" como o blueprint descreve. Adicionado `firstSyncedAt` (setado só na criação, nunca no update) e `unclassified_asset` reinterpretado como "sem nenhuma tag" (não "sem sensitivity").

**Implementado:**
- `src/proactive/` (novo módulo) — `CatalogProactiveService` no mesmo *shape* do `ProactiveService` do Rayzen V1 (cache TTL 30min, `compute()` apaga não-descartadas e recria, `dismiss()`), com as 4 regras próprias (`unclassified_asset`, `orphan_owner`, `low_confidence_pattern`, `flagged_unresolved`) escritas do zero — confirmado no próprio blueprint que só a forma é reaproveitável. `low_confidence_pattern` agrega `QueryAudit` em JS, não SQL (Prisma não faz `GROUP BY` portável sobre array dentro de JSON `citedAssets` — dataset pequeno, sem custo real).
- `SyncService.syncOnce()` — seta `firstSyncedAt` só no create; `recordDriftIfAny()` compara `domain`/`tags` antes de cada upsert.
- `QueryAuditFlag` (model novo) + `QueryAuditService.flag()`/`resolveFlag()` + `AuditController` novo (`GET /query-audits`, `POST /query-audits/:id/flags`, `PATCH /query-audits/flags/:flagId/resolve` — `AuditModule` não tinha controller nenhum antes, `history()` existia no service mas nunca estava ligado a uma rota).
- `GET /proactive/recommendations`, `PATCH /proactive/recommendations/:id/dismiss`.
- Testes novos: `sync/__tests__/sync.service.spec.ts` (primeiro spec do `SyncService`, 4 casos de drift), `proactive/__tests__/catalog-proactive.service.spec.ts` (6 casos, incluindo "não gera `all_clear` quando há `permission_drift` ativo mesmo sem nenhuma regra própria disparar") e `audit/__tests__/query-audit.service.spec.ts` (primeiro spec do `QueryAuditService` — fechado numa revisão pós-implementação, o Guardian sinalizou `query-audit.service.ts` como sem spec depois que `flag()`/`resolveFlag()` entraram; o fake de `queryAudit` de propósito não expõe `update`, então o teste quebra se algum dia alguém tentar mutar o registro original em vez de criar uma `QueryAuditFlag`).

**Validado ao vivo** contra o Postgres do catalog-guardian (dados já sincronizados de sessão anterior, não precisou recriar o sandbox OMD — `permission_drift` não depende de API nova, só do `listAssets()` já usado, coberto pelo teste unitário com adapter fake): manipulação manual via SQL (backdatar `first_synced_at` de 1 ativo, inserir 1 `QueryAuditFlag` antigo) confirmou `unclassified_asset` (1), `orphan_owner` (9 de 10 ativos sem owner — achado real do próprio catálogo de teste, não simulado), `flagged_unresolved` (1) disparando corretamente, sem `all_clear` falso-positivo. `dismiss()` e `resolveFlag()` funcionam; confirmado que uma recomendação resolvida via flag só some do resultado no próximo ciclo de cache (30min) — comportamento herdado do padrão V1, não um bug.

#### Fase 5 — ✅ exportação de auditoria + relatório de maturidade — feito

O blueprint descrevia isto em 2 linhas ("QueryAudit exportável CSV/PDF" + "relatório de maturidade DAMA"), sem dimensões/formato definidos — precisou de desenho próprio (não confundir com `golden-dataset/gerar_planilha.py`, que revisa os 50 casos de TESTE do golden dataset, um dataset e propósito completamente diferente do histórico real de uso em produção).

**Decisões de escopo:**
- **CSV, não PDF, pro export de `QueryAudit`.** Formato padrão pra dado tabular; "PDF de uma lista de linhas" não agrega nada que o CSV não tenha.
- **Relatório de maturidade é um scorecard determinístico, sem LLM como árbitro** (mesmo princípio de `CatalogRiskScorerService`) — 6 dimensões 0-100 medidas direto do que o próprio app já acumula: Ownership (`CatalogAsset.owner`), Classificação (`tags` não vazio), Cobertura de linhagem (`CatalogLineageEdge`), Qualidade de resposta (`QueryAudit.riskLevel` + taxa de resolução de `QueryAuditFlag`), Saúde do processo de governança (`ReviewGate` decidido vs pendente), Débito de governança em aberto (`CatalogRecommendation` ativas, penalidade por prioridade). Score geral = média simples das 6, sem peso "cientificamente calibrado". A rotulagem de faixa (inicial/em desenvolvimento/gerenciado/otimizado) é **inspirada** nos knowledge areas do DAMA-DMBOK, não uma avaliação DAMA certificada — o relatório carrega um `disclaimer` explícito pra nunca ser confundido com um selo oficial (avaliação DAMA de verdade exige entrevista/auditoria humana, não é algo que se automatiza a partir de uma tabela `CatalogRecommendation`).
- **Formato do relatório: JSON + HTML simples, sem lib nova.** `GET /maturity/report` (JSON) e `GET /maturity/report.html` (HTML server-side com CSS inline) — o "PDF" vem do usuário apertando Imprimir → Salvar como PDF no navegador, evitando trazer Puppeteer/Chromium pro deploy do cliente só por causa deste artefato. `package.json` do app continua enxuto (NestJS/Prisma/Fastify/BullMQ, nada mais).

**Implementado:**
- `src/audit/csv.util.ts` — `toCsv()` genérico com escaping RFC4180 (aspas, vírgula, quebra de linha).
- `QueryAuditService.exportRows()` — inclui as `QueryAuditFlag` junto (join simples via `include`), filtrável por `userId`/período.
- `GET /query-audits/export.csv` (`AuditController`) — `Content-Disposition: attachment`, mesmo padrão de resposta de arquivo já usado em `apps/api/src/modules/evidence/evidence.controller.ts` (`@Res() reply: FastifyReply`).
- `src/maturity/` (novo módulo) — `CatalogMaturityService.computeReport()` roda as 6 queries (todas sobre models que já existiam, nenhuma migration nova) e retorna score + evidência bruta por dimensão, nunca só um número opaco. `GET /maturity/report` e `GET /maturity/report.html`.
- Testes novos: `audit/__tests__/csv.util.spec.ts` (6 casos de escaping) e `maturity/__tests__/catalog-maturity.service.spec.ts` (8 casos, incluindo catálogo vazio nunca gerar `NaN`/exceção — todas as dimensões defaultam pra 100 quando não há dado, documentado como "sem evidência de problema", não "sem problema confirmado").

**Validado ao vivo** contra o Postgres do catalog-guardian já povoado por sessões anteriores (não precisou subir o sandbox OMD): `GET /maturity/report` devolveu score geral 33 ("inicial") com números reais e coerentes com o que já sabíamos do catálogo de teste — Ownership 10 (1 de 10 ativos com owner), Classificação 20 (2 de 10 com tag), Cobertura de linhagem 50 (5 de 10 aparecem em `CatalogLineageEdge`), Qualidade de resposta 99 (168 consultas nos últimos 30 dias, só 4 de risco alto/crítico), Saúde do processo 0 (29 `ReviewGate` gerados, nenhum decidido — nunca chamei `/review-gates/:id/approve` nesta linha de trabalho), Débito de governança 20 (10 recomendações medium ativas, principalmente `orphan_owner`). `GET /query-audits/export.csv` gerou 179 linhas reais, incluindo uma com vírgula dentro do texto da flag corretamente escapada entre aspas. `GET /maturity/report.html` renderiza HTML válido com acentuação correta.

#### Fase 6 — ✅ segundo adapter (Unity Catalog OSS) — feito

**Escolha confirmada com o dono do projeto:** Unity Catalog OSS, não Dataplex — Dataplex é serviço gerenciado do GCP sem emulador local (exigiria conta/billing real); Unity Catalog OSS (`unitycatalog/unitycatalog`) tem servidor standalone que roda via `docker compose up -d`, sem custo nem conta cloud. **Profundidade confirmada:** smoke test ao vivo (não paridade completa com o golden dataset, não só unit tests mockados) — sobe o servidor real, cria um punhado de catalogs/schemas/tables de prova, confirma que o `CatalogAdapter` funciona contra o shape real da API.

**O que realmente prova a abstração:** `AdaptersModule` trocou o binding fixo de `CATALOG_ADAPTER` (`useExisting: OpenMetadataAdapter`) por uma `useFactory` condicionada à env var `CATALOG_SOURCE` (`openmetadata` default, `unity_catalog` opcional) — o cliente troca de catálogo fonte só editando `.env`, sem recompilar nada. `SyncService`, `PermissionGuardService`, `QueryService`, `CatalogProactiveService` e `CatalogMaturityService` não mudaram **nenhuma linha** — validado ao vivo rodando `pnpm sync:once` e `/query` reais contra o Unity Catalog, com o mesmo binário do app.

**Mapeamento de domínio:** Unity Catalog não tem "Domains" nativos como o OMD. Escopo original desta fase (Fase 6): **nome do catalog UC = domínio**. Backlog fechado numa sessão seguinte mudou isso para **nome do SCHEMA = domínio** (catalog virou namespace/ambiente) — ver README § Backlog "Domínio = catalog + KNOWN_DOMAINS hardcoded" para o racional completo (schema é a palavra que a pergunta em linguagem natural usa; catalog.schema composto não funcionaria com `extractDomainMention()`). PII é modelado via convenção de `properties` (`{"pii":"true"}` em tabela ou coluna) — UC não tem Tags/Classification como o OMD.

**2 limitações reais e documentadas da versão OSS (não são gaps do nosso adapter):**
- **Sem suporte a lineage** — feature request em aberto, [issue #137](https://github.com/unitycatalog/unitycatalog/issues/137) do próprio repo. `getLineage()` sempre retorna `[]`; `SyncService` já tolera isso (mesmo tratamento de quando `getLineage` do OMD falha pontualmente).
- **Sem conceito de glossário de negócio** — `listGlossaryTerms()` sempre retorna `[]`.

**Implementado:** `src/adapters/unitycatalog.adapter.ts` (`listAssets`, `getLineage`, `listGlossaryTerms`, `getUserAccessLevel`, `getDomainOwner`), `src/adapters/__tests__/unitycatalog.adapter.spec.ts` (8 casos, fetch mockado — mesmo padrão do `openmetadata.adapter.spec.ts`), `golden-dataset/seed_unitycatalog.py` (seed mínimo de smoke test, não o golden dataset completo).

**Validado ao vivo** contra `unitycatalog/unitycatalog:latest` (servidor OSS real via `docker compose up -d server`, sem UI): `listAssets()` sincronizou 7 tabelas reais (4 de amostra padrão da UC + 3 do seed), domínio mapeado corretamente pro nome do catalog, PII detectada via `properties` (`clientes` → `sensitivity: restricted`, `containsPII: true`, confirmado via `/catalog/assets`). Pipeline completo (`/query`) funcionando sem nenhuma mudança de código: pergunta de ownership sobre o domínio `vendas` respondeu honestamente "não há responsável definido" (owner é `null` neste ambiente sem auth — esperado, ver gotcha abaixo) sem quebrar nada; pergunta sobre um ativo sem grant de acesso foi corretamente excluída do contexto (mesmo comportamento de vazamento-zero já validado pro OMD).

**5 achados reais durante a validação** (typescript do adapter em si não teve bug nenhum — todos os achados foram na ferramentação de seed/CLI da UC):
1. `POST /tables` via REST puro exige um campo `type_json` por coluna sem exemplo documentado em lugar nenhum — duas tentativas plausíveis (`"bigint"`, depois `"long"` com serialização dupla) falharam contra o servidor real. Resolvido usando o CLI `uc` embutido no container (`docker exec ... bin/uc table create`), que monta esse payload internamente — o adapter em si só faz `GET`, nunca precisa criar nada.
2. UC sinaliza duplicata com **HTTP 400 + `error_code` estruturado** (`CATALOG_ALREADY_EXISTS`), não com HTTP 409 como o OMD — idempotência do seed script precisou checar o corpo do erro, não o status HTTP.
3. `EXTERNAL` table com `storage_location` tipo `s3://` fake tenta materializar um Delta table via credenciais AWS reais e quebra com NPE — trocado por `file:///tmp/...` dentro do próprio container, sem depender de nuvem nenhuma pro smoke test.
4. `DECIMAL` quebra o parser de colunas da CLI ("Unknown primitive type decimal") mesmo com precisão/escala explícita — troca pragmática por `DOUBLE` (não precisamos de decimal exato pra um smoke test).
5. **Causa raiz real encontrada numa sessão seguinte (2026-07-30) — não era bug da build, era comportamento intencional.** `uc permission create` aceita o principal e devolve exit 0, mas `uc permission get` logo depois nunca mostra o grant — tentado em 4 combinações nesta sessão (catalog+email, catalog maiúsculo, catalog+nome, table+email), nenhuma persistiu; na sessão seguinte, li o source Java real (`UnityCatalogServer.java`/`AllowingAuthorizer.java`) e confirmei: com `server.authorization=disable` (default de `server.properties`), o UC usa `AllowingAuthorizer` — um stub que autoriza tudo e nunca persiste grant nenhum, **por design** ("does not enforce any access control policies nor persist any data", Javadoc da própria classe). Não é instabilidade de feature nova, é o modo dev/simples do produto funcionando como documentado — habilitar grants reais exige `server.authorization=enable` + um provedor OIDC externo configurado, fora do escopo de um smoke test. Não bloqueia a prova da abstração: o caminho de leitura (`GET /permissions/...`) foi confirmado retornando exatamente o shape `{"privilege_assignments":[...]}` que o adapter espera — e essa sessão seguinte confirmou o shape de novo, desta vez contra a fonte mais autoritativa possível (`api/all.yaml`, spec OpenAPI oficial da mesma tag), não só a leitura vazia real. A lógica de decisão (`getUserAccessLevel`) está coberta por 3 casos unitários com esse shape mockado. O caminho **negativo** (sem grant → `'none'` → conteúdo corretamente excluído) foi validado ao vivo com sucesso — é o comportamento de segurança mais crítico dos dois.

### 7. ✅ Polimento operacional — feito (escopo ampliado)

Item original (4 pontos, todos baixo risco/sem dependência) mais uma auditoria pedida pelo dono do projeto ("detalhe o que ficou mascarado/perfumado pra funcionar") sobre as Fases 3-6 inteiras — o que era pequeno o suficiente entrou aqui, o resto virou § Backlog abaixo, explicitamente para não ficar mascarado.

**Escopo original:**
- `SyncProcessor` ganhou `@OnWorkerEvent('failed')` — job de sync que falha (catálogo fonte fora do ar, token expirado) agora loga erro explícito em vez de falhar silenciosamente até a próxima tentativa agendada.
- `SyncService.syncOnce()` deduplica a contagem de lineage edge no log — uma edge A→B aparecia tanto na consulta de A (downstream) quanto de B (upstream); o upsert no banco já era idempotente (correto), só o contador superestimava. Teste novo confirma 1 edge contada, não 2, quando a mesma edge aparece dos dois lados.
- `.dockerignore` adicionado — o `Dockerfile` já fazia `COPY` seletivo (não vazava segredo), isto só acelera o build context e blinda contra um futuro `COPY . .` desavisado.
- `pnpm test` raiz do monorepo continua só rodando `apps/api` — **movido pro Backlog**, não é escopo de um app isolado (toca `package.json` raiz, blast radius de todo o monorepo, merece decisão própria).

**Da auditoria, dobrado pra dentro do escopo (pequeno, contido, sem infra nova):**
- **`hasPiiClearance()` agora respeita `effect: 'deny'`** — antes só `allow` era considerado; uma policy real com um `deny` específico sobre um `allow` amplo (padrão comum de governança) era silenciosamente ignorada e o `allow` vencia sozinho. `deny` agora vence sempre, independente de quantas roles/policies o usuário tenha. Teste novo cobre o caso.
- **`CatalogMaturityService` não aparenta "otimizado" num catálogo vazio** — dimensão sem amostra (`sampleSize < 3`) agora carrega `insufficientData: true`; se **todas** as dimensões estiverem assim, a banda geral vira `"dados insuficientes"` em vez do score-default enganoso. HTML do relatório mostra "⚠ amostra insuficiente" ao lado da dimensão afetada.
- **`guardOne()` removido** do `PermissionGuardService` — código morto desde a Fase 2, nunca ligado a nenhuma rota (documentado como TODO desde então; a rota de ownership real usa `getOwnerOnly()`, não `guardOne()`).
- **`CatalogProactiveService.compute()` trocou blocklist por allowlist** — apagava tudo que NÃO estivesse numa lista de "tipos donos de outro serviço" (`TYPES_OWNED_BY_SYNC`, só `permission_drift`); um novo tipo escrito por outro serviço no futuro, se esquecido dessa lista, seria apagado silenciosamente a cada ciclo. Invertido para `TYPES_COMPUTED_HERE` (allowlist dos 5 tipos que este serviço realmente calcula) — qualquer tipo novo de outra origem fica protegido por padrão.
- **Convenção de PII do `UnityCatalogAdapter` documentada como bespoke** em `BLUEPRINT.md § Riscos` — `properties.pii == "true"` é nossa, não um padrão do produto; um cliente real de Unity Catalog precisaria adotar essa convenção explicitamente antes de confiar na detecção de PII.

## Backlog (auditado, não implementado nesta rodada — por quê)

Levantamento completo pedido pelo dono do projeto antes de fechar o item 7: tudo que funciona mas tem uma simplificação, decisão adiada ou gap real por baixo, e que **não** coube no escopo "pequeno e contido" acima. Cada item aqui merece sua própria sessão, não um fold-in de última hora.

**Segurança:**
- ✅ **Autenticação em endpoints — feito.** `ApiKeyGuard` global (`src/auth/`), 1 chave via `Authorization: Bearer` (env `CATALOG_GUARDIAN_API_KEY`), mesmo padrão do `AgentTokenGuard` de `apps/api` (Bearer estático, `timingSafeEqual`, fail-closed se a env var não estiver setada). Único endpoint público: `GET /ping` (health check, via `@Public()`). Decisão explícita: 1 chave única pra tudo, não 2 níveis (read vs steward) — o app ainda não tem conceito de identidade de operador diferenciado, só o `userId`/`profile` de negócio que já é outro problema (ver item abaixo). Reabrir pra 2 níveis se um cliente real precisar diferenciar quem pode aprovar gate/exportar CSV de quem só consulta.
- ✅ **Identidade do usuário de negócio em `/query` — feito (2026-07-30).** `userId` não vem mais do body (o chamador podia alegar ser qualquer um). `IdentityGuard` (`src/auth/`) exige `X-Identity-Token: <JWT>`, verificado via `@nestjs/jwt` (`JwtModule.registerAsync`, mesmo padrão fail-fast-no-boot do `AuthModule` de `apps/api` — sem `CATALOG_GUARDIAN_IDENTITY_JWT_SECRET`, o servidor se recusa a subir) e extrai o `userId` verificado do claim `sub`. **Quem assina o JWT é o backend do cliente** (que já autentica o usuário final no próprio login) — este servidor só verifica, nunca emite. `profile` continua vindo do body (metadado de auditoria, não gate nada, ok ser auto-declarado). `avaliador.py` assina o JWT à mão com a stdlib (`hmac`/`hashlib`/`base64`, HS256) — zero dependência nova, mesmo princípio de todo o resto do script. 6 casos novos em `identity.guard.spec.ts` (válido, header ausente, secret errado, expirado, sem claim `sub`, malformado). 97 testes, 14 suites.

**Identidade (item 5 — Role/Policy do OMD):**
- ✅ **`evaluateCondition()` + herança via `team.defaultRoles` — feito** (ver "Backlog Identidade" na seção do item 5 acima). `isOwner()`, `hasAnyRole()`, `inAnyTeam()`, `hasDomain()` reconhecidas de verdade; `matchTeam()` reconhecida mas fail-closed de propósito (precisa de contexto de anexação de policy não modelado). Roles herdadas via time agora entram na descoberta de policy, não só nas condições.

**Segundo adapter (Fase 6 — Unity Catalog):**
- ✅ **Caminho positivo de permissão — causa raiz real encontrada (2026-07-30), não é mais "bug bloqueado".** O grant nunca persistindo (documentado no item 6 como bug da CLI/build v0.5.0) na verdade é comportamento **intencional** do produto: com `server.authorization=disable` (default de `server.properties`, confirmado no container real), o UC usa `AllowingAuthorizer` — um stub que autoriza tudo pra todo mundo e **nunca persiste nem lê grant nenhum** (`grantAuthorization()`/`listAuthorizations()` retornam sempre vazio, por design, ver Javadoc da classe: "does not enforce any access control policies nor persist any data"). Confirmado lendo o source Java real (`UnityCatalogServer.java`/`AllowingAuthorizer.java`, tag `v0.5.1`, mesmo método já usado nos outros achados deste projeto — nenhuma build futura vai "consertar" isso, porque não é um bug. Pra grants reais persistirem, `server.authorization=enable` é obrigatório, e isso por sua vez exige um provedor OIDC externo de verdade configurado (`allowed-issuers`/`audiences`/client-id/secret) — fora do escopo de um smoke test. **O shape que o adapter assume está correto**, confirmado contra a fonte mais autoritativa possível: `api/all.yaml` (spec OpenAPI oficial da mesma tag) define `PermissionsList.privilege_assignments: [PrivilegeAssignment]` e `PrivilegeAssignment { principal: string, privileges: [Privilege] }` — bate exatamente com `UcPermissionsResponse`/`UcPrivilegeAssignment` no adapter e com os 3 testes que já cobrem esse shape (`getUserAccessLevel` — direto na tabela, herdado do catalog, sem privilege nenhum). Decisão: **não** subir um IdP OIDC real só pra reconfirmar um shape já garantido pela spec — esforço desproporcional ao ganho.
- ✅ **Domínio = catalog + `KNOWN_DOMAINS` hardcoded — os dois fechados juntos (2026-07-30), porque eram o mesmo problema por dois ângulos.** Investigando o primeiro, achei o acoplamento real: mudar domínio pra granularidade `catalog.schema` (composto) quebraria `extractDomainMention()` — ninguém diz "vendas.public" numa frase, a função casa palavra solta contra a pergunta em linguagem natural. A saída certa: **domínio virou o nome do SCHEMA sozinho**, não do catalog — catalog passou a ser puro namespace/ambiente (ex. `"empresa"`), e cada schema dentro dele (`"vendas"`, `"financeiro"`) é o domínio de negócio de verdade, exatamente a palavra que a pergunta natural usa. Isso só funciona se `KNOWN_DOMAINS` também parar de ser um const fixo — daí o novo método `CatalogAdapter.listDomains(): Promise<string[]>` no contrato, implementado nos dois adapters (`OpenMetadataAdapter` via `GET /v1/domains`; `UnityCatalogAdapter` enumerando schemas de todos os catalogs, dedupado) e conectado em `QueryService.askOwnership()` no lugar do hardcode — `KNOWN_DOMAINS` sobrevive só como fallback se `listDomains()` falhar (rede instável), não mais fonte de verdade. `UnityCatalogAdapter.getDomainOwner(domain)` agora busca o schema certo percorrendo os catalogs (schema.owner, confirmado no `api/all.yaml` oficial) em vez de ler `catalog.owner`. `seed_unitycatalog.py` remodelado: 1 catalog (`empresa`) com 2 schemas-domínio (`vendas`, `financeiro`) em vez de 1 catalog por domínio com schema `public` fixo — o cenário antigo nunca provava dois domínios coexistindo no mesmo catalog, exatamente o que o backlog apontava como frágil. 8 testes novos entre os dois adapters. **Validado ao vivo contra UC real**: sincronizei o catalog `empresa` e confirmei `domain: 'vendas'`/`domain: 'financeiro'` para tabelas dentro do MESMO catalog (a prova direta do fix) — e uma pergunta sobre o domínio `"default"` (schema de amostra que já vem embutido na UC, nunca esteve no `KNOWN_DOMAINS` hardcoded) resolveu corretamente via `/query`, provando que `listDomains()` está de fato ligado, não o fallback.

**Ownership/glossário (itens 3-4):**
- Citação de domínio em `askOwnership()` fica fora do cálculo de fundamentação de `avaliador.py` — estendê-lo pra contar isso sem reintroduzir falso-positivo de vazamento (domínio sem `dominios_permitidos` do perfil) é mais delicado do que parece; já analisado uma vez e adiado de propósito.
- ✅ **Busca substring → semântica — feito (2026-07-30).** Escolhido o caminho "de verdade" (embeddings), não o mais barato (glossário/sinônimos estruturado) — resolve o caso geral de descrição mal escrita, não só nomenclatura alternativa conhecida. Postgres isolado do catalog-guardian trocou de imagem (`postgres:16` → `pgvector/pgvector:pg16`, mesma já usada no Postgres principal do Rayzen); `CatalogAsset`/`CatalogGlossaryTerm` ganharam coluna `embedding vector(1024)` (`Unsupported()` no Prisma — leitura/escrita via `$queryRaw`/`$executeRawUnsafe`, Prisma Client não gera CRUD tipado pra pgvector). `EmbeddingService` novo (`src/embedding/`) chama a Jina API direto (`jina-embeddings-v3`, 1024 dim) — mesmo padrão de `apps/api/src/modules/memory/memory.service.ts`, replicado como código próprio (app isolado, sem import cross-app); **não** é a regra "sempre via LiteLLM" (essa é só pra chat completion, embedding é assim em todo o Rayzen). `SyncService` calcula embedding só quando o ativo é novo, quando nome/descrição mudou, ou (self-heal) quando a linha ainda não tinha embedding de antes desta migration — evita recomputar em todo sync de 15min. `QueryService.findRelevantAssets()`/`findRelevantGlossaryTerms()` embeddam a pergunta e buscam por distância de cosseno (`embedding <=> ...`) em vez de casar palavra solta; abaixo de um limiar de similaridade (`0.5`, fixo, validado manualmente ao vivo — golden dataset completo continua bloqueado pela quota Groq/Anthropic) o candidato é tratado como "não relevante", mesma semântica de zero hits do substring. **Falha na Jina (ou banco sem a extensão) cai pro substring como fallback** — código antigo preservado como `findRelevantAssetsBySubstring()`/`findRelevantGlossaryTermsBySubstring()`, não removido. Limiar extraído pra `embedding-match.util.ts` (`aboveThreshold()`) só pra ficar testável sem mockar `$queryRaw`/Jina, mesmo princípio de `substring-match.util.ts`. 10 testes novos (`EmbeddingService`, 5 casos de `SyncService` cobrindo os 3 gatilhos + falha da Jina não quebra o sync, `aboveThreshold`). **Validado ao vivo com prova direta do ganho semântico**: inseri um ativo `cadastro_compradores` ("Base de pessoas que efetuam aquisições em nosso site") e perguntei "quem é o responsável pelos registros de clientes que compraram produtos?" — **zero palavras em comum** entre pergunta e nome/descrição do ativo (de propósito). Score de similaridade real: `0.72` pro ativo certo, `0.32` pra um ativo de controle deliberadamente irrelevante (abaixo do limiar, corretamente excluído) — e a resposta da API citou exatamente o ativo certo (`svc.db.schema.cadastro_compradores`), coisa que o substring nunca teria achado.

**Motor proativo (Fase 4):**
- ✅ **`dismiss()` não-sticky — feito (2026-07-30).** Antes, `compute()` apagava todas as recomendações ativas e recriava do zero a cada ciclo (30min) — a linha nova tinha um `id` novo, nunca dismissado, então `dismiss()` só suprimia até o próximo `compute()`. Corrigido com `CatalogRecommendation.dedupeKey` (novo campo, `@unique`, ex. `"orphan_owner:svc.db.schema.clientes"` — `flagged_unresolved` usa o id da própria `QueryAuditFlag`, não o do ativo, já que várias flags podem mirar o mesmo ativo) e `compute()` reescrito pra fazer **upsert** por `dedupeKey` em vez de `deleteMany`+`createMany`: se a recomendação já existia, atualiza conteúdo (título/descrição podem mudar, ex. contagem de dias) **sem tocar `dismissedAt`** — é isto que corrige o bug. Quando a condição deixa de valer (ex. ativo ganhou owner), a linha é removida de vez, dismissada ou não — dismissal não é eterno, só sobrevive enquanto o mesmo problema específico continuar existindo. `permission_drift` (escrito pelo `SyncService`, fora do `compute()`) fica de fora deste mecanismo de propósito, como já era. 4 casos novos em `catalog-proactive.service.spec.ts` (10 no total): dismiss sobrevive a um recompute com a mesma condição, recomendação some de vez quando a condição resolve, duas recomendações do mesmo tipo em ativos diferentes não colidem, `all_clear` dismissado não sobrevive quando surge um problema real. **Validado ao vivo** contra Postgres real: inseri um ativo sem owner, dispensei a recomendação via API, forcei o ciclo de 30min expirar direto no banco (`UPDATE ... computed_at = now() - interval '40 minutes'`), confirmei que ela NÃO reaparece (a linha sobrevive com o mesmo `id`/`dismissed_at`) — e depois, dando um owner ao ativo e forçando outro ciclo, confirmei que a linha some de vez do banco.

**Tooling do monorepo:**
- `pnpm test` raiz continua só rodando `apps/api` — mexe em `package.json` da raiz, fora do escopo de um app isolado; decisão pra quando alguém for mexer no pipeline de CI do monorepo como um todo.

## Ambiente de validação

O sandbox OpenMetadata e o stack próprio do app foram **derrubados** de novo ao fim de cada rodada de validação (`docker compose down` nos dois lugares) — não há nada rodando para reconectar. Para retomar, seguir "Setup local" acima do zero — agora com `seed_sandbox.py` fazendo o trabalho pesado do catálogo em segundos.
