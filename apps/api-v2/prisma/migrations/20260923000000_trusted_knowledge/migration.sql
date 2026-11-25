CREATE TABLE "v2"."knowledge_sources" (
  "id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "project_id" TEXT,
  "source_type" TEXT NOT NULL,
  "source_identity" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "raw_content" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "retention_policy" TEXT NOT NULL DEFAULT 'indefinite',
  "retain_until" TIMESTAMP(3),
  "captured_by" TEXT NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2"."knowledge_proposals" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "project_id" TEXT,
  "logical_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "knowledge_type" TEXT NOT NULL,
  "sensitivity" TEXT NOT NULL DEFAULT 'internal',
  "retention_policy" TEXT NOT NULL DEFAULT 'indefinite',
  "retain_until" TIMESTAMP(3),
  "valid_from" TIMESTAMP(3),
  "valid_until" TIMESTAMP(3),
  "producer" TEXT NOT NULL,
  "producer_version" TEXT,
  "status" TEXT NOT NULL DEFAULT 'candidate',
  "supersedes_id" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2"."knowledge_decisions" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_subject" TEXT NOT NULL,
  "actor_role" TEXT,
  "reason" TEXT,
  "proposal_version" INTEGER NOT NULL,
  "content_hash" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2"."knowledge_versions" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "project_id" TEXT,
  "logical_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "knowledge_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "retention_policy" TEXT NOT NULL DEFAULT 'indefinite',
  "retain_until" TIMESTAMP(3),
  "valid_from" TIMESTAMP(3),
  "valid_until" TIMESTAMP(3),
  "approved_by" TEXT NOT NULL,
  "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "v2"."knowledge_projections" (
  "id" TEXT NOT NULL,
  "knowledge_version_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "external_id" TEXT,
  "content_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "built_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_sources_scope_key_source_identity_source_hash_key"
  ON "v2"."knowledge_sources"("scope_key", "source_identity", "source_hash");
CREATE INDEX "knowledge_sources_scope_key_captured_at_idx"
  ON "v2"."knowledge_sources"("scope_key", "captured_at");
CREATE UNIQUE INDEX "knowledge_proposals_scope_key_logical_key_version_key"
  ON "v2"."knowledge_proposals"("scope_key", "logical_key", "version");
CREATE UNIQUE INDEX "knowledge_proposals_source_id_logical_key_content_hash_key"
  ON "v2"."knowledge_proposals"("source_id", "logical_key", "content_hash");
CREATE INDEX "knowledge_proposals_scope_key_status_created_at_idx"
  ON "v2"."knowledge_proposals"("scope_key", "status", "created_at");
CREATE INDEX "knowledge_decisions_proposal_id_decided_at_idx"
  ON "v2"."knowledge_decisions"("proposal_id", "decided_at");
CREATE UNIQUE INDEX "knowledge_versions_proposal_id_key"
  ON "v2"."knowledge_versions"("proposal_id");
CREATE UNIQUE INDEX "knowledge_versions_scope_key_logical_key_version_key"
  ON "v2"."knowledge_versions"("scope_key", "logical_key", "version");
CREATE INDEX "knowledge_versions_scope_key_status_idx"
  ON "v2"."knowledge_versions"("scope_key", "status");
CREATE UNIQUE INDEX "knowledge_projections_knowledge_version_id_kind_key"
  ON "v2"."knowledge_projections"("knowledge_version_id", "kind");
CREATE INDEX "knowledge_projections_external_id_idx"
  ON "v2"."knowledge_projections"("external_id");

ALTER TABLE "v2"."knowledge_proposals"
  ADD CONSTRAINT "knowledge_proposals_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "v2"."knowledge_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v2"."knowledge_decisions"
  ADD CONSTRAINT "knowledge_decisions_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "v2"."knowledge_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v2"."knowledge_versions"
  ADD CONSTRAINT "knowledge_versions_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "v2"."knowledge_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "v2"."knowledge_projections"
  ADD CONSTRAINT "knowledge_projections_knowledge_version_id_fkey"
  FOREIGN KEY ("knowledge_version_id") REFERENCES "v2"."knowledge_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "v2"."reject_knowledge_source_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'knowledge_sources are immutable';
END;
$$;

CREATE TRIGGER "knowledge_sources_immutable"
BEFORE UPDATE OR DELETE ON "v2"."knowledge_sources"
FOR EACH ROW EXECUTE FUNCTION "v2"."reject_knowledge_source_mutation"();

CREATE OR REPLACE FUNCTION "v2"."reject_knowledge_decision_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'knowledge_decisions are append-only';
END;
$$;

CREATE TRIGGER "knowledge_decisions_append_only"
BEFORE UPDATE OR DELETE ON "v2"."knowledge_decisions"
FOR EACH ROW EXECUTE FUNCTION "v2"."reject_knowledge_decision_mutation"();
