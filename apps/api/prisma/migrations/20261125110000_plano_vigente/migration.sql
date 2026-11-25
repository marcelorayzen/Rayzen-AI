ALTER TABLE "project_states"
  ADD COLUMN IF NOT EXISTS "plan_source" JSONB;
