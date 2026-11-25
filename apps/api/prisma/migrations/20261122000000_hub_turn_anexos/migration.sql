-- HC2: anexos que entraram em cada turno do Hub, na ordem enviada.
ALTER TABLE "hub_turns" ADD COLUMN IF NOT EXISTS "anexo_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
