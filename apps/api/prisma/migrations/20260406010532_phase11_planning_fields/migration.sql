-- AlterTable
ALTER TABLE "project_states" ADD COLUMN     "active_focus" TEXT,
ADD COLUMN     "backlog" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "definition_of_done" TEXT,
ADD COLUMN     "milestones" JSONB NOT NULL DEFAULT '[]';
