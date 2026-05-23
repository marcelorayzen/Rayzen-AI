CREATE TABLE "agent_audit_logs" (
    "id"          TEXT NOT NULL,
    "task_id"     TEXT NOT NULL,
    "actor"       TEXT NOT NULL DEFAULT 'admin',
    "module"      TEXT NOT NULL,
    "action"      TEXT NOT NULL,
    "command"     TEXT,
    "risk"        TEXT,
    "dry_run"     BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER,
    "status"      TEXT NOT NULL,
    "result"      JSONB,
    "error"       TEXT,
    "workspace"   TEXT,
    "hostname"    TEXT,
    "target_role" TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_audit_logs_task_id_idx" ON "agent_audit_logs"("task_id");
CREATE INDEX "agent_audit_logs_created_at_idx" ON "agent_audit_logs"("created_at" DESC);
CREATE INDEX "agent_audit_logs_action_status_idx" ON "agent_audit_logs"("action", "status");
