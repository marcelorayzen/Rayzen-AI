-- H2: trilha durável da fachada Rayzen → Hermes.
-- Esta migração ainda não foi aplicada em ambiente algum por esta alteração.
CREATE TABLE "hub_turns" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "input_text" TEXT NOT NULL,
    "output_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "error_code" TEXT,
    "runtime_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "hub_turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hub_events" (
    "id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hub_turns_thread_id_idempotency_key_key" ON "hub_turns"("thread_id", "idempotency_key");
CREATE INDEX "hub_turns_principal_id_created_at_idx" ON "hub_turns"("principal_id", "created_at" DESC);
CREATE UNIQUE INDEX "hub_events_turn_id_sequence_key" ON "hub_events"("turn_id", "sequence");
CREATE INDEX "hub_events_turn_id_sequence_idx" ON "hub_events"("turn_id", "sequence");

ALTER TABLE "hub_turns" ADD CONSTRAINT "hub_turns_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "hub_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hub_events" ADD CONSTRAINT "hub_events_turn_id_fkey"
  FOREIGN KEY ("turn_id") REFERENCES "hub_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
