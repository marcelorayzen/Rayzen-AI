-- O contexto geral deixa de ser ausencia (`project_id IS NULL`) e passa a ser um lugar.
--
-- `status = 'geral'` e nao 'active' de proposito: SmartCheckpointService e o sync do catalogo
-- varrem `status: 'active'`. Ativo, este projeto ganharia checkpoint por LLM a cada 10 minutos
-- (sintetizando um "objetivo" a partir de conversa solta) e 19 invariantes a cada 30. Fora dos
-- dois, continua aparecendo em `GET /projects`, que nao filtra por status.
--
-- `ON CONFLICT DO NOTHING` porque migracao que falha bloqueia o boot da V1 (`migrate deploy` roda
-- na subida), e um ambiente que ja tenha a linha nao pode derrubar a api por isso.
INSERT INTO projects (id, name, description, status, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Geral',
  'Contexto geral: conversa que nao esta presa a um projeto. Deliberado desde 17/09 -- o HUB abre assim, sem pedir escopo. Registro mora aqui; a BUSCA continua varrendo o acervo inteiro (ver common/escopo-geral.const.ts).',
  'geral',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;
