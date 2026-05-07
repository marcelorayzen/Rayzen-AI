# Rayzen AI — Expansão QA + Governança de Dados

Extensão do roadmap principal (Fases 1–14 concluídas).
Foco: integrar o Rayzen AI com o ciclo de QA Automation e Governança de Dados.

**Origem:** Marcelo tem background em QA Automation (Selenium, TestNG, Cucumber) e atuação
em time de governança de dados — combinação rara que posiciona o Rayzen AI num espaço
sem ferramenta equivalente no mercado para times pequenos e profissionais independentes.

**Princípio desta expansão:** construir sobre o que já existe.
O agente já executa testes. A memória semântica já indexa. Os eventos já rastreiam.
Cada fase fecha um loop que o sistema quase fecha sozinho.

---

## Infraestrutura existente que será reutilizada

| O que existe | Onde | Como será usado |
|---|---|---|
| `jarvis:run_tests` | `apps/agent/src/actions/run-tests.ts` | Base para capturar resultados |
| `jarvis:inspect_schema` | `apps/agent/src/actions/inspect-schema.ts` | Base para rastrear mudanças |
| `MemoryService.indexDocument()` | `apps/api/src/modules/memory/` | Indexar relatórios e regras |
| `EventService.create()` | `apps/api/src/modules/event/` | Registrar execuções e alertas |
| `DocumentationService` | `apps/api/src/modules/documentation/` | Gerar artefatos de governança |
| `POST /events/cli` | hook → API | Capturar runs externos (CI/CD) |
| pgvector + Jina AI | banco + memória | Busca semântica em relatórios |

**Regra:** nenhuma fase modifica o comportamento existente. Só adiciona.

---

## Camada 1 — QA Tracking

**Objetivo:** fechar o loop entre execução de testes e memória do projeto.
Hoje o agente executa testes mas o resultado some. Esta camada indexa, rastreia e
torna o histórico de execuções consultável em linguagem natural.

---

### 1.1 — Parser de relatórios de teste ✅

**O que é:**
Lê relatórios JUnit XML e Allure JSON gerados por Selenium, TestNG, Playwright, Jest
e extrai estrutura consultável: suítes, casos, status, duração, stacktrace de falha.

**O que construir:**

```
apps/agent/src/actions/parse-test-report.ts   — nova action
apps/api/src/modules/qa/                       — novo módulo
  qa.module.ts
  qa.controller.ts     (POST /qa/reports, GET /qa/reports)
  qa.service.ts        (parseJUnit, parseAllure, indexReport)
prisma/schema.prisma   — novo model TestRun
```

**Model TestRun:**
```prisma
model TestRun {
  id          String   @id @default(uuid())
  projectId   String?
  tool        String   // selenium | playwright | jest | testng | cucumber
  branch      String?
  commitHash  String?
  totalTests  Int
  passed      Int
  failed      Int
  skipped     Int
  durationMs  Int
  suites      Json     // array de suítes com casos
  failedCases Json     // array de falhas com stacktrace
  source      String   // agent | ci | manual
  executedAt  DateTime @default(now())
}
```

**Action do agente:** `jarvis:parse_test_report`
```typescript
// input: { reportPath: string, tool: 'junit' | 'allure' | 'auto' }
// output: { totalTests, passed, failed, skipped, failedCases[] }
// salva via POST /qa/reports
// indexa falhas no pgvector para busca semântica
```

**Whitelist:** adicionar `jarvis:parse_test_report` em `security/whitelist.ts`

**Não mexer em:** `run-tests.ts` existente — só adicionar chamada ao parser após execução

**Critério de done:**
> Peço "roda os testes do rayzen-pdv e analisa os resultados".
> O agente executa, lê o XML gerado e respondo: "37 testes — 35 passaram, 2 falharam.
> Falha em `PedidoService.calcularTotal`: NullPointerException linha 142."

---

### 1.2 — Histórico e padrões de falha ✅

**O que é:**
Com runs acumulados, o sistema detecta testes flaky, módulos com regressão frequente
e tendência de qualidade ao longo do tempo.

**O que construir:**

```
apps/api/src/modules/qa/qa.service.ts    — métodos de análise
  getFailurePatterns(projectId)
  getFlakyTests(projectId, lastNRuns)
  getQualityTrend(projectId, days)
apps/api/src/modules/qa/qa.controller.ts
  GET /qa/reports?project_id=&limit=
  GET /qa/patterns?project_id=
  GET /qa/trend?project_id=&days=30
```

