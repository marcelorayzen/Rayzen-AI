# 004 — Memory Engine

## Visão Geral

O Memory Engine é a camada de conhecimento persistente do sistema. Armazena, classifica, recupera e consolida informação ao longo do tempo. Na V2, memória tem **classes com lifecycle**: toda informação entra como `inbox`, é processada para `working`, consolidada em `consolidated` e arquivada ou descartada com base em relevância.

A IA não precisa ser chamada para buscar o que já foi aprendido — o Memory Engine fornece esse contexto diretamente.

---

## Mapeamento V1

| Módulo V1 | Sobreposição |
|---|---|
| `apps/api/src/modules/memory/` | Embed (Jina 1024-dim), vector search, indexação de PDF/URL/GitHub/Notion |
| `apps/api/src/modules/brain/` | Wrapper sobre memory com chunking, cache, síntese LLM — **quase duplicado** |
| `apps/api/prisma/schema.prisma` → `Document` | Campo `memoryClass` existe (`inbox/working/consolidated/archive`) mas **nunca usado** |
| `apps/api/src/modules/memory/memory.service.ts` | Busca vetorial via pgvector já funciona |

**Problema na V1:** Dois módulos quase idênticos (`memory` e `brain`), lifecycle de memória não implementado apesar de estar no schema, sem decay ou consolidação automática.

---

## Gaps

- Consolidar `memory/` e `brain/` em único `MemoryEngine`
- Implementar pipeline de classes: `inbox → working → consolidated → archive`
- Consolidação automática: LLM agrupa chunks relacionados em `consolidated`
- Decay: documentos em `working` sem acesso por N dias voltam para `inbox` ou vão para `archive`
- Estratégia de retrieval diferente por work mode (debugging busca mais código, review busca mais decisões)
- Cross-project memory com permissão explícita

---

## Interface / Endpoints

```
POST /v2/memory/store           # Indexa novo conteúdo
POST /v2/memory/search          # Busca semântica
GET  /v2/memory/documents       # Lista documentos do projeto
DELETE /v2/memory/documents/:id # Remove documento
POST /v2/memory/consolidate     # Dispara consolidação manual
GET  /v2/memory/stats           # Tamanho, distribuição por classe
PATCH /v2/memory/:id/class      # Move documento de classe manualmente
```

**Payload busca:**
```typescript
interface MemorySearchRequest {
  query:     string
  projectId: string
  classes?:  MemoryClass[]     // filtrar por classe
  limit?:    number
  mode?:     WorkMode          // influencia ranking
}

type MemoryClass = 'inbox' | 'working' | 'consolidated' | 'archive'
type WorkMode = 'implementation' | 'debugging' | 'review' | 'architecture' | 'study'
```

---

## Modelo de Dados

```typescript
// Evolução do model Document no Prisma
interface MemoryEntry {
  id:           string
  projectId:    string
  content:      string
  embedding:    number[]           // vector(1024) — Jina AI
  memoryClass:  MemoryClass        // lifecycle
  sourcePath?:  string
  sourceType:   'file' | 'url' | 'github' | 'notion' | 'manual' | 'ai_generated'
  accessCount:  number             // para decay
  lastAccessAt: Date
  consolidatedInto?: string        // id do chunk consolidado que absorveu este
  metadata:     Record<string, unknown>
  createdAt:    Date
  updatedAt:    Date
}

interface ConsolidationJob {
  id:        string
  projectId: string
  status:    'pending' | 'running' | 'done' | 'failed'
  inputIds:  string[]
  outputId?: string
  triggeredBy: 'auto' | 'manual'
  createdAt: Date
}
```

---

## Dependências

- **005 — Context Engine**: fornece memória relevante para montar contexto
- **003 — AI Router**: usa tier 2 para consolidação e síntese
- **009 — Cost Controller**: consolidação LLM tem custo monitorado
- **012 — Project Memory**: especialização de memória por projeto

---

## Fase de Implementação

**Fase 1** — necessário desde o início para que missões possam consultar conhecimento existente.

Ordem:
1. Migration Prisma: adicionar campos `memoryClass`, `accessCount`, `lastAccessAt`, `consolidatedInto` ao model `Document`
2. `MemoryEngineService` unificando `memory/` e `brain/` (sem quebrar V1)
3. Pipeline de classes com regras de transição
4. Decay job (BullMQ, diário)
5. Consolidação automática (Fase 3)
