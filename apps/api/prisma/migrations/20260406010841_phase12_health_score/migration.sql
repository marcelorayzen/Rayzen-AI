-- CreateTable
CREATE TABLE "project_health_scores" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_health_scores_project_id_created_at_idx" ON "project_health_scores"("project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "project_health_scores" ADD CONSTRAINT "project_health_scores_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
