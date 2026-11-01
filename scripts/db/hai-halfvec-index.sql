-- HAI: HNSW index over the halfvec version of hai_embeddings.embedding.
--
-- Why: the column is vector(3072). pgvector builds an HNSW index only up to 2000 dimensions for vector, but up to
-- 4000 for halfvec, so the index is built over the expression embedding::halfvec(3072). Without an index every
-- search reads all rows: 24 to 32 seconds per question on the Preview index of 49,372 rows (measured 01.11.2026).
-- With the index and the switch HAI_HALFVEC_SEARCH=on (src/lib/hai/vectorSearch.ts) the same questions take about
-- 0.1 s for most questions and up to 6 s for the worst one (mean 0.9 s); 74 of 80 results were the same as with
-- the exact search and every search returned its 5 rows.
--
-- Not a migration on purpose: the build takes minutes and blocks nothing with CONCURRENTLY, but it does not belong
-- in the transaction of a migration. Run it once per schema, by the owner of the table, with psql. The code
-- works with and without the index (switch off = exact search as before).
--
--   Preview:     PGOPTIONS="-c search_path=public_preview,extensions,public" psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/hai-halfvec-index.sql
--   Production:  only with the go of the owner, after the rollout:
--                PGOPTIONS="-c search_path=public,extensions" psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/db/hai-halfvec-index.sql
--   Then set HAI_HALFVEC_SEARCH=on in the environment of that deployment.
--
-- Build time on the Preview (49,372 rows, 256 MB, no parallel workers): 877 seconds, index size 375 MB.
-- Parallel workers need shared memory that the hosted database does not have ("No space left on device"), hence 0.
-- A failed build leaves an invalid index: drop it and run the file again.
--
-- Rollback (the search then needs the switch off, otherwise it only gets slower):
--   drop index concurrently if exists idx_hai_embeddings_embedding_hnsw;

set statement_timeout = 0;
set maintenance_work_mem = '256MB';
set max_parallel_maintenance_workers = 0;

create index concurrently if not exists idx_hai_embeddings_embedding_hnsw
  on hai_embeddings
  using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  with (m = 16, ef_construction = 64);
