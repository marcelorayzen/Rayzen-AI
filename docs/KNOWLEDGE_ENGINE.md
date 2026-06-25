# KNOWLEDGE_ENGINE — Rayzen AI

> Motor de grafo de conhecimento do V2. Extrai entidades e relações do codebase, governa confiabilidade dos nós e responde queries de impacto.

---

## Objetivo

Representar o conhecimento do projeto como um grafo tipado — entidades (arquivo, função, decisão, conceito) com relações (importa, implementa, decide, referencia) — para responder perguntas de impacto e rastreabilidade que busca semântica simples não resolve.

---

## Módulos (`apps/api-v2/src/knowledge/`)

```
knowledge-extractor.service.ts    → extrai nós/arestas de arquivos
knowledge-storage.service.ts      → CRUD de KnowledgeNode e KnowledgeEdge
knowledge-graph-builder.service.ts → orquestra extração + armazenamento
knowledge-query.service.ts        → queries traversal + similarity
knowledge-governance.service.ts   → políticas de trust score e validade
knowledge-impact.service.ts       → análise de impacto (quem usa X)
code-lineage.service.ts            → rastreia origem de decisões em código
lineage.service.ts                 → rastreia origem de dados e artefatos
knowledge.controller.ts            → rotas /v2/knowledge
lineage.controller.ts              → rotas /v2/knowledge/lineage
```

---

## Modelo de dados (schema v2)

```ts
KnowledgeNode {
  id:          string  (uuid)
  projectId:   string
  type:        'file' | 'function' | 'decision' | 'concept' | 'module'
  name:        string
  content:     string  (resumo/snippet)
  trustScore:  float   (0.0 – 1.0, calculado pelo governance)
  source:      'extracted' | 'manual' | 'inferred'
  createdAt:   DateTime
  updatedAt:   DateTime
}

KnowledgeEdge {
  id:        string
  projectId: string
  fromId:    string    (KnowledgeNode)
  toId:      string    (KnowledgeNode)
  relation:  'imports' | 'implements' | 'decides' | 'references' | 'uses' | 'extends'
  weight:    float
}
```

---

## Fluxo de extração

```
POST /v2/knowledge/extract { projectId, filePath? }
  → KnowledgeGraphBuilderService.build()
       ├─ KnowledgeExtractorService.extractFromFile(filePath)
       │    └─ LLM (gpt-4o-mini) → JSON { nodes: [...], edges: [...] }
       ├─ KnowledgeStorageService.upsertNodes(nodes)
       ├─ KnowledgeStorageService.upsertEdges(edges)
       └─ KnowledgeGovernanceService.scoreAll(projectId)
            └─ trust score por source: manual=1.0, extracted=0.8, inferred=0.6
```

---

## Fluxo de query

```
POST /v2/knowledge/query { projectId, query, limit? }
  → KnowledgeQueryService.search()
       ├─ similarity search por content (pgvector via V1 bridge)
       ├─ graph traversal (depth-first, max 3 hops)
       └─ retorna { nodes, edges, relevanceScore }
```

---

## Análise de impacto

```
GET /v2/knowledge/impact?nodeId=X&projectId=Y
  → KnowledgeImpactService.analyze(nodeId)
       ├─ quem importa X (inbound edges)
       ├─ o que X usa (outbound edges)
       └─ retorna { affectedNodes, riskLevel: 'low'|'medium'|'high' }
```

---

## Governance — trust score

| Source | Trust score inicial |
|---|---|
| `manual` | 1.0 — criado explicitamente pelo usuário |
| `extracted` | 0.8 — gerado por LLM a partir de arquivo real |
| `inferred` | 0.6 — derivado de relação entre nós |

**Política BLOCK:** `low_confidence_knowledge` — nós com trust score < threshold não são persistidos (configurável por projeto via PolicyEngine).

**Política WARN:** `memory_requires_source` — nós `inferred` sem fonte explícita são sinalizados.

---

## Integração com Context Engine

`KnowledgeStorageService.query()` é chamado pelo `ContextEngineService` para a seção `knowledge_graph` do contexto cirúrgico — relevante principalmente nos modos `debugging`, `review`, `architecture`.

---

## Integração com hook graphify

```
pnpm gen:catalog → graphify update .
  → POST /v2/knowledge/extract (via jarvis:graphify_sync no agent desktop)
  → KnowledgeGraphBuilder extrai AST-based nodes dos arquivos modificados
```

`jarvis:graphify_sync` está em `DESKTOP_ACTIONS` (role-policy.ts) e em `ALLOWED_ACTIONS` (whitelist.ts) — ver ADR-002.

---

## Contratos críticos

| Endpoint | Método | Payload |
|---|---|---|
| `/v2/knowledge/extract` | POST | `{ projectId, filePath? }` |
| `/v2/knowledge/query` | POST | `{ projectId, query, limit? }` |
| `/v2/knowledge/impact` | GET | `?nodeId=&projectId=` |
| `/v2/knowledge/lineage/:id` | GET | Rastreabilidade de decisão |

---

## Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| Extração LLM com JSON malformado | Nós não salvos silenciosamente | Extrator usa `extractFirstJson` com balanceamento de chaves |
| Trust score 0.6 para nós inferred | Grafo impreciso propaga erros | Política BLOCK em threshold configurável |
| Grafo não atualizado após refactor | Context engine retorna relações obsoletas | `graphify update .` deve rodar após mudanças estruturais |
| Muitos nós duplicados por extração repetida | Grafo inflado | Upsert por `name + type + projectId` evita duplicação |

---

## Critérios de pronto

- `POST /v2/knowledge/extract` em arquivo TypeScript → nós de função/import extraídos em < 5s
- Trust score de nó `extracted` = 0.8 no banco
- Política BLOCK aplicada para trust score < 0.5 (nenhum nó inferred com conflito persiste)
- Seção `knowledge_graph` no contexto cirúrgico não vazia para projetos com extração rodada

---

## Próximos ajustes

- Atualização incremental do grafo via hook PostToolUse (hoje é manual via graphify)
- Decay de trust score por tempo (nó não referenciado há 30 dias perde 0.1)
- UI de visualização do grafo de conhecimento (reusa `@xyflow/react` do Goal Graph)
- Cross-project knowledge (decisões reutilizáveis entre projetos)
