-- Backlog "busca substring" — habilita pgvector (imagem Docker trocada pra
-- pgvector/pgvector:pg16) e adiciona embedding a CatalogAsset/CatalogGlossaryTerm.
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "catalog_assets" ADD COLUMN "embedding" vector(1024);

-- AlterTable
ALTER TABLE "catalog_glossary_terms" ADD COLUMN "embedding" vector(1024);
