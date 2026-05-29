# 017 — Knowledge Engine

## Visão Geral

O Knowledge Engine é a camada de conhecimento estruturado por relações. Onde o Memory Engine guarda *o que aconteceu*, o Knowledge Engine guarda *como as coisas se relacionam*.

A diferença é fundamental:

```
Memory Engine:
  "Projeto VB Ferragens — última tarefa: Catálogo — status: em andamento"

Knowledge Engine:
  Produto ──categoria──→ Categoria
  Produto ──estoque──→   Estoque
  Pedido  ──contém──→    Produto
  Pedido  ──pertence──→  Cliente
  ADR-001 ──impacta──→   módulo Administração ──impacta──→ módulo Pedidos
```

Essa diferença resolve um problema caro: análise de impacto via LLM com contexto textual grande pode ser substituída por travessia de grafo — mais rápida, mais barata e mais precisa.

---

## Mapeamento V1

| Componente V1 | Relação |
|---|---|
| `graphify` (tool externo) | Gera grafo AST do código — inspiração direta, mas limitado a análise de código |
| `apps/api/src/modules/graph/` | Goal graph visual (React Flow) — grafo de objetivos, não de conhecimento |
| `apps/api/src/modules/brain/` | Busca semântica textual — complementar, não substituto |
| `graphify-out/graph.json` | Artefato de grafo de código — pode ser importado como ponto de partida |

**Ausente na V1:** Nenhum componente representa relações entre entidades de domínio (módulos de negócio, ADRs, regras, fluxos) como grafo navegável.

---

## Gaps

- Graph Builder: extrai relações de código, documentos, ADRs e specs via LLM-assisted parsing
- Graph Storage: persistência do grafo (proposta: PostgreSQL com tabela de adjacência, sem dependência de Neo4j)
- Graph Query: interface de consulta por relação ("quais módulos dependem de X?")
- Impact Analyzer: dado uma mudança proposta, retorna o cone de impacto
- Relationship Extractor: componente LLM que lê texto não estruturado e extrai triplas (entidade → relação → entidade)
- Manter grafo atualizado incrementalmente quando arquivos mudam

---

## Interface / Endpoints

```
POST /v2/knowledge/build/:projectId      # Constrói grafo do projeto (inicial ou incremental)
GET  /v2/knowledge/graph/:projectId      # Retorna grafo completo ou subgrafo
POST /v2/knowledge/query                 # Consulta por relação
POST /v2/knowledge/impact                # Análise de impacto
GET  /v2/knowledge/entity/:id            # Detalhes de uma entidade do grafo
POST /v2/knowledge/extract               # Extrai relações de um texto/doc
```

**Payload impact analysis:**
```typescript
interface ImpactRequest {
  projectId:  string
  change:     string              // descrição da mudança proposta
  entities?:  string[]            // entidades específicas para analisar
}

interface ImpactResult {
  affectedModules:  string[]
  affectedRules:    string[]
  affectedFiles:    string[]      // estimativa
  impactDepth:      number        // quantos "saltos" no grafo
  summary:          string        // texto gerado por LLM
  graph:            GraphSubset   // subgrafo do cone de impacto
}
```

---

## Modelo de Dados

```typescript
// Storage via PostgreSQL — sem dependência de banco de grafo externo
// Modelo de lista de adjacência

type EntityType =
  | 'module'      // módulo de software (ex: Pedidos, Estoque)
  | 'rule'        // regra de negócio (ex: "taxa de entrega por região")
  | 'entity'      // entidade de domínio (ex: Produto, Cliente)
  | 'adr'         // decision record
  | 'flow'        // fluxo de processo
  | 'file'        // arquivo de código
  | 'concept'     // conceito abstrato

interface KnowledgeNode {
  id:         string
  projectId:  string
  type:       EntityType
  label:      string
  description?: string
  metadata:   Record<string, unknown>
  createdAt:  Date
  updatedAt:  Date
}

interface KnowledgeEdge {
  id:         string
  projectId:  string
  fromId:     string          // KnowledgeNode.id
  toId:       string          // KnowledgeNode.id
  relation:   string          // "impacta" | "depende_de" | "contém" | "pertence_a" | etc.
  weight:     number          // força da relação (0-1)
  source:     'extracted' | 'manual' | 'inferred'
  createdAt:  Date
}

// Consulta de grafo
interface GraphQuery {
  projectId:  string
  startEntity?: string
  relations?:  string[]       // filtrar por tipo de relação
  depth?:      number         // máximo de saltos (default: 2)
  entityTypes?: EntityType[]
}
```

