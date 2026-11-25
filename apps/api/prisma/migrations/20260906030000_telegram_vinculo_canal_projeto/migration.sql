-- Vínculo canal ↔ projeto para o Telegram (e, depois, WhatsApp pelo mesmo contrato).
--
-- ⚠️ ESTE ARQUIVO FOI ESCRITO À MÃO A PARTIR DE UM `migrate diff` FILTRADO, e o motivo
-- importa: rodar `prisma migrate diff --from-schema-datasource` contra este banco gera
-- uma migração DESTRUTIVA. O schema `public` do `rayzen_ai` contém tabelas que o Prisma
-- não conhece — `Account`, `Session`, `Example` (scaffolding antigo) e `observations`,
-- `scores`, `traces` (sobras de quando o Langfuse dividia o banco, antes de ser isolado
-- no banco `langfuse`). O diff pede `DROP TABLE` em todas elas e derruba FKs.
--
-- Aplicar aquele diff apagaria tabelas no boot, porque o Dockerfile da api roda
-- `npx prisma migrate deploy && node main`. Só as quatro instruções abaixo são a mudança
-- pretendida; o resto do diff é DRIFT do banco, não intenção de ninguém.
--
-- Também ficaram de fora, de propósito, os `ALTER COLUMN ... DROP DEFAULT` e
-- `SET DATA TYPE TIMESTAMP(3)` que o diff sugeriu: são diferenças cosméticas entre o que
-- o Prisma declara e o que o banco tem, sem efeito no comportamento, e mexer em tipo de
-- coluna de tabela viva por estética é risco sem ganho.

-- 1. A chave deixa de ser o chat e passa a ser (chat, tópico).
--
-- `DROP CONSTRAINT`, e não `DROP INDEX`: o `migrate diff` gerou `DROP INDEX`, que FALHOU
-- contra o banco real com "cannot drop index ... because constraint ... requires it". O
-- índice aqui é sustentado por uma UNIQUE CONSTRAINT, criada por uma migração antiga que
-- usou outra convenção. O `DROP INDEX` fica logo abaixo como rede, para o caso de outro
-- ambiente ter o índice solto.
--
-- Descoberto aplicando a migração à mão ANTES de deixá-la subir com o container: o
-- Dockerfile da api roda `npx prisma migrate deploy && node main`, então migração que
-- falha impede o boot. Verificar depois do deploy seria descobrir isso com a produção no
-- chão.
ALTER TABLE "telegram_sessions" DROP CONSTRAINT IF EXISTS "telegram_sessions_telegram_chat_id_key";
DROP INDEX IF EXISTS "telegram_sessions_telegram_chat_id_key";

-- `thread_id` é TEXT NOT NULL DEFAULT '' e não nullable: no Postgres, NULLs são
-- distintos entre si num índice único, então (chat_id, NULL) permitiria linhas
-- duplicadas para o mesmo chat — exatamente o que esta chave existe para impedir.
ALTER TABLE "telegram_sessions" ADD COLUMN IF NOT EXISTS "thread_id" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS "telegram_sessions_telegram_chat_id_thread_id_key"
  ON "telegram_sessions"("telegram_chat_id", "thread_id");

-- 2. Quais chats o bot atende.
--
-- Até agora a autorização era `fromId !== TELEGRAM_CHAT_ID` — um valor único, e a única
-- barreira entre um estranho e o `/orchestrate` inteiro. Aceitar mais de um chat sem
-- substituir isso seria aceitar todos.
CREATE TABLE IF NOT EXISTS "telegram_chats" (
    "chat_id"       TEXT NOT NULL,
    "title"         TEXT,
    "authorized"    BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_chats_pkey" PRIMARY KEY ("chat_id")
);
