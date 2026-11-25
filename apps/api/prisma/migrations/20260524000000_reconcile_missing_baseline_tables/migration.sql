-- These models existed in schema.prisma and in the long-lived database, but their
-- original CREATE TABLE statements were never committed. Keep this migration before the
-- historical ALTER statements that already assume project_goals and test_runs exist.

CREATE TABLE IF NOT EXISTS "test_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "tool" TEXT NOT NULL,
    "branch" TEXT,
    "commit_hash" TEXT,
    "total_tests" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "duration_ms" INTEGER,
    "suites" JSONB NOT NULL DEFAULT '[]',
    "failed_cases" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'agent',
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "test_runs_project_id_fkey" FOREIGN KEY ("project_id")
      REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "test_runs_project_id_executed_at_idx"
  ON "test_runs"("project_id", "executed_at" DESC);

CREATE TABLE IF NOT EXISTS "schema_snapshots" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "models" JSONB NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "schema_snapshots_project_id_captured_at_idx"
  ON "schema_snapshots"("project_id", "captured_at" DESC);

CREATE TABLE IF NOT EXISTS "project_goals" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "success_criteria" JSONB NOT NULL DEFAULT '[]',
    "kpis" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "target_date" TIMESTAMP(3),
    "parent_goal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_goals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_goals_project_id_fkey" FOREIGN KEY ("project_id")
      REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_goals_parent_goal_id_fkey" FOREIGN KEY ("parent_goal_id")
      REFERENCES "project_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "project_goals_project_id_status_idx"
  ON "project_goals"("project_id", "status");

-- Baseline before 20260906030000 adds thread_id and replaces this unique index with
-- the composite (telegram_chat_id, thread_id) identity.
CREATE TABLE IF NOT EXISTS "telegram_sessions" (
    "id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_sessions_telegram_chat_id_key"
  ON "telegram_sessions"("telegram_chat_id");

-- Legacy table required by 20260525000002_project_delete_cascades. The data-governance
-- domain was later removed, so only the columns used by that historical migration are
-- reconstructed here. A final cleanup migration guarantees the current state stays removed.
CREATE TABLE IF NOT EXISTS "data_quality_rules" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,

    CONSTRAINT "data_quality_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_quality_rules_project_id_fkey" FOREIGN KEY ("project_id")
      REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
