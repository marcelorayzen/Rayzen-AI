-- AlterTable
ALTER TABLE "catalog_assets" ADD COLUMN     "first_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "query_audit_flags" (
    "id" TEXT NOT NULL,
    "query_audit_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "query_audit_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "query_audit_flags_query_audit_id_idx" ON "query_audit_flags"("query_audit_id");

-- CreateIndex
CREATE INDEX "query_audit_flags_resolved_at_idx" ON "query_audit_flags"("resolved_at");

-- AddForeignKey
ALTER TABLE "query_audit_flags" ADD CONSTRAINT "query_audit_flags_query_audit_id_fkey" FOREIGN KEY ("query_audit_id") REFERENCES "query_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
