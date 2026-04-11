-- Brain + Wiki layer: WikiPage, WikiPageVersion, WikiSourceReference

-- WikiPage
CREATE TABLE "wiki_pages" (
  "id"           TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "tags"         TEXT[] NOT NULL DEFAULT '{}',
  "content_md"   TEXT NOT NULL,
  "related"      TEXT[] NOT NULL DEFAULT '{}',
  "edit_status"  TEXT NOT NULL DEFAULT 'generated',
  "compiled_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wiki_pages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wiki_pages_slug_key" ON "wiki_pages"("slug");

-- WikiPageVersion
CREATE TABLE "wiki_page_versions" (
  "id"          TEXT NOT NULL,
  "page_id"     TEXT NOT NULL,
  "content_md"  TEXT NOT NULL,
  "reason"      TEXT NOT NULL DEFAULT 'compiled',
  "diff"        TEXT,
  "author_type" TEXT NOT NULL DEFAULT 'llm',
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wiki_page_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wiki_page_versions_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "wiki_page_versions_page_id_created_at_idx"
  ON "wiki_page_versions"("page_id", "created_at" DESC);

-- WikiSourceReference
CREATE TABLE "wiki_source_references" (
  "id"              TEXT NOT NULL,
  "page_id"         TEXT NOT NULL,
  "document_id"     TEXT NOT NULL,
  "relevance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "used_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wiki_source_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wiki_source_references_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wiki_source_references_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "wiki_source_references_page_id_document_id_key"
  ON "wiki_source_references"("page_id", "document_id");
