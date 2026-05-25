-- AddColumn: last_gap_analysis to project_goals
ALTER TABLE "project_goals" ADD COLUMN "last_gap_analysis" JSONB;
