-- Entrega confirmada de um handoff (item 7.2a): branch, commit e PR medidos no postflight.
-- Aditiva e nulável: envelopes existentes e efeitos sem branch continuam sem entrega.
ALTER TABLE "project_handoffs"
  ADD COLUMN IF NOT EXISTS "delivery" JSONB;
