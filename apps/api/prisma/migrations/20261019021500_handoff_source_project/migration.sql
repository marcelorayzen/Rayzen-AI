-- Preserva o escopo que originou o handoff quando o efeito materializa outro projeto.
ALTER TABLE "project_handoffs"
  ADD COLUMN "source_project_id" TEXT;

CREATE INDEX "project_handoffs_source_project_id_idx"
  ON "project_handoffs"("source_project_id");
