-- O SOUL promete "respeito a separacao entre vida pessoal, projetos e clientes".
--
-- Ate aqui isso era so uma regra de atribuicao no prompt (AVISO_SEM_ESCOPO), sem nada no dado que
-- a sustentasse: `Project` nao tinha campo de dominio, e o `project_catalog` da V2 tem `tags` --
-- preenchidas em 1 de 10 projetos, e num schema que a V1 nao alcanca.
--
-- Nulo = NAO CLASSIFICADO, e isso e diferente de "sem dominio": a classificacao e curadoria
-- humana, e chutar dominio a partir do nome seria inventar exatamente o fato que a separacao
-- existe para proteger.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS domain TEXT;
