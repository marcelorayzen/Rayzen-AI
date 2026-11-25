CREATE TABLE "hub_work_items" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source_system" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hub_work_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hub_work_items_thread_id_source_system_source_id_key" ON "hub_work_items"("thread_id", "source_system", "source_id");
CREATE INDEX "hub_work_items_thread_id_created_at_idx" ON "hub_work_items"("thread_id", "created_at" DESC);
ALTER TABLE "hub_work_items" ADD CONSTRAINT "hub_work_items_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "hub_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
