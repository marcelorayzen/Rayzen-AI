-- SkillOpt: skills como first-class assets com versionamento e uso rastreado

CREATE TABLE IF NOT EXISTS "v2"."skill_assets" (
  "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
  "skill_id"      TEXT        NOT NULL,
  "name"          TEXT        NOT NULL,
  "description"   TEXT        NOT NULL,
  "category"      TEXT        NOT NULL,
  "risk"          TEXT        NOT NULL DEFAULT 'none',
  "runtime"       TEXT        NOT NULL DEFAULT 'agent-desktop',
  "version"       TEXT        NOT NULL DEFAULT '1.0',
  "input_schema"  JSONB       NOT NULL DEFAULT '{}',
  "output_schema" JSONB       NOT NULL DEFAULT '{}',
  "enabled"       BOOLEAN     NOT NULL DEFAULT true,
  "built_in"      BOOLEAN     NOT NULL DEFAULT false,
  "tags"          TEXT[]      NOT NULL DEFAULT '{}',
  "owner"         TEXT,
  "estimated_ms"  INTEGER,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "skill_assets_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "skill_assets_skill_id_key" UNIQUE ("skill_id")
);

CREATE INDEX IF NOT EXISTS "skill_assets_category_enabled_idx" ON "v2"."skill_assets"("category", "enabled");
CREATE INDEX IF NOT EXISTS "skill_assets_built_in_idx"         ON "v2"."skill_assets"("built_in");

CREATE TABLE IF NOT EXISTS "v2"."skill_usage_logs" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "skill_id"    TEXT        NOT NULL,
  "project_id"  TEXT,
  "mission_id"  TEXT,
  "step_id"     TEXT,
  "success"     BOOLEAN     NOT NULL,
  "duration_ms" INTEGER     NOT NULL,
  "error"       TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "skill_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "skill_usage_logs_skill_id_created_at_idx"   ON "v2"."skill_usage_logs"("skill_id", "created_at");
CREATE INDEX IF NOT EXISTS "skill_usage_logs_project_id_created_at_idx" ON "v2"."skill_usage_logs"("project_id", "created_at");
