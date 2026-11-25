-- Policy Engine: regras de governança configuráveis por projeto
-- action: warn (alerta sem bloquear) | block (rejeita a operação) | gate (cria approval gate)
-- projectId NULL = regra de sistema (default global); com valor = override por projeto

CREATE TABLE "v2"."policy_rules" (
  "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
  "project_id"  TEXT,
  "name"        TEXT        NOT NULL,
  "description" TEXT        NOT NULL,
  "enabled"     BOOLEAN     NOT NULL DEFAULT true,
  "action"      TEXT        NOT NULL DEFAULT 'warn',
  "config"      JSONB       NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "policy_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "policy_rules_project_id_enabled_idx" ON "v2"."policy_rules"("project_id", "enabled");
CREATE INDEX "policy_rules_name_idx"               ON "v2"."policy_rules"("name");

-- Regras de sistema (projectId NULL = valem para todos os projetos por padrão)
INSERT INTO "v2"."policy_rules" ("id", "project_id", "name", "description", "enabled", "action", "config") VALUES
  (
    gen_random_uuid(), NULL,
    'memory_requires_source',
    'Nós de conhecimento inferidos pelo LLM sem fonte explícita devem ser sinalizados. Exige origin >= extracted.',
    true, 'warn',
    '{"minOriginWeight": 0.7}'
  ),
  (
    gen_random_uuid(), NULL,
    'low_confidence_knowledge',
    'Bloqueia persistência de nós de conhecimento com trust score abaixo do limiar.',
    true, 'block',
    '{"minConfidence": 0.3}'
  ),
  (
    gen_random_uuid(), NULL,
    'code_requires_adr',
    'Operações de código em projetos V2 devem referenciar uma ADR quando alteram decisões arquiteturais.',
    false, 'warn',
    '{}'
  ),
  (
    gen_random_uuid(), NULL,
    'deployment_requires_review',
    'Deploys em produção exigem aprovação humana via ApprovalGate.',
    true, 'gate',
    '{}'
  );
