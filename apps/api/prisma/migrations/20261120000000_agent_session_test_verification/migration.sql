-- Resultado da verificação independente executada antes do portão de publicação da sessão.
ALTER TABLE "agent_sessions"
  ADD COLUMN IF NOT EXISTS "test_verification" JSONB;
