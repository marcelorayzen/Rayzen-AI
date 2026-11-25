-- "Não publicar" no portão do diff, registrado pela API na hora da resposta. O postflight do
-- envelope usa isto para fechar sem incerteza quando nada foi publicado por decisão de uma pessoa.
ALTER TABLE "agent_sessions"
  ADD COLUMN IF NOT EXISTS "publicacao_recusada_em" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publicacao_recusada_por" TEXT;
