-- AlterTable
ALTER TABLE "session_artifacts" ADD COLUMN     "source_ids" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "project_document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "previous_content" TEXT,
    "diff" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'regenerated',
    "source_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_document_versions_document_id_created_at_idx" ON "project_document_versions"("document_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
