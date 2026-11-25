-- HC4b: propostas de guardar anexo ou remover documento da memória, aprovadas por uma pessoa no fio.
CREATE TABLE IF NOT EXISTS "propostas_de_memoria" (
  "id"           TEXT         NOT NULL,
  "acao"         TEXT         NOT NULL,
  "project_id"   TEXT         NOT NULL,
  "anexo_id"     TEXT,
  "source_path"  TEXT,
  "titulo"       TEXT         NOT NULL,
  "status"       TEXT         NOT NULL DEFAULT 'proposta',
  "criada_por"   TEXT         NOT NULL,
  "decidida_por" TEXT,
  "decidida_em"  TIMESTAMP(3),
  "resultado"    JSONB,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "propostas_de_memoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "propostas_de_memoria_status_project_id_idx" ON "propostas_de_memoria"("status", "project_id");
