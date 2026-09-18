-- Policy Exceptions: exceção formal e auditável a uma violação de PolicyRule,
-- distinta de simplesmente desabilitar a regra inteira (enabled=false).
-- Escopo opcional (ex: missionId/stepId) limita onde a exceção vale; sem
-- escopo, vale para todo o projeto até expirar ou ser revogada.
--
-- ⚠️ Esta migração ficou 53 dias sem aplicar, e o motivo estava no próprio SQL:
-- declarava `id`/`rule_id` como UUID, mas `v2.policy_rules.id` é TEXT — porque a
-- tabela real nasceu de `prisma db push` a partir de `String @id`, não deste
-- diretório. O Postgres recusava a FK ("Key columns are of incompatible types:
-- uuid and text") e a migração falhava toda vez.
--
-- Consequência, medida em 2026-08-21: `policy_engine.service.ts:168` chama
-- `findActiveException()` para CADA regra em toda avaliação. Sem a tabela, o Prisma
-- lançava e `POST /v2/policy/evaluate` devolvia **500** — ou seja, o PolicyEngine
-- inteiro estava morto, incluindo o `block` que protege o Brain de conhecimento com
-- trust baixo.
--
-- Os tipos abaixo agora são os que o `prisma migrate diff` gera a partir do schema,
-- que é a fonte real do banco nesta app. Ver `CLAUDE.local.md` — na V2 o mecanismo
-- é `db push`, e este diretório precisa concordar com ele, não com uma convenção
-- própria.

CREATE TABLE "v2"."policy_exceptions" (
  "id"          TEXT         NOT NULL,
  "rule_id"     TEXT         NOT NULL,
  "project_id"  TEXT         NOT NULL,
  "reason"      TEXT         NOT NULL,
  "granted_by"  TEXT         NOT NULL,
  "scope"       JSONB        NOT NULL DEFAULT '{}',
  "expires_at"  TIMESTAMP(3),
  "revoked_at"  TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "policy_exceptions_rule_id_project_id_idx" ON "v2"."policy_exceptions"("rule_id", "project_id");

ALTER TABLE "v2"."policy_exceptions"
  ADD CONSTRAINT "policy_exceptions_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "v2"."policy_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Política Synthesizer: Synthesizer não deve sintetizar um documento sem
-- fontes/outputs prévios para sintetizar — risco de alucinação. action=warn
-- (rollout conservador, consistente com memory_requires_source).
-- `updated_at` vai explicito: e NOT NULL sem default no banco, porque o Prisma o
-- gerencia via `@updatedAt` na aplicacao. Sem isto o INSERT falha.
INSERT INTO "v2"."policy_rules" ("id", "project_id", "name", "description", "enabled", "action", "config", "updated_at") VALUES
  (
    gen_random_uuid()::text, NULL,
    'synthesizer_requires_sources',
    'Specialist do tipo synthesizer não deve rodar sem outputs/contexto prévio para sintetizar — risco de alucinação de documento sem fonte.',
    true, 'warn',
    '{}', now()
  );
