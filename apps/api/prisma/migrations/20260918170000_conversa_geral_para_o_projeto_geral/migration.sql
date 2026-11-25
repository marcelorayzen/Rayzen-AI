-- Conversa geral historica ganha o dono que ela sempre teve de fato.
--
-- Ate 18/09 o contexto geral era AUSENCIA (`project_id IS NULL`), e `registro_sem_projeto`
-- precisava de uma lista de canais (`chat`, depois `hub`) para nao contar conversa deliberada como
-- registro orfao. Com o Geral virando um Project de verdade, o registro novo ja nasce com dono --
-- mas o historico continuaria NULL, e o invariante voltaria a acusar justamente o que a decisao de
-- 17/09 chamou de certo.
--
-- O criterio de quem se move e o MESMO que a lista de canais usava, e por isso esta migracao nao
-- inventa classificacao nenhuma: ela aplica ao passado a regra que ja valia para o presente.
UPDATE events
   SET project_id = '00000000-0000-4000-8000-000000000001'
 WHERE project_id IS NULL
   AND source IN ('chat', 'hub');

-- ── O que NAO se move, e o motivo ───────────────────────────────────────────
--
-- `execution` (162), `cli` (25), `brain` (21) e `memory` (17) PERDERAM o dono: vem de hook fora de
-- repositorio registrado, de indexacao sem escopo e do defeito do `enqueue` (corrigido em 17/09).
-- Dar-lhes o Geral seria varrer o passivo para debaixo do tapete e cegar o unico sensor que
-- pergunta "esta acontecendo agora?".
--
-- Em `conversation_messages` so `module = 'hub'` se move. Os outros modulos sem projeto (`graph`
-- 623, `synthesis` 32, `system` 30...) sao TELEMETRIA, nao conversa -- move-los faria o historico
-- do Geral virar o que `getRecentSessions` passa a vida filtrando.
UPDATE conversation_messages
   SET project_id = '00000000-0000-4000-8000-000000000001'
 WHERE project_id IS NULL
   AND module = 'hub';
