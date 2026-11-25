-- AlterTable
ALTER TABLE "events" ADD COLUMN     "intent" TEXT;

-- CreateTable
CREATE TABLE "project_states" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "objective" TEXT,
    "stage" TEXT,
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "recent_decisions" JSONB NOT NULL DEFAULT '[]',
    "next_steps" JSONB NOT NULL DEFAULT '[]',
    "risks" JSONB NOT NULL DEFAULT '[]',
    "doc_gaps" JSONB NOT NULL DEFAULT '[]',
    "risk_level" TEXT NOT NULL DEFAULT 'low',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_states_project_id_key" ON "project_states"("project_id");

-- AddForeignKey
ALTER TABLE "project_states" ADD CONSTRAINT "project_states_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
