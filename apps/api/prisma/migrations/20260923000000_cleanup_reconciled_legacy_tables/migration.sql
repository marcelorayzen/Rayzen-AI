-- The temporary baseline lets the historical cascade migration run on a fresh database.
-- Keep the current schema aligned with 20260805150654_drop_data_governance.
DROP TABLE IF EXISTS "data_quality_rules";
