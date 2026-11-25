-- CreateTable
CREATE TABLE "session_artifacts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'synthesis',
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_artifacts_project_id_session_id_idx" ON "session_artifacts"("project_id", "session_id");

-- AddForeignKey
ALTER TABLE "session_artifacts" ADD CONSTRAINT "session_artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
