-- H1 do Rayzen Hub: o fio pertence ao principal + escopo, não ao navegador e
-- não à vida do processo V2. `scope_key` evita a semântica especial de NULL em
-- índices únicos do PostgreSQL: "general" é um escopo real, não ausência.
CREATE TABLE "hub_threads" (
  "id" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL,
  "project_id" TEXT,
  "hermes_session_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "contract_version" TEXT NOT NULL DEFAULT '2026-10-12',
  "retention_policy" TEXT NOT NULL DEFAULT 'default',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hub_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hub_threads_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "hub_threads_principal_id_scope_key_key" ON "hub_threads"("principal_id", "scope_key");
CREATE INDEX "hub_threads_project_id_status_idx" ON "hub_threads"("project_id", "status");
