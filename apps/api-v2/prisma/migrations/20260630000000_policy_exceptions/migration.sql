-- Policy Exceptions: exceção formal e auditável a uma violação de PolicyRule,
-- distinta de simplesmente desabilitar a regra inteira (enabled=false).
-- Escopo opcional (ex: missionId/stepId) limita onde a exceção vale; sem
-- escopo, vale para todo o projeto até expirar ou ser revogada.

CREATE TABLE "v2"."policy_exceptions" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "rule_id"     UUID        NOT NULL,
  "project_id"  TEXT        NOT NULL,
  "reason"      TEXT        NOT NULL,
  "granted_by"  TEXT        NOT NULL,
  "scope"       JSONB       NOT NULL DEFAULT '{}',
  "expires_at"  TIMESTAMPTZ,
  "revoked_at"  TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "policy_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_exceptions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "v2"."policy_rules"("id") ON DELETE CASCADE
);

CREATE INDEX "policy_exceptions_rule_id_project_id_idx" ON "v2"."policy_exceptions"("rule_id", "project_id");

-- Política Synthesizer: Synthesizer não deve sintetizar um documento sem
-- fontes/outputs prévios para sintetizar — risco de alucinação. action=warn
-- (rollout conservador, consistente com memory_requires_source).
INSERT INTO "v2"."policy_rules" ("id", "project_id", "name", "description", "enabled", "action", "config") VALUES
  (
    gen_random_uuid(), NULL,
    'synthesizer_requires_sources',
    'Specialist do tipo synthesizer não deve rodar sem outputs/contexto prévio para sintetizar — risco de alucinação de documento sem fonte.',
    true, 'warn',
    '{}'
  );
