# MEMORY_ENGINE — Rayzen AI

> Duas camadas de memória: V1 (pgvector, storage) e V2 (lifecycle metadata, mode-aware retrieval). V2 usa V1 como storage, nunca o substitui.

---

## Objetivo

Armazenar, classificar e recuperar conhecimento relevante para o projeto — com memória hierárquica (inbox→archive) e boost de relevância por modo de trabalho.

---

## Arquitetura em duas camadas

```
┌──────────────────────────────────────────────────────────────────────┐
│                     V2 MemoryService                                 │
│  (lifecycle metadata: class, projectId, v1DocumentId)               │
│  Mode-aware retrieval: boost de score por memory_class               │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ V1ApiService (bridge — nunca escreve)
┌──────────────────────────▼───────────────────────────────────────────┐
│                     V1 BrainModule                                   │
│  pgvector 0.7  ·  Jina embeddings 1024-dim  ·  cosine similarity     │
│  indexDocument / indexUrl / indexText / searchRaw                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## V1 — BrainModule (`apps/api/src/modules/brain/`)

### O que faz

- Indexa conteúdo como chunks de 1500 chars com overlap de 200 chars
- Gera embedding via Jina AI (1024-dim) para cada chunk
- Armazena em `documents` com `embedding vector(1024)`, `projectId`, `sha256` (deduplicação)
- Busca por similaridade coseno com threshold configurável

### Contrato

```ts
// Indexação
POST /brain/index
{ projectId, content, sourcePath?, sourceType?: 'manual'|'notion'|'github'|'file'|'url' }

// Busca
POST /brain/search
{ projectId, query, limit?, threshold? }
→ [{ id, content, score, sourcePath, sourceType }]
```

### Cache

- `brain-search:${projectId}:${query}` → Redis, TTL 5 min
- `indexDocument()` invalida `brain-search:${projectId}:*` no created e updated

---

## V2 — MemoryService (`apps/api-v2/src/memory/memory.service.ts`)

### O que faz

- Armazena conteúdo novo via V1 (index) e registra metadados de ciclo de vida em `MemoryMeta` (schema v2)
- Busca no V1 e enriquece resultados com `memoryClass`, filtra por classe, aplica mode boost
- Deduplicação de conteúdo (`seenContent` Set durante retrieval)

### Contrato

```ts
// Armazenar
POST /v2/memory/store
{ projectId, content, sourcePath?, sourceType?, memoryClass?: MemoryClass }
→ { success, documentId, memoryClass }

// Buscar
POST /v2/memory/search
{ projectId, query, limit?, classes?: MemoryClass[], mode?: WorkMode }
→ { results: [{ id, content, score, memoryClass, sourcePath }], total }
```

### MemoryClass hierarchy

```
inbox → working → consolidated → archive
```

| Classe | Descrição | Contexto LLM |
|---|---|---|
| `inbox` | Novo, não classificado | Incluído (leve peso) |
| `working` | Em uso ativo, problemas em andamento | Incluído (peso alto) |
| `consolidated` | Decisão confirmada, conhecimento validado | Incluído (peso alto) |
| `archive` | Antigo, sem referência há 30+ dias | **Excluído** |

### Mode boost de score

| Modo | Boost por classe |
|---|---|
| `debugging` | working +0.15, inbox +0.05 |
| `review` | consolidated +0.15, archive +0.05 |
| `architecture` | consolidated +0.20 |
| `implementation` | working +0.10, inbox +0.05 |
| `study` | consolidated +0.10, inbox +0.05 |

### Promoção automática (V1 rules)

As regras de promoção automática são implementadas no V1 EventModule:

- `intent: 'decision'` → `consolidated`
- `intent: 'problem'` sem resolução em 48h → `working`
- evento `inbox` sem referência em 30 dias → `archive`

---

## Fluxo de indexação via hook

```
Edit/Write em Claude Code
  → rayzen-hook.mjs lê conteúdo do arquivo (max 8k chars)
  → POST /events/cli com fileContent
  → EventModule detecta fileContent
  → POST /brain/index (V1) com sourceType: 'cli'
  → MemoryMeta criado no V2 com class: 'inbox'
```

---

## MCP manual (`rayzen_capture_learning`)

```
Claude Code → rayzen_capture_learning(content, projectId)
  → POST /v2/memory/store
  → V1 indexa + V2 salva MemoryMeta
  → Retorna documentId + class atribuída
```

---

## Riscos conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| Indexação de arquivos .sql de manutenção | Contexto contaminado com SQL de seed | Filtrar extensões no hook (`INDEXABLE_EXTENSIONS`) |
| Jina API down | Busca semântica retorna vazio | BrainModule: erros Jina retornam `[]` gracefully |
| Chunks muito pequenos para código denso | Score baixo em busca | Chunk size 1500 chars + overlap 200 configurável |
| V2 MemoryMeta desincronizado do V1 | Classe errada aplicada | V1ApiService busca raw + V2 enriquece em query time |
| Deduplicação por SHA-256 falha em updates parciais | Conteúdo desatualizado no índice | `indexDocument` force-update se sha256 diferente |

---

## Critérios de pronto

- Indexação via hook → evento aparece em `/brain/search` dentro de 30s
- Busca com `mode: 'architecture'` retorna documentos `consolidated` com score mais alto do que os `inbox` equivalentes
- `archive` nunca aparece nos resultados de `memory.search()` padrão
- `rayzen_capture_learning` via MCP → documentId retornado em < 2s

---

## Próximos ajustes

- Dashboard de distribuição de memory_class por projeto (quantidade de inbox/working/consolidated/archive)
- Promoção automática baseada em frequência de acesso (não só por intent)
- Limite configurável de chunks por projeto para evitar crescimento ilimitado do pgvector index
- Decay score para documentos não acessados há > 60 dias (sem arquivar diretamente)
