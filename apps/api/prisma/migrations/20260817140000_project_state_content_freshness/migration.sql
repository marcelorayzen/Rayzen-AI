-- Idade do CONTEÚDO, separada da marca d'água do refresh incremental.
--
-- `updated_at` faz dois trabalhos que se contradizem: é a marca d'água que o refresh
-- usa para não reprocessar evento (`ts > updated_at`, precisa avançar sempre) e era
-- também o sinal de idade injetado no contexto (deveria avançar só quando o conteúdo
-- muda). Como @updatedAt avança em toda escrita, a marca d'água ganhava.
--
-- Medido no Rayzen Commerce Platform: o objetivo gravado em 24/06 era servido em 17/08
-- com contador zerado, porque o refresh das 04:07 escreveu sem mudar o texto.
ALTER TABLE "project_states" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "project_states" ADD COLUMN "content_changed_at" TIMESTAMP(3);
