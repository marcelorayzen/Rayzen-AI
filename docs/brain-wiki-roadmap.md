# Brain Wiki — Roadmap de Implementação

Inspirado no modelo editorial do [2Cérebro](https://inematds.github.io/2cerebro/index.html).
Objetivo: transformar o Brain de um índice vetorial opaco em uma **wiki canônica, navegável, curável e citável**.

---

## Diagnóstico atual

O modelo `Document` hoje tem:
```
id, sourcePath, content, embedding vector(1024), metadata Json, checksum, projectId
```

O que falta para ser uma wiki:
- Sem `slug` → não é citável por URL
- Sem `title`, `tags`, `related[]` → não é navegável
- Sem `content_md` compilado → o conteúdo é raw, não editorial
- Sem versionamento → não é curável (editar = deletar e reinserir)
- Sem página de índice → existe só via query semântica

---

## Princípio de execução

> Nunca redesenhar o Brain antes de ter o Brain funcionando.
> Cada etapa entrega valor standalone. Nenhuma quebra o que veio antes.

---

## Fase 2.0 — Brain MVP (pré-requisito)

**Status:** não iniciado
**Objetivo:** Brain funcional com ingestion + busca semântica básica

### O que implementar

- [ ] Endpoint `POST /brain/index` — recebe `{ source: url | text | file }`
- [ ] Pipeline de ingestion: chunking → embedding (text-embedding-3-small) → salva `Document`
- [ ] Endpoint `POST /brain/search` — recebe query, retorna top-K por similaridade
- [ ] Módulo `BrainService` com `index()` e `search()`
- [ ] Testes: `brain.service.spec.ts` cobrindo index e search

### Schema (sem mudança ainda)

O `Document` atual é suficiente para o MVP. Não alterar schema nesta fase.

### Critério de conclusão

Conseguir indexar uma URL e recuperar o conteúdo por busca semântica via chat.

---

## Fase 2.1 — Camada Wiki (slug + frontmatter)

**Depende de:** Fase 2.0 concluída
**Objetivo:** cada Document se torna uma nota canônica, citável e navegável

### Migration do schema

```prisma
model Document {
  id          String   @id @default(uuid())

  // --- existente ---
  sourcePath  String?  @map("source_path")
  content     String   // conteúdo raw original
  embedding   Unsupported("vector(1024)")?
  metadata    Json     @default("{}")
  checksum    String
  projectId   String?  @map("project_id")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  // --- novo (wiki layer) ---
  slug        String?  @unique          // ex: "bullmq-retry-strategy"
  title       String?                   // título editorial
  tags        String[] @default([])     // ["queue", "redis", "nestjs"]
  contentMd   String?  @map("content_md")  // nota compilada pelo LLM
  related     String[] @default([])     // slugs de notas relacionadas
  sourceUrl   String?  @map("source_url")  // URL de origem (se aplicável)
  compiledAt  DateTime? @map("compiled_at") // quando foi compilado

  project     Project? @relation(fields: [projectId], references: [id])
  versions    DocumentVersion[]

  @@map("documents")
}

model DocumentVersion {
  id          String   @id @default(uuid())
  documentId  String   @map("document_id")
  contentMd   String   @map("content_md")
  reason      String   @default("compiled")  // compiled | manual | recompiled
  createdAt   DateTime @default(now()) @map("created_at")

  document Document @relation(fields: [documentId], references: [id])

  @@index([documentId, createdAt(sort: Desc)])
  @@map("document_versions")
}
```

### Pipeline de compilation

```
Fonte (URL / PDF / texto)
  → chunking + embedding  (já existe no 2.0)
  → LLM compila nota canônica:
      - extrai título
      - gera slug (kebab-case do título)
      - sugere tags
      - escreve content_md estruturado (## Resumo, ## Detalhes, ## Referências)
      - sugere related[] por busca semântica nas notas existentes
  → salva em Document com slug + contentMd
```

**System prompt de compilação:**
```
Você é um compilador de conhecimento. A partir do conteúdo abaixo, produza uma nota wiki canônica em JSON:
{
  "title": "título curto e descritivo",
  "slug": "kebab-case-do-titulo",
  "tags": ["tag1", "tag2"],
  "content_md": "## Resumo\n...\n## Detalhes\n...\n## Referências\n...",
  "related_keywords": ["termos para buscar notas relacionadas"]
}
Regras: sem hype, sem padding, máximo 400 palavras, linguagem técnica precisa.
```

### Endpoints novos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/brain/wiki` | Lista todas as notas (slug, title, tags, compiledAt) |
| `GET` | `/brain/wiki/:slug` | Retorna nota canônica completa |
| `PUT` | `/brain/wiki/:slug` | Edição manual do content_md (cria DocumentVersion) |
| `DELETE` | `/brain/wiki/:slug` | Soft delete (mantém embedding, remove da wiki) |

### Critério de conclusão

Conseguir acessar `/brain/wiki/bullmq-retry-strategy` e ver a nota formatada, editável e versionada.

---

## Fase 2.2 — Painel Wiki (navegação visual)

**Depende de:** Fase 2.1 concluída
**Objetivo:** `/brain` no painel web vira uma wiki navegável, não apenas um campo de busca

### Views a implementar no Next.js

**`/brain`** — Index da wiki
```
[ busca semântica ]

Tags: #nestjs  #redis  #queue  #lgpd  #ai  ...

Notas recentes:
  ● bullmq-retry-strategy          redis, queue     · indexado há 2h
  ● pgvector-similarity-search     postgres, ai     · indexado ontem
  ● lgpd-dados-sensiveis           lgpd, governança · indexado há 3 dias
```

**`/brain/[slug]`** — Nota individual
```
← voltar ao índice

# BullMQ — Retry Strategy
Tags: redis · queue · nestjs
Fonte: https://docs.bullmq.io/patterns/retrying-failing-jobs
Indexado: 09/04/2026

## Resumo
...

## Detalhes
...

## Referências
...

Notas relacionadas:
  → redis-connection-config
  → nestjs-queue-setup

[ Editar nota ]  [ Ver histórico ]
```

### Critério de conclusão

Navegar pelo painel, clicar em uma tag e ver todas as notas relacionadas. Clicar em uma nota e editar o content_md sem reindexar.

---

## Fase 2.3 — Links bidirecionais + grafo

**Depende de:** Fase 2.2 concluída
**Objetivo:** notas se referenciam explicitamente, grafo de conhecimento navegável

### O que implementar

- Syntax `[[slug]]` nos `content_md` resolvida em links clicáveis no painel
- Ao salvar/compilar uma nota, atualizar `related[]` de todas as notas que ela cita
- View `/brain/graph` — grafo visual (D3.js ou similar) das conexões entre notas
- Endpoint `GET /brain/wiki/:slug/backlinks` — notas que apontam para esta

### Critério de conclusão

Editar uma nota, adicionar `[[outra-nota]]`, e a outra nota automaticamente listar esta como backlink.

---

## Resumo de dependências

```
Fase 2.0 (MVP)
  └── Fase 2.1 (slug + frontmatter + compilation pipeline)
        └── Fase 2.2 (painel wiki navegável)
              └── Fase 2.3 (links bidirecionais + grafo)
```

---

## Riscos mapeados

| Risco | Mitigação |
|---|---|
| Schema migration em produção | 2.1 usa colunas nullable — migration não quebra dados existentes |
| Dupla fonte da verdade (raw vs compiled) | `compiledAt` indica se está sincronizado; UI avisa quando desatualizado |
| Curadoria vira overhead | Compilação automática é o default; edição manual é opt-in |
| Escopo crescente | Cada fase tem critério de conclusão claro — não avançar sem concluir |

---

## O que NÃO está neste roadmap (deliberadamente)

- Obsidian sync — frontend próprio é suficiente
- Export para markdown local — pode vir depois, não é bloqueante
- Busca full-text (BM25) — pgvector cobre o caso de uso; adicionar só se houver demanda real