**Integração com orquestrador:**
Adicionar exemplos no classify prompt:
- *"quais testes estão falhando mais esta semana?"* → `jarvis` → `get_test_patterns`
- *"tem teste flaky no projeto?"* → `jarvis` → `get_flaky_tests`

**Não mexer em:** módulos existentes de memória, event, synthesis

**Critério de done:**
> Após 5 runs acumulados, pergunto "quais testes falharam mais esta semana?".
> Resposta: "O teste `checkout_integration` falhou em 3 dos 5 runs. Stacktrace mais comum: timeout na linha 89."

---

### 1.3 — Integração com CI/CD externo ✅

**O que é:**
Recebe relatórios de pipelines GitHub Actions, GitLab CI ou Jenkins via webhook,
sem precisar do agente local.

**O que construir:**

```
apps/api/src/modules/qa/qa.controller.ts
  POST /qa/reports/ingest    — endpoint público com token de projeto
```

**Payload esperado:**
```json
{
  "projectToken": "token-do-projeto",
  "tool": "jest",
  "branch": "main",
  "commitHash": "abc123",
  "reportBase64": "<JUnit XML em base64>"
}
```

**Exemplo de uso no GitHub Actions:**
```yaml
- name: Send report to Rayzen AI
  run: |
    curl -X POST https://<ngrok>/qa/reports/ingest \
      -H "Content-Type: application/json" \
      -d "{\"projectToken\":\"...\",\"tool\":\"jest\",\"reportBase64\":\"$(base64 report.xml)\"}"
```

**Critério de done:**
> Pipeline do GitHub Actions termina. Sem abrir o VSCode, o painel do Rayzen AI
> mostra o resultado do run com branch, commit e falhas.

---

## Camada 2 — Data Quality Monitoring

**Objetivo:** rastrear a qualidade dos dados ao longo do tempo.
Background em governança aplicado diretamente — saber quando um dado começou a
degradar antes de virar bug silencioso na produção.

---

### 2.1 — Regras de qualidade e contrato de dados ✅

**O que é:**
O usuário define regras de qualidade para datasets/tabelas. O sistema valida e
registra o resultado de cada verificação como evento.

**O que construir:**

```
apps/api/src/modules/data-quality/
  data-quality.module.ts
  data-quality.controller.ts
  data-quality.service.ts
prisma/schema.prisma   — DataQualityRule, DataQualityResult
```

**Model DataQualityRule:**
```prisma
model DataQualityRule {
  id          String   @id @default(uuid())
  projectId   String?
  dataset     String   // nome da tabela ou fonte
  field       String?  // campo específico (null = regra de tabela)
  ruleType    String   // not_null | unique | range | regex | custom | freshness
  definition  Json     // parâmetros da regra
  severity    String   // critical | warning | info
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  results     DataQualityResult[]
}

model DataQualityResult {
  id         String   @id @default(uuid())
  ruleId     String
  rule       DataQualityRule @relation(fields: [ruleId], references: [id])
  passed     Boolean
  score      Float    // 0.0 a 1.0
  detail     Json?    // exemplos de registros que falharam
  checkedAt  DateTime @default(now())
}
```

**Rotas:**
```
POST /data-quality/rules          — criar regra
GET  /data-quality/rules          — listar por projeto
POST /data-quality/rules/:id/run  — executar uma regra agora
GET  /data-quality/results        — histórico de resultados
```

**Critério de done:**
> Defino: "campo `email` na tabela `clientes` não pode ser nulo".
> Peço "verifica qualidade da tabela clientes". O agente roda a query,
> retorna: "2.3% dos registros têm email nulo — 14 registros."

---

### 2.2 — Alertas em mudanças de schema ✅

**O que é:**
Toda vez que uma migration Prisma é aplicada, o sistema verifica quais regras de
qualidade e documentos de governança são impactados e emite alerta.

**O que construir:**

```
apps/agent/src/actions/inspect-schema.ts   — estender (não reescrever)
  detectSchemaChanges(previousSnapshot, currentSchema)

apps/api/src/modules/data-quality/data-quality.service.ts
  checkRulesImpactedBySchemaChange(changes)
  emitSchemaChangeAlert(projectId, changes, impactedRules)
```

