-- Corrige dimensões do embedding: vector(1536) → vector(1024)
-- Jina embeddings-v3 suporta máximo 1024 dimensões

ALTER TABLE "documents" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "documents" ADD COLUMN "embedding" vector(1024);
