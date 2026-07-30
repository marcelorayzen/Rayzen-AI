-- AlterTable
ALTER TABLE "catalog_recommendations" ADD COLUMN "dedupe_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "catalog_recommendations_dedupe_key_key" ON "catalog_recommendations"("dedupe_key");
