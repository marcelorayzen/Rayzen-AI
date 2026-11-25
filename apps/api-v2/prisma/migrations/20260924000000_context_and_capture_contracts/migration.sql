-- Fase 3 — contratos de contexto e captura.
--
-- As três colunas de captura são NULÁVEIS de propósito, e a razão é o boot: a V2 sobe
-- com `prisma db push` SEM `--accept-data-loss` (apps/api-v2/Dockerfile), que se recusa a
-- adicionar coluna obrigatória a tabela que já tem linhas. Declarar NOT NULL aqui
-- derrubaria a API no próximo deploy em vez de proteger o dado.
--
-- Um default também foi descartado: `gen_random_uuid()` como chave de idempotência
-- transformaria "o produtor esqueceu a chave" em "cada retentativa é uma proposta nova",
-- calado. A obrigatoriedade mora no DTO e no serviço, onde a ausência vira HTTP 400; o
-- banco garante a unicidade do par, que é o que impede duas capturas com a mesma chave.
ALTER TABLE "v2"."knowledge_proposals" ADD COLUMN "namespace" TEXT;
ALTER TABLE "v2"."knowledge_proposals" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "v2"."knowledge_proposals" ADD COLUMN "payload_hash" TEXT;

-- Linha anterior ao contrato recebe chave derivada da própria identidade: ela nunca
-- colide com outra e nunca é reconhecida como replay de uma captura nova.
UPDATE "v2"."knowledge_proposals"
   SET "namespace"       = 'legacy:' || "created_by",
       "idempotency_key" = 'legacy:' || "id",
       "payload_hash"    = "content_hash"
 WHERE "namespace" IS NULL;

CREATE UNIQUE INDEX "knowledge_proposals_namespace_idempotency_key_key"
  ON "v2"."knowledge_proposals"("namespace", "idempotency_key");

CREATE TABLE "v2"."context_packs" (
  "id" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "project_id" TEXT,
  "principal_kind" TEXT NOT NULL,
  "principal_subject" TEXT NOT NULL,
  "consumer" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "classes" JSONB NOT NULL,
  "limits" JSONB NOT NULL,
  "retrieval_policy" JSONB NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "snapshot" TEXT NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "knowledge_revision" INTEGER NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authorization_expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "context_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2"."context_pack_items" (
  "id" TEXT NOT NULL,
  "pack_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "item_key" TEXT NOT NULL,
  "item_ref" TEXT,
  "lifecycle" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "chars" INTEGER NOT NULL,
  "reproducible" BOOLEAN NOT NULL,
  CONSTRAINT "context_pack_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "context_packs_scope_key_generated_at_idx"
  ON "v2"."context_packs"("scope_key", "generated_at");
CREATE INDEX "context_packs_consumer_session_id_idx"
  ON "v2"."context_packs"("consumer", "session_id");
CREATE UNIQUE INDEX "context_pack_items_pack_id_position_key"
  ON "v2"."context_pack_items"("pack_id", "position");
CREATE INDEX "context_pack_items_kind_item_ref_idx"
  ON "v2"."context_pack_items"("kind", "item_ref");

ALTER TABLE "v2"."context_pack_items"
  ADD CONSTRAINT "context_pack_items_pack_id_fkey"
  FOREIGN KEY ("pack_id") REFERENCES "v2"."context_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
