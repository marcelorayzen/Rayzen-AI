-- G6 (21/11/2026): rotinas e o histórico de disparos. Ver docs/decisions/G6-rotinas-desenho.md.
-- IF NOT EXISTS: migração que falha bloqueia o boot da V1.
CREATE TABLE IF NOT EXISTS "rotinas" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "gatilho" JSONB NOT NULL,
  "modelo" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposta',
  "criada_por" TEXT NOT NULL,
  "aprovada_por" TEXT,
  "ultimo_disparo_em" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rotinas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rotinas_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "rotinas_status_idx" ON "rotinas"("status");
CREATE INDEX IF NOT EXISTS "rotinas_project_id_idx" ON "rotinas"("project_id");

CREATE TABLE IF NOT EXISTS "rotina_execucoes" (
  "id" TEXT NOT NULL,
  "rotina_id" TEXT NOT NULL,
  "disparada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "origem" JSONB NOT NULL,
  "chave" TEXT,
  "envelope_id" TEXT,
  "resultado" TEXT NOT NULL,
  "erro" TEXT,

  CONSTRAINT "rotina_execucoes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rotina_execucoes_rotina_id_fkey" FOREIGN KEY ("rotina_id") REFERENCES "rotinas"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "rotina_execucoes_rotina_id_disparada_em_idx" ON "rotina_execucoes"("rotina_id", "disparada_em");
CREATE INDEX IF NOT EXISTS "rotina_execucoes_rotina_id_chave_idx" ON "rotina_execucoes"("rotina_id", "chave");
