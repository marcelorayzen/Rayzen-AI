-- CreateTable
CREATE TABLE "catalog_assets" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "domain" TEXT,
    "sensitivity" TEXT NOT NULL DEFAULT 'internal',
    "contains_pii" BOOLEAN NOT NULL DEFAULT false,
    "pii_fields" JSONB,
    "tags" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_lineage_edges" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "transform" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_lineage_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "query_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "restricted_fields_omitted" JSONB,
    "cited_assets" JSONB,
    "risk_score" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "gate_required" BOOLEAN NOT NULL DEFAULT false,
    "gate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_gates" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_recommendations" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "action" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "catalog_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_assets_domain_idx" ON "catalog_assets"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_assets_source_external_id_key" ON "catalog_assets"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_lineage_edges_source_id_target_id_key" ON "catalog_lineage_edges"("source_id", "target_id");

-- CreateIndex
CREATE INDEX "query_audits_user_id_idx" ON "query_audits"("user_id");

-- CreateIndex
CREATE INDEX "query_audits_created_at_idx" ON "query_audits"("created_at");

-- CreateIndex
CREATE INDEX "review_gates_status_idx" ON "review_gates"("status");

-- CreateIndex
CREATE INDEX "catalog_recommendations_dismissed_at_idx" ON "catalog_recommendations"("dismissed_at");

-- AddForeignKey
ALTER TABLE "catalog_lineage_edges" ADD CONSTRAINT "catalog_lineage_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "catalog_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_lineage_edges" ADD CONSTRAINT "catalog_lineage_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "catalog_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
