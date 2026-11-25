-- Approval-per-step loop: persist whether a pending question requires formal approval
-- and the approval options offered, so web/Telegram can render the right UI.
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "pending_requires_approval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "agent_sessions" ADD COLUMN IF NOT EXISTS "pending_approval_options" JSONB;