---

## Skills produzidas por este componente

### `skill-project-understanding`

```typescript
// Input
interface ProjectUnderstandingInput {
  projectId: string
  sources: Array<{
    type: 'code' | 'doc' | 'adr' | 'spec'
    content: string
    path?: string
  }>
}

// Output — salvo no Knowledge Engine
interface ProjectMap {
  modules:      KnowledgeNode[]    // módulos identificados
  entities:     KnowledgeNode[]    // entidades de domínio
  rules:        KnowledgeNode[]    // regras de negócio
  relations:    KnowledgeEdge[]    // relações extraídas
  flows:        KnowledgeNode[]    // fluxos de processo
}
```

### `skill-impact-analysis`

```typescript
// Exemplo de uso pelo usuário:
// "Quero adicionar módulo de Delivery ao VB Ferragens"
//
// Rayzen responde:
// Impacto encontrado:
//   Módulos afetados: Pedidos, Estoque, Financeiro
//   Regras afetadas: Taxa de entrega, Região de cobertura, Prazo de entrega
//   Arquivos estimados: 12 alterados
//   Novos módulos necessários: Delivery, Transportadora
```

---

## Posicionamento no pipeline V2

```
Mission Engine
      ↓
Context Engine
      ↓
Memory Engine       ← fatos: "o que foi feito"
      ↓
Knowledge Engine    ← relações: "como as coisas se conectam"
      ↓
AI Router / Skills
      ↓
Execução
```

O Knowledge Engine é consultado entre Memory e Skills. O Context Engine pode solicitar um subgrafo relevante para enriquecer o contexto com relações estruturadas em vez de texto completo.

---

## Dependências

- **004 — Memory Engine**: complementar — memory guarda fatos, knowledge guarda relações
- **005 — Context Engine**: consome subgrafos do Knowledge Engine para enriquecer contexto
- **006 — Skill Engine**: as skills `project-understanding` e `impact-analysis` são registradas no Skill Registry
- **003 — AI Router**: tier 3 para extração de relações via LLM (Relationship Extractor)
- **010 — Observability**: queries ao Knowledge Engine rastreadas por custo e latência

---

## Relação com trabalho existente

```
graphify (tool CLI existente)
  → gera graph.json a partir de AST do código
  → pode ser importado como seed inicial do Knowledge Engine
  → não cobre entidades de domínio, regras, ADRs — isso é exclusivo do Knowledge Engine

graph/ module (V1)
  → goal graph visual no React Flow
  → representa objetivos e milestones, não conhecimento estruturado
  → sem impacto neste componente
```

---

## Fase de Implementação

**Fase 2** (atualizado via ADR-016) — inserido após Context Engine.

Ordem:
1. Schema Prisma: `KnowledgeNode` + `KnowledgeEdge`
2. `KnowledgeStorageService` — CRUD de nós e arestas
3. `KnowledgeQueryService` — travessia por profundidade + filtros
4. `RelationshipExtractor` — LLM extrai triplas de texto
5. `GraphBuilder` — pipeline de extração para um projeto
6. `ImpactAnalyzer` — cone de impacto a partir de mudança proposta
7. Skills `project-understanding` e `impact-analysis` registradas no Skill Engine
8. Import de `graphify-out/graph.json` como seed (opcional)
