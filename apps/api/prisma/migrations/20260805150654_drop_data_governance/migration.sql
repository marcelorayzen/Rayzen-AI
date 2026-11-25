-- Remove o domínio de governança de dados do Rayzen pessoal.
--
-- Ele pertence ao catalog-guardian (produto de consultoria), extraído para repo
-- próprio em 2026-08-05. Dentro do Rayzen, o conceito nunca recebeu dado de verdade:
-- data_quality_rules, data_quality_results e data_lineage_edges sempre estiveram
-- vazias, e data_assets acumulou 477 linhas que eram apenas o rastro de arquivos
-- editados pelo Claude Code (100% type='file'), não datasets.
--
-- Backup em ~/backups/data-governance-20260805-145846.sql no servidor.

-- DropForeignKey / DropTable — ordem respeita as FKs (edges → assets, results → rules)
DROP TABLE IF EXISTS "data_lineage_edges";
DROP TABLE IF EXISTS "data_quality_results";
DROP TABLE IF EXISTS "data_assets";
DROP TABLE IF EXISTS "data_quality_rules";
