-- Item C.3 do plano de execucao tipada (Fase 7, caso 4) -- a auditoria registra quem aprovou
-- uma execucao, nao so que ela aconteceu. `approved_by` fica nulo para toda linha antiga (a
-- identidade nunca existiu ali) e para execucoes que nunca exigiram/consumiram aprovacao.
ALTER TABLE "agent_audit_logs"
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT;
