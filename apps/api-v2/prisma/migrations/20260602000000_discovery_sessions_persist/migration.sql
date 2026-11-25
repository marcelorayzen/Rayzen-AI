-- Persiste sessões de descoberta (BDE) no banco em vez de memória em-processo.
-- Resolve perda de sessão a cada restart de container.

CREATE TABLE "v2"."discovery_sessions" (
  "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
  "project_name" TEXT,
  "status"       TEXT        NOT NULL DEFAULT 'gathering',
  "messages"     JSONB       NOT NULL DEFAULT '[]',
  "blueprint"    JSONB,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "discovery_sessions_pkey" PRIMARY KEY ("id")
);
