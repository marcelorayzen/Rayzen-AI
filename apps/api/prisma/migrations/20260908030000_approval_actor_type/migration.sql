-- Identidade de quem aprovou passa a ser derivada do principal autenticado.
-- DEFAULT para as linhas antigas: elas foram criadas quando `created_by` vinha do corpo, e
-- marca-las como 'desconhecido' e mais honesto que herdar um tipo que nao foi verificado.
ALTER TABLE "execution_approvals"
  ADD COLUMN IF NOT EXISTS "created_by_type" TEXT NOT NULL DEFAULT 'desconhecido';
