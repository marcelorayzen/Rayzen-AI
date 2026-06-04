-- Ciclo 2 Peça 3: Project Catalog
CREATE TABLE IF NOT EXISTS v2.project_catalog (
  id            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  v1_project_id TEXT        NOT NULL,
  owner         TEXT,
  provenance    TEXT        NOT NULL DEFAULT 'manual',
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  health_score  FLOAT,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT project_catalog_pkey PRIMARY KEY (id),
  CONSTRAINT project_catalog_v1_project_id_key UNIQUE (v1_project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_catalog_provenance ON v2.project_catalog (provenance);
CREATE INDEX IF NOT EXISTS idx_project_catalog_owner      ON v2.project_catalog (owner);
