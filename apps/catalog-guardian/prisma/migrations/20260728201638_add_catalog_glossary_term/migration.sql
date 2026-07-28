-- CreateTable
CREATE TABLE "catalog_glossary_terms" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "catalog_glossary_terms_source_external_id_key" ON "catalog_glossary_terms"("source", "external_id");
