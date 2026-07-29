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
├── prisma/schema.prisma      # CatalogAsset, CatalogGlossaryTerm, CatalogLineageEdge, QueryAudit, ReviewGate, CatalogRecommendation
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

Cobertura atual: `CatalogRiskScorerService`, `PermissionGuardService` (mesmo padrão de `apps/api-v2/src/guardian/__tests__/`), `ownership-question.util.ts` e `substring-match.util.ts`.

## Roadmap (ordem recomendada de ataque)

A ordem abaixo não é por número de fase do blueprint — é por dependência real: cada item destrava o próximo, ou evita retrabalho se feito fora de ordem.

### 1. ✅ Seed do sandbox como script — feito

`golden-dataset/seed_sandbox.py` substitui os `curl` manuais desta validação — usa `PUT` (create-or-update nativo do OMD) pra ser idempotente, validado rodando duas vezes seguidas contra o mesmo sandbox sem erro nem duplicação. Ver "Setup local" § 3 acima.

**Achado colateral ao revalidar:** rodar o conjunto completo do golden dataset múltiplas vezes no mesmo dia esgotou a quota diária do Groq (100k tokens TPD, compartilhada com o resto do Rayzen) — o fallback pro Anthropic também falhou por falta de crédito. É uma restrição externa de provider (ver `docs/architecture.md` § Riscos conhecidos), não algo pra "consertar" aqui; só planejar validações completas com essa quota em mente.

### 2. ✅ Catálogo de teste mais rico — seed feito, validação por LLM bloqueada por quota externa

`seed_sandbox.py` cresceu de 5 para **10 tabelas** (+ `produtos`, `cadastro_fornecedores`, `acordos_comerciais`, `clientes_cancelamentos`, `contas_a_receber`), ganhou um **glossário** (`termos_de_negocio`, 7 termos: `venda_bruta`, `pmr`, `cliente_ativo`/`cliente_vigente`, `cliente`/`consumidor`, `churn`), **owners** (`pedidos` → `steward`; domínio `financeiro` → usuário `financeiro`; domínio `rh` → usuário `rh`), uma tag `Tier.Tier1` em `clientes`, e **lineage multi-hop** (`produtos → estoque → pedidos`, `contas_a_receber → fin_faturamento_mensal`). Mapeamento completo caso-a-caso nos comentários do próprio script. Casos de `PROCESSO` (`PRO-001..004`) ficaram de fora de propósito — são perguntas de política institucional, não metadado de catálogo.

Validado **sem custo de LLM**: 10 tabelas sincronizadas, owners corretos em `pedidos`/`financeiro`/`rh` confirmados via API direta do OMD, lineage `produtos→estoque→pedidos` traçado corretamente em 2 hops, script rodado duas vezes seguidas sem duplicar nada.

**Bloqueado:** rodar o golden dataset de novo pra medir o ganho real de acurácia — a quota diária do Groq (100k tokens TPD) **continuava esgotada** no dia seguinte à primeira validação (99935/100000 usados, mesma organização compartilhada com o resto do Rayzen), e o fallback Anthropic segue sem crédito. Duas sessões seguidas bateram nessa parede. **Ação recomendada para o dono do projeto:** colocar crédito na conta Anthropic usada pelo fallback do LiteLLM (`infra/litellm/config.yaml`) — sem isso, qualquer pico de uso do Groq (não só deste app) derruba toda chamada de LLM do Rayzen sem rede de segurança. Depois de resolvido, rodar `avaliador.py --apenas-criticos` (13 casos, mais barato) contra este catálogo pra medir o ganho real antes do conjunto completo.

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
- `OpenMetadataAdapter.getUserAccessLevel()` resolve `user.roles` (só atribuição direta — herança via `team.defaultRoles` fica fora de propósito, nenhum persona do golden dataset depende disso) → `role.policies` → `policy.rules`, e concede `'full'` num ativo PII só se existir uma rule `allow` com `operations` incluindo `ViewAll` e a `condition` batendo. Só roda quando o ativo já é PII — ativo não-PII continua sem nenhuma chamada extra.
- `evaluateCondition()` reconhece deliberadamente só `matchAnyTag('X')` e ausência de condition — qualquer outra sintaxe é **fail-closed** (nunca concede clearance), com log de warning. Não é um parser genérico de SpEL.
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

### 6. Fases 4-6 do blueprint (nessa ordem)

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

#### Fase 5 — exportação de auditoria + relatório de maturidade DAMA

Depende de já ter rodado validações reais o suficiente pra ter dado histórico.

#### Fase 6 — segundo adapter (Unity Catalog ou Dataplex)

Prova que a abstração não é lock-in — só compensa depois do adapter OpenMetadata estar maduro (itens 1-5, já feito), senão duplica retrabalho de shape de API duas vezes.

### 7. Polimento operacional (qualquer momento, baixo risco, sem dependência)

- `SyncProcessor` sem listener de falha do BullMQ (`worker.on('failed', ...)`) — job falho fica silencioso, sem log visível.
- `SyncService.syncOnce()` conta a mesma lineage edge duas vezes no log quando descoberta dos dois lados — upsert no banco é idempotente (correto), só o contador do log superestima.
- Sem `.dockerignore` explícito — o `Dockerfile` já faz `COPY` seletivo, então não vaza segredo, mas seria mais à prova de futuro.
- `pnpm test` na raiz do monorepo só roda `apps/api` (script fixo, não glob) — os testes do Catalog Guardian rodam via `pnpm --filter catalog-guardian test`. Mesmo padrão já existia para `api-v2`, não é regressão nova.

## Ambiente de validação

O sandbox OpenMetadata e o stack próprio do app foram **derrubados** de novo ao fim de cada rodada de validação (`docker compose down` nos dois lugares) — não há nada rodando para reconectar. Para retomar, seguir "Setup local" acima do zero — agora com `seed_sandbox.py` fazendo o trabalho pesado do catálogo em segundos.
