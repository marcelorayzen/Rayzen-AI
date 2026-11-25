-- Knowledge Governance Layer: adiciona confidence (trust score) e origin (proveniência)
-- aos nós do grafo de conhecimento.

ALTER TABLE "v2"."knowledge_nodes"
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "origin"     TEXT;
