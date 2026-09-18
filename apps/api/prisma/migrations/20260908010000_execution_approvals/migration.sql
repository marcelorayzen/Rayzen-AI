-- Fase 5-A: aprovacao humana para execucao de risco alto.
-- Escrita a mao. `migrate diff --from-schema-datasource` gera DROP TABLE para tabelas que o
-- schema nao declara (Account, Session, observations, traces...) — ja aconteceu em 06/09.
CREATE TABLE IF NOT EXISTS "execution_approvals" (
  "id"               TEXT NOT NULL,
  "action_key"       TEXT NOT NULL,
  "args_hash"        TEXT NOT NULL,
  "actor"            TEXT NOT NULL,
  "resource"         TEXT,
  "created_by"       TEXT NOT NULL,
  "expires_at"       TIMESTAMP(3) NOT NULL,
  "consumed_at"      TIMESTAMP(3),
  "consumed_by_task" TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "execution_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "execution_approvals_action_key_args_hash_consumed_at_idx"
  ON "execution_approvals"("action_key", "args_hash", "consumed_at");
CREATE INDEX IF NOT EXISTS "execution_approvals_expires_at_idx"
  ON "execution_approvals"("expires_at");
