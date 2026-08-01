-- Reversão de 20260801150000_governance_policy — ver
-- src/governance-policy/__tests__/governance-policy-migration.spec.ts, que
-- confirma que este script reverte exatamente o que migration.sql criou.
-- Não roda automaticamente (Prisma não tem down-migration nativa) — script
-- manual, aplicar via psql/prisma db execute se precisar reverter.
DROP TABLE IF EXISTS "governance_policies";
