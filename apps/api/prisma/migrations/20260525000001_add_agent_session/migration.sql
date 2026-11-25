CREATE TABLE "agent_sessions" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "claude_prompt" TEXT NOT NULL,
  "pending_question" TEXT,
  "pending_reply" TEXT,
  "preview_url" TEXT,
  "summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_sessions_project_id_status_idx" ON "agent_sessions"("project_id", "status");

ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