**Fluxo:**
```
Migration aplicada (git commit detectado pelo hook)
        ↓
jarvis:inspect_schema roda automaticamente
        ↓
Compara com snapshot anterior (salvo no banco)
        ↓
Se mudou: POST /events com type='schema_change'
        ↓
data-quality.service verifica regras afetadas
        ↓
Emite alerta: "3 regras de qualidade impactadas por essa migration"
```

**Não mexer em:** `inspect-schema.ts` existente — só adicionar diff após leitura

**Critério de done:**
> Faço uma migration que remove o campo `cpf` da tabela `clientes`.
> O Rayzen AI alerta: "2 regras de qualidade referenciam este campo.
> Revise: `cpf_not_null`, `cpf_format_regex`."

---

### 2.3 — Score de qualidade por dataset ✅

**O que é:**
Agrega os resultados das regras em um score 0–100 por dataset, com histórico.
Análogo ao health score do projeto, mas para dados.

**O que construir:**

```
apps/api/src/modules/data-quality/data-quality.service.ts
  computeDatasetScore(projectId, dataset)
  — média ponderada por severity: critical peso 3, warning peso 2, info peso 1

apps/api/src/modules/data-quality/data-quality.controller.ts
  GET /data-quality/score?project_id=&dataset=
  GET /data-quality/score/history?project_id=&dataset=&days=30
```

**Integração com orquestrador:**
- *"como está a qualidade dos dados do projeto?"* → retorna score por dataset
- *"quando o score de clientes começou a cair?"* → histórico com contexto

**Critério de done:**
> O painel mostra: `clientes: 87/100`, `pedidos: 62/100`.
> Pergunto "por que pedidos está baixo?" — resposta: "3 regras falhando:
> `valor_not_null` (critical, 4.1% de falha) e 2 warnings."

---

## Camada 3 — Governança Conversacional

**Objetivo:** catálogo de dados, linhagem e artefatos de compliance acessíveis
por linguagem natural. Governança leve para times pequenos que não têm budget
para Collibra ou Alation mas têm os mesmos problemas de rastreabilidade e LGPD.

---

### 3.1 — Catálogo de dados conversacional ✅

**O que é:**
Base de conhecimento sobre datasets: o que são, quem é responsável, de onde vêm,
para que servem. Consultável pelo chat sem precisar de ferramenta dedicada.

**O que construir:**

```
apps/api/src/modules/data-catalog/
  data-catalog.module.ts
  data-catalog.controller.ts
  data-catalog.service.ts
prisma/schema.prisma   — DataAsset
```

**Model DataAsset:**
```prisma
model DataAsset {
  id           String   @id @default(uuid())
  projectId    String?
  name         String   // nome da tabela, API, arquivo, tópico Kafka
  type         String   // table | api | file | stream | external
  description  String?
  owner        String?  // nome ou email do responsável
  sensitivity  String   // public | internal | confidential | restricted
  containsPII  Boolean  @default(false)
  piiFields    Json?    // quais campos têm dados pessoais
  source       String?  // de onde vem: sistema, time, fornecedor
  consumers    Json?    // quem consome: sistemas, times
  updateFreq   String?  // real-time | daily | weekly | manual
  notes        String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**Indexação semântica:** ao criar/atualizar um DataAsset, indexa no pgvector
automaticamente — busca semântica pelo chat.

**Integração com orquestrador:**
- *"quem é responsável pelos dados de CPF?"* → brain → busca semântica no catálogo
- *"quais tabelas têm dados pessoais?"* → brain → filtra `containsPII: true`
- *"de onde vêm os dados de pedidos?"* → brain → retorna `source` + `consumers`

**Critério de done:**
> Cadastro a tabela `clientes` com `containsPII: true`, `owner: "time-core"`,
> `sensitivity: "confidential"`. Pergunto no chat: "quais dados são confidenciais?"
> — resposta lista `clientes` com detalhes sem eu abrir nenhuma tela de catálogo.

---

### 3.2 — Linhagem de dados simples ✅

**O que é:**
Mapa de onde cada dado vem e para onde vai. Não precisa ser um grafo sofisticado —
só precisa responder "quem depende de X?" e "de onde veio Y?" de forma confiável.

**Padrão usado:** OpenLineage (open source, interoperável com dbt, Airflow, Spark)

**O que construir:**

```
apps/api/src/modules/data-catalog/data-catalog.controller.ts
  POST /data-catalog/lineage          — registrar relação A → B
  GET  /data-catalog/lineage/:assetId — quem alimenta e quem consome
  GET  /data-catalog/lineage/impact/:assetId — impacto se X mudar

