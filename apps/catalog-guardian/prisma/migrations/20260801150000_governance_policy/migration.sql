-- QA-CHECKLIST.md § 12 "Processo/política" — conteúdo autoral do cliente,
-- deliberadamente separado de catalog_glossary_terms (ver comentário no
-- schema.prisma). Extensão vector já habilitada pela migration
-- 20260730145225_asset_glossary_embedding.
CREATE TABLE "governance_policies" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "question" TEXT,
    "description" TEXT NOT NULL,
    "document_ref" TEXT,
    "version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "embedding" vector(1024),

    CONSTRAINT "governance_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "governance_policies_topic_key" ON "governance_policies"("topic");
