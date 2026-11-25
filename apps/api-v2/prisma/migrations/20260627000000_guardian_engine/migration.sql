-- CreateTable
CREATE TABLE v2.guardian_reports (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repo_path" TEXT NOT NULL,
    "changed_files" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "impacted_routes" JSONB NOT NULL DEFAULT '[]',
    "impacted_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "files_without_tests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "suggested_tests" JSONB NOT NULL DEFAULT '[]',
    "risk_score" DOUBLE PRECISION NOT NULL,
    "risk_level" TEXT NOT NULL,
    "deploy_recommend" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guardian_reports_project_id_idx" ON v2.guardian_reports("project_id");

-- CreateIndex
CREATE INDEX "guardian_reports_created_at_idx" ON v2.guardian_reports("created_at");
