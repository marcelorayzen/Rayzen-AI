ALTER TABLE "project_states"
ADD COLUMN "graph_links" JSONB NOT NULL DEFAULT '[]';
