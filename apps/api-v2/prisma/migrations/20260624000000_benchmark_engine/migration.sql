-- CreateTable
CREATE TABLE v2.benchmark_cases (
    "id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'trace',
    "project_id" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE v2.benchmark_results (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "fitness" DOUBLE PRECISION NOT NULL,
    "output" TEXT NOT NULL,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "benchmark_cases_task_type_approved_idx" ON v2.benchmark_cases("task_type", "approved");

-- CreateIndex
CREATE INDEX "benchmark_cases_project_id_task_type_idx" ON v2.benchmark_cases("project_id", "task_type");

-- CreateIndex
CREATE INDEX "benchmark_results_strategy_id_evaluated_at_idx" ON v2.benchmark_results("strategy_id", "evaluated_at");

-- CreateIndex
CREATE INDEX "benchmark_results_case_id_idx" ON v2.benchmark_results("case_id");

-- AddForeignKey
ALTER TABLE v2.benchmark_results ADD CONSTRAINT "benchmark_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES v2.benchmark_cases("id") ON DELETE CASCADE ON UPDATE CASCADE;
