-- Backfill de escopo: reatribui wiki_pages e documents órfãos ao projeto correto.
--
-- Motivo: wiki.create() e brain.indexText() não aceitavam projectId, então tudo que
-- passava pelo import de blueprint nascia sem dono — 94 de 110 wikis e 238 documentos.
-- Órfão some de rayzen_get_context e rayzen_search_memory, que filtram por projeto:
-- na prática o conteúdo existia mas era invisível. A origem foi corrigida no código;
-- este script só limpa o passivo.
--
-- Atribuição pelo slug/source_path, que carregam o nome do projeto de origem. O que
-- não casa com nenhuma regra fica com Rayzen AI — é onde o trabalho de plataforma
-- acontece e onde esses itens já eram procurados.
--
-- Uso:
--   psql ... -f backfill-orphan-scope.sql            (aplica dentro de transação)
--   psql ... -v dry=1 -f backfill-orphan-scope.sql   (só mostra o plano)

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE scope_rules (pattern text, project_id text) ON COMMIT DROP;

INSERT INTO scope_rules (pattern, project_id) VALUES
  ('blueprint-vb-ferragens-%',            '9ad98c5a-e255-4945-995e-bbdcf7b9ec1d'),  -- VB Ferragens
  ('blueprint-banco-imobiliario-%',       '16515fe4-1aaa-405f-80e9-692d4cf70a31'),  -- Banco Imobiliário
  ('blueprint-rayzen-commerce-platform%', '5a2bc616-e232-414c-b716-6d530c020812'),  -- Rayzen Commerce Platform
  ('blueprint-rayzen-guardian-%',         '7690370b-aa1e-4b13-8335-a8a14ad0d859'),  -- Rayzen AI
  ('blueprint-rayzen-intent-%',           '7690370b-aa1e-4b13-8335-a8a14ad0d859'),
  ('blueprint-rayzen-blueprint-module%',  '7690370b-aa1e-4b13-8335-a8a14ad0d859');

-- Projeto de fallback para o que não casar
CREATE TEMP TABLE fallback (project_id text) ON COMMIT DROP;
INSERT INTO fallback VALUES ('7690370b-aa1e-4b13-8335-a8a14ad0d859');  -- Rayzen AI

-- ── Plano ────────────────────────────────────────────────────────────────────
\echo '── wiki_pages órfãs, por destino ──'
SELECT COALESCE(p.name, '(fallback → Rayzen AI)') AS destino, count(*) AS paginas
FROM wiki_pages w
LEFT JOIN scope_rules r ON w.slug LIKE r.pattern
LEFT JOIN projects p ON p.id = COALESCE(r.project_id, (SELECT project_id FROM fallback))
WHERE w.project_id IS NULL
GROUP BY 1 ORDER BY 2 DESC;

\echo '── documents órfãos, por destino ──'
SELECT COALESCE(p.name, '(fallback → Rayzen AI)') AS destino, count(*) AS docs
FROM documents d
LEFT JOIN scope_rules r ON d.source_path LIKE 'blueprint/' || replace(r.pattern, 'blueprint-', '')
LEFT JOIN projects p ON p.id = COALESCE(r.project_id, (SELECT project_id FROM fallback))
WHERE d.project_id IS NULL
GROUP BY 1 ORDER BY 2 DESC;

-- ── Aplicação ────────────────────────────────────────────────────────────────
\if :{?dry}
  \echo '(dry-run) nada foi alterado'
  ROLLBACK;
\else

  -- wikis: regra específica primeiro
  UPDATE wiki_pages w
  SET project_id = r.project_id
  FROM scope_rules r
  WHERE w.project_id IS NULL AND w.slug LIKE r.pattern;

  -- wikis restantes: fallback
  UPDATE wiki_pages
  SET project_id = (SELECT project_id FROM fallback)
  WHERE project_id IS NULL;

  -- documents de blueprint: casa pelo trecho do slug dentro do source_path
  UPDATE documents d
  SET project_id = r.project_id
  FROM scope_rules r
  WHERE d.project_id IS NULL
    AND d.source_path LIKE 'blueprint/' || replace(r.pattern, 'blueprint-', '');

  -- documents restantes: fallback
  UPDATE documents
  SET project_id = (SELECT project_id FROM fallback)
  WHERE project_id IS NULL;

  \echo '── resultado ──'
  SELECT 'wikis órfãs restantes' AS t, count(*) FROM wiki_pages WHERE project_id IS NULL
  UNION ALL
  SELECT 'docs órfãos restantes', count(*) FROM documents WHERE project_id IS NULL;

  COMMIT;
\endif
