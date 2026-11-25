-- HC1: anexos do chat do Hub. `texto` é o que o modelo vê; o original no volume expira em 30 dias.
CREATE TABLE IF NOT EXISTS "hub_anexos" (
  "id"           TEXT         NOT NULL,
  "principal_id" TEXT         NOT NULL,
  "nome"         TEXT         NOT NULL,
  "mime"         TEXT         NOT NULL,
  "tamanho"      INTEGER      NOT NULL,
  "sha256"       TEXT         NOT NULL,
  "texto"        TEXT         NOT NULL,
  "extraido_por" TEXT         NOT NULL,
  "truncado"     BOOLEAN      NOT NULL DEFAULT false,
  "caminho"      TEXT,
  "expira_em"    TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hub_anexos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hub_anexos_principal_id_sha256_idx" ON "hub_anexos"("principal_id", "sha256");
CREATE INDEX IF NOT EXISTS "hub_anexos_expira_em_idx" ON "hub_anexos"("expira_em");
