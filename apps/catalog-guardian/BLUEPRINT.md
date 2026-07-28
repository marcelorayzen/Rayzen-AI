# Catalog Guardian — Blueprint

> Documento de referência original do produto, com a codificação corrigida (o arquivo fornecido tinha corrupção de encoding UTF-8/Latin-1). Ver `../../.claude/plans/` (ou o histórico de conversa) para o plano de implementação derivado deste blueprint, incluindo as correções encontradas ao verificar as alegações de reuso contra o código real do Rayzen.

## Posicionamento

Não é outro catálogo de dados. É a camada de governança, segurança e resposta em linguagem natural que fica **em cima** do catálogo que o cliente já tem (Dataplex, OpenMetadata, Unity Catalog...). Resolve o que nenhum catálogo resolve sozinho:

- resposta de agent validada antes de sair, não depois
- permissão do catálogo respeitada mesmo quando o metadado é extraído pra outro lugar
- detecção proativa de degradação do catálogo, sem depender de alguém lembrar de checar

Acelera três competências DAMA-DMBOK ao mesmo tempo — Governança, Segurança, Qualidade — sem exigir troca de plataforma. É o produto vendável da consultoria.

**App isolado no monorepo Rayzen** (`apps/catalog-guardian`), com Prisma/DB próprios — não lê `public` nem `v2` do Rayzen em runtime. Motivo: precisa ser deployável na infra do cliente, sozinho, sem carregar o resto do Rayzen (Mission Engine, Project Memory etc. não fazem sentido pro cliente de consultoria). O que se reaproveita do Rayzen são **padrões de arquitetura**, replicados aqui como código próprio — não import cross-app.

---

## Base reaproveitada do Rayzen (padrão, não dependência)

| Padrão | Onde já existe hoje | O que muda no Catalog Guardian |
|---|---|---|
| `DataAsset` (sensitivity, PII, owner) | `apps/api/modules/data-catalog` | Vira `CatalogAsset`, populado pelo adapter externo em vez de criado manualmente |
| `DataLineageEdge` | mesmo módulo | Vira `CatalogLineageEdge`, alimentado pelo lineage nativo do catálogo fonte (Dataplex tem Data Lineage API própria) |
| `RiskScorerService` — tabela fixa, não LLM | `apps/api-v2/guardian` | Adaptado pra avaliar risco de **resposta a pergunta de negócio**, não de operação de agent |
| `ProactiveService` — regras + cache TTL | `apps/api/modules/proactive` | Regras trocadas de "projeto" pra "catálogo" (ver Fase 4) |
| `ApprovalGatesService` | `apps/api-v2/approval-gates` | Reaproveitado como Review Gate pra resposta de alto risco antes de chegar no usuário |
| Formato de retorno do `PolicyEngineService` (`allowed / violations / warnings / gate`) | `apps/api-v2/policy-engine` | Estrutura reaproveitada pro `PermissionGuardService`, nova operação `catalog_query` |

> **Nota de verificação (adicionada no plano de implementação):** ao conferir estas alegações contra o código real antes de implementar, `RiskScorerService` e `ApprovalGatesService` se confirmaram genuinamente reaproveitáveis como padrão. O retorno real do `PolicyEngineService` é `{ allowed, violations, warnings, gateRequired, gateViolations, gateId?, exemptions }` — não existe campo `gate` solto. E o `ProactiveService` não é um motor de regras genérico/plugável — são 7 blocos condicionais hardcoded contra os models de Projeto; só a *forma* (tipo `Recommendation`, cache→compute→sort) é reaproveitável, cada regra de catálogo precisa ser escrita do zero.

---

## Escopo

**Resolve:** retrieval permission-aware, validação determinística pré-resposta, resposta parcial rotulada quando falta permissão, motor proativo de qualidade de catálogo, log de auditoria exportável, chat em linguagem natural pra área de negócio.

**Não resolve:** não substitui o catálogo — Dataplex/OpenMetadata continua sendo a fonte de verdade; não armazena dado bruto, só metadado + cache de contexto; não é DLP genérico da empresa toda, é escopado ao que está catalogado.

---

## Fluxo de resposta segura (visão de alto nível)

```
Pergunta de negócio
        │
        ▼
Retrieval permission-aware   → consulta identidade do usuário
        │                       antes de montar contexto
        ▼
Contexto marcado             → campo restrito nunca some
        │                       silenciosamente, vem rotulado
        ▼
CatalogRiskScorer (fixo)     → classifica risco da resposta
        │
        ├─ risco baixo ──────────────► Resposta ao usuário
        │
        └─ risco alto ───► Review Gate ───► steward aprova/ajusta ───► Resposta
        │
        ▼
QueryAudit (append-only)     → toda decisão fica registrada
```

