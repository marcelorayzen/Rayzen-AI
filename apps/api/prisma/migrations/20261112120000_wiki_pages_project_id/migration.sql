-- WikiPage.projectId existe no schema desde b407da2 (24/06) e nunca teve migração: o Prisma
-- seleciona todas as colunas do modelo, então toda leitura/escrita de wiki_pages devolvia 500
-- (P2022 "column wiki_pages.project_id does not exist"). Medido em 12/11 com
-- `prisma migrate diff` contra produção: esta é a ÚNICA divergência que quebra consulta.
--
-- Só aditiva, de propósito. O diff também propõe DROP de "wiki_pages_slug_key" e de
-- "telegram_sessions_telegram_chat_id_key" (índices que existem no banco e o schema não
-- declara) e ajustes de DEFAULT/tipo — nada disso entra aqui: remover unicidade não é
-- consequência de adicionar uma coluna.
ALTER TABLE "wiki_pages" ADD COLUMN IF NOT EXISTS "project_id" TEXT;

CREATE INDEX IF NOT EXISTS "wiki_pages_project_id_slug_idx" ON "wiki_pages"("project_id", "slug");
