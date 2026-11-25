-- CreateTable
CREATE TABLE "blueprint_imports" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "mode" TEXT,
    "wiki_pages" TEXT[],
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "next_steps" TEXT[],
    "warnings" TEXT[],
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blueprint_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blueprint_imports_project_id_created_at_idx" ON "blueprint_imports"("project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "blueprint_imports" ADD CONSTRAINT "blueprint_imports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
