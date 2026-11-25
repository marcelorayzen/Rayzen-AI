-- "Filesystem, catalogo e Git reconciliados antes de abrir o VS Code" — a previa que sustenta
-- essa frase precisa ficar gravada.
--
-- Ela responde o que se sabia NO MOMENTO da decisao: a pasta ja existia? o projeto ja estava
-- registrado, e com qual checkout? havera commit inicial? Nada disso se reconstroi depois,
-- porque o disco muda — e um envelope que executou sobre um estado e diferente de um que
-- executou sobre outro.
ALTER TABLE project_handoffs ADD COLUMN IF NOT EXISTS preflight JSONB;