---

## Modelo de dados (Prisma — rascunho original do blueprint)

Ver `prisma/schema.prisma` no app para o schema efetivamente implementado — os nomes de model coincidem com este rascunho (`CatalogAsset`, `CatalogLineageEdge`, `QueryAudit`, `CatalogRecommendation`), com o gate de revisão renomeado para `ReviewGate` (em vez de reusar `ApprovalGate` do Rayzen, que é cross-app).

## `CatalogAdapter` — contrato

```typescript
interface CatalogAdapter {
  readonly source: 'dataplex' | 'openmetadata' | 'unity_catalog'

  listAssets(): Promise<RawCatalogAsset[]>
  getLineage(assetId: string): Promise<RawLineageEdge[]>
  getUserAccessLevel(userId: string, assetId: string): Promise<AccessLevel>
  // ponto crítico — ver "Riscos", identidade é o maior gap
}
```

Primeira implementação: `OpenMetadataAdapter`, usando a REST API do OpenMetadata (token de bot/service account, read-only).

---

## Motor proativo — regras de catálogo (adaptado do `ProactiveService`)

| Regra | Dispara quando | Prioridade |
|---|---|---|
| `unclassified_asset` | Asset sincronizado há mais de N dias sem `sensitivity` definida | high |
| `orphan_owner` | Asset sem `owner` | medium |
| `low_confidence_pattern` | Taxa de respostas com risco alto sobre o mesmo asset acima de threshold | high |
| `permission_drift` | Nível de acesso retornado pelo adapter diverge do que está em cache local | high |
| `flagged_unresolved` | Usuário sinalizou resposta como incorreta e não houve ajuste em N dias | medium |

---

## Fases

**Fase 0 — Fundação**
- `apps/catalog-guardian` (NestJS + Fastify), Prisma schema próprio, `docker-compose.yml` isolado
- Modelos: `CatalogAsset`, `CatalogLineageEdge`, `QueryAudit`
- Interface `CatalogAdapter` (contrato, sem implementação)

**Fase 1 — Adapter OpenMetadata + sync**
- `OpenMetadataAdapter` implementando o contrato
- Job BullMQ de sync periódico: metadado + sensibilidade + lineage nativo → `CatalogAsset`/`CatalogLineageEdge`
- **Decisão em aberto aqui:** mapeamento de identidade (ver Riscos) — validar antes de avançar pra Fase 2

**Fase 2 — Permission Guard (retrieval permission-aware)**
- `PermissionGuardService`: filtra campo por nível de acesso antes de montar contexto pro LLM
- Campo restrito nunca some — vem marcado `[RESTRITO: nível X]`
- Instrução fixa no agent: nunca estimar campo restrito, sempre declarar
- Golden dataset de perguntas mistas (liberado + restrito) pra regressão

**Fase 3 — Risk Scorer + Review Gate**
- `CatalogRiskScorerService` — tabela fixa: mistura de sensibilidade, confiança baixa, ausência de citação de fonte
- Reaproveita padrão `ApprovalGatesService` pra rotear resposta de alto risco
- Resposta parcial rotulada quando aplicável

**Fase 4 — Motor proativo**
- `CatalogProactiveService` com as regras da tabela acima
- Fila priorizada pro steward

**Fase 5 — Auditoria e relatório de maturidade**
- `QueryAudit` exportável (CSV/PDF)
- Relatório periódico de maturidade DAMA — artefato comercial recorrente

**Fase 6 — Segundo adapter (Unity Catalog ou Dataplex)**
- Prova que o `CatalogAdapter` realmente abstrai — argumento comercial de "não é lock-in"

---

## Stack

NestJS 10 + Fastify · PostgreSQL 16 (schema próprio) · Redis + BullMQ · Prisma 5 · LiteLLM · Docker Compose isolado por cliente.

---

## Riscos / pontos em aberto

1. **Identidade — o maior gap, resolve antes da Fase 2 valer alguma coisa.** `getUserAccessLevel()` depende de mapear o usuário do Catalog Guardian pro IAM/RBAC real do cliente no catálogo fonte. Sem isso o Permission Guard não tem o que verificar — é pré-requisito, não detalhe.
2. Custo de chamadas à API do catálogo fonte em sync frequente — precisa cache e rate limit.
3. Latência: filtro de permissão por query, antes do LLM, adiciona uma chamada externa por pergunta — precisa cache de `AccessLevel` com TTL curto.

---

## Próximo passo

Fase 0: schema Prisma + interface `CatalogAdapter`, sem lógica ainda — só o contrato e o esqueleto do app.
