-- CreateTable
CREATE TABLE IF NOT EXISTS "project_knowledge_maps" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_knowledge_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_knowledge_maps_project_id_key" ON "project_knowledge_maps"("project_id");

-- AddForeignKey
ALTER TABLE "project_knowledge_maps" ADD CONSTRAINT "project_knowledge_maps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
