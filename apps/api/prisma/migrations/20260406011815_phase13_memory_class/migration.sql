-- AlterTable
ALTER TABLE "events" ADD COLUMN     "memory_class" TEXT NOT NULL DEFAULT 'inbox';

-- CreateIndex
CREATE INDEX "events_project_id_memory_class_idx" ON "events"("project_id", "memory_class");