apps/api/src/modules/data-catalog/data-catalog.service.ts
  addLineageEdge(sourceId, targetId, transformation?)
  getUpstream(assetId)    — de onde vem
  getDownstream(assetId)  — quem depende
  getImpact(assetId)      — cascata de impacto
```

**Integração com schema change (Camada 2.2):**
Quando migration detectada → verifica downstream do asset afetado →
alerta: "4 pipelines dependem desta tabela."

**Integração com orquestrador:**
- *"se eu mudar a tabela de produtos, o que quebra?"* → retorna downstream
- *"de onde vem o campo valor_total nos pedidos?"* → retorna upstream + transformação

**Critério de done:**
> Registro: `orders_raw → (ETL) → orders_enriched → (report) → dashboard_vendas`.
> Pergunto: "se a tabela orders_raw mudar, o que é impactado?"
> Resposta: `orders_enriched` e `dashboard_vendas` com o caminho explicado.

---

### 3.3 — Artefatos de compliance (LGPD) ✅

**O que é:**
Geração automática de documentos de compliance a partir do catálogo e das regras
de qualidade. ROPA (Record of Processing Activities), mapeamento de dados pessoais
e relatório de qualidade — prontos para auditorias ou revisão de DPO.

**O que construir:**

```
apps/api/src/modules/documentation/documentation.service.ts
  — estender com novos tipos de documento (não reescrever)
  generateDataMap(projectId)        — mapeamento de dados pessoais
  generateROPA(projectId)           — registro de atividades de tratamento
  generateQualityReport(projectId)  — relatório consolidado de qualidade

apps/api/src/modules/documentation/documentation.controller.ts
  POST /documentation/generate/:projectId/data_map
  POST /documentation/generate/:projectId/ropa
  POST /documentation/generate/:projectId/quality_report
```

**Fontes usadas na geração:**
- `DataAsset` onde `containsPII: true`
- `DataQualityRule` e últimos `DataQualityResult`
- `ProjectState` para contexto do sistema
- `Event` com `type: 'schema_change'` recentes

**Critério de done:**
> Clico "Gerar mapeamento LGPD".
> Documento gerado lista: quais tabelas têm PII, quais campos, quem é responsável,
> qual a base legal declarada e o score de qualidade atual desses dados.
> Documento exportável em PDF.

---

## Status das camadas

| Fase | Descrição | Status |
|---|---|---|
| **1.1** | Parser de relatórios JUnit/Allure | ✅ Concluído |
| **1.2** | Histórico e padrões de falha | ✅ Concluído |
| **1.3** | Integração CI/CD (webhook) | ✅ Concluído |
| **2.1** | Regras de qualidade e contratos | ✅ Concluído |
| **2.2** | Alertas em mudanças de schema | ✅ Concluído |
| **2.3** | Score de qualidade por dataset | ✅ Concluído |
| **3.1** | Catálogo de dados conversacional | ✅ Concluído |
| **3.2** | Linhagem de dados simples | ✅ Concluído |
| **3.3** | Artefatos de compliance (LGPD) | ✅ Concluído |

---

## Ordem de implementação sugerida

```
1.1 → 1.2 → 2.1 → 2.2 → 2.3 → 1.3 → 3.1 → 3.2 → 3.3
```

**Por quê esta ordem:**
- 1.1 e 1.2 são as mais rápidas — o agente já executa testes, só fecha o loop
- 2.1 e 2.2 usam `inspect_schema` existente — baixo risco, alto valor
- 2.3 depende de resultados acumulados de 2.1
- 1.3 (CI/CD) é independente mas menos urgente que ter o core funcionando
- Camada 3 depende de dados no catálogo — começa depois de 2.x estar estável

---

## Princípios desta expansão

- **Nada quebra o que já funciona** — cada fase é aditiva, sem modificar lógica existente
- **Validar antes de avançar** — cada fase tem critério de done explícito
- **Reutilizar infraestrutura** — pgvector, eventos, documentação e agente já existem
- **Governança leve** — sem complexidade de ferramentas enterprise; conversacional e acionável
- **QA fecha o loop** — não só captura falhas, conecta falha → decisão → código → qualidade
