ALTER TABLE "hub_turns"
  ADD COLUMN IF NOT EXISTS "context_pack_id" TEXT,
  ADD COLUMN IF NOT EXISTS "context_pack_hash" TEXT;
