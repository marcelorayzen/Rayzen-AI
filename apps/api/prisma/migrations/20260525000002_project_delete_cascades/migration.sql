-- Fix project deletion: add ON DELETE CASCADE for required FK, ON DELETE SET NULL for optional FK

-- project_documents → CASCADE
ALTER TABLE "project_documents" DROP CONSTRAINT IF EXISTS "project_documents_project_id_fkey";
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- project_recommendations → CASCADE
ALTER TABLE "project_recommendations" DROP CONSTRAINT IF EXISTS "project_recommendations_project_id_fkey";
ALTER TABLE "project_recommendations" ADD CONSTRAINT "project_recommendations_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- project_states → CASCADE
ALTER TABLE "project_states" DROP CONSTRAINT IF EXISTS "project_states_project_id_fkey";
ALTER TABLE "project_states" ADD CONSTRAINT "project_states_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- project_health_scores → CASCADE
ALTER TABLE "project_health_scores" DROP CONSTRAINT IF EXISTS "project_health_scores_project_id_fkey";
ALTER TABLE "project_health_scores" ADD CONSTRAINT "project_health_scores_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- agent_sessions → CASCADE
ALTER TABLE "agent_sessions" DROP CONSTRAINT IF EXISTS "agent_sessions_project_id_fkey";
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- session_artifacts → SET NULL
ALTER TABLE "session_artifacts" DROP CONSTRAINT IF EXISTS "session_artifacts_project_id_fkey";
ALTER TABLE "session_artifacts" ADD CONSTRAINT "session_artifacts_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- events → SET NULL
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_project_id_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- documents → SET NULL
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_project_id_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- test_runs → SET NULL
ALTER TABLE "test_runs" DROP CONSTRAINT IF EXISTS "test_runs_project_id_fkey";
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- data_quality_rules → SET NULL
ALTER TABLE "data_quality_rules" DROP CONSTRAINT IF EXISTS "data_quality_rules_project_id_fkey";
ALTER TABLE "data_quality_rules" ADD CONSTRAINT "data_quality_rules_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- conversation_messages → SET NULL
ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "conversation_messages_project_id_fkey";
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
