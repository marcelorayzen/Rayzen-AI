-- CreateTable
CREATE TABLE v2.strategies (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "system_prompt" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 3,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "context_mode" TEXT,
    "fitness_score" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "parent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "promoted_at" TIMESTAMPTZ(6),
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategies_task_type_status_idx" ON v2.strategies("task_type", "status");

-- CreateIndex
CREATE INDEX "strategies_status_fitness_score_idx" ON v2.strategies("status", "fitness_score");
