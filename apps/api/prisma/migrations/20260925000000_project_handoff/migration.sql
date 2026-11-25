-- Fase 4 — o envelope duravel que liga brief, versao, autorizacao e efeitos.
--
-- O broker da Fase 1 ja entrega intencao idempotente com lease e fencing, e o
-- `ExecutionApproval` ja interpoe uma pessoa com alvo canonicalizado e consumo unico. O que
-- nenhum dos dois guarda e O QUE FOI APROVADO: a aprovacao vive minutos e morre ao ser
-- consumida, e a tarefa carrega payload sem procedencia.
--
-- Quando alguem perguntar daqui a um mes "por que esta pasta existe e quem autorizou", a
-- resposta precisa estar num registro que nao expirou junto com a autorizacao. E a mesma
-- separacao que a Fase 3 fez no ContextPack: autorizacao expira, evidencia nao.
CREATE TABLE IF NOT EXISTS project_handoffs (
  id               TEXT NOT NULL,
  project_id       TEXT,
  name             TEXT NOT NULL,
  brief            TEXT NOT NULL,
  template         TEXT NOT NULL,
  root             TEXT NOT NULL,
  effects          JSONB NOT NULL,
  content_hash     TEXT NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'draft',
  created_by       TEXT NOT NULL,
  approval_id      TEXT,
  approved_by      TEXT,
  approved_at      TIMESTAMP(3),
  task_id          TEXT,
  idempotency_key  TEXT,
  motivo           TEXT,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL,
  CONSTRAINT project_handoffs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS project_handoffs_status_created_at_idx
  ON project_handoffs(status, created_at);
CREATE INDEX IF NOT EXISTS project_handoffs_project_id_idx
  ON project_handoffs(project_id);

CREATE INDEX IF NOT EXISTS project_handoffs_task_id_idx
  ON project_handoffs(task_id);
