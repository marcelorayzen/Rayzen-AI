-- Make mission_id and step_id optional on approval_gates
-- Allows policy-engine-triggered gates without mission context

ALTER TABLE v2.approval_gates
  ALTER COLUMN mission_id DROP NOT NULL,
  ALTER COLUMN step_id    DROP NOT NULL;
