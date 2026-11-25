-- CreateTable
CREATE TABLE "project_recommendations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "action" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_recommendations_project_id_dismissed_at_idx" ON "project_recommendations"("project_id", "dismissed_at");

-- AddForeignKey
ALTER TABLE "project_recommendations" ADD CONSTRAINT "project_recommendations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
