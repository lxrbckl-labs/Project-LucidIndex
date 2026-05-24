-- 0034 — Add 'in_progress' to run_log.status and make completed_at nullable
-- (audit round 8 / `started_at` true pull-time semantics).
--
-- Background: before this migration, `write_articles` was the first writer
-- that created the run_log row, with `started_at = now()` at first-write
-- time. That was already an improvement over `q.enqueuedAt` (the 8-day
-- bug) but it still left a 30–45 s gap between PULL time and the first
-- `write_articles` call — agents that researched for minutes before
-- writing reported `started_at` minutes off from when they actually
-- claimed the row.
--
-- The fix: `pull_queue_item` creates the run_log row at CLAIM time with
-- `status = 'in_progress'` and `completed_at = NULL`. `write_articles`
-- updates `articles_count`; `ack_queue_item` flips the terminal status to
-- 'succeeded' / 'failed' and stamps `completed_at`.
--
-- Two schema changes are required:
--
--   1. The CHECK constraint must accept `'in_progress'` so the pull-time
--      insert is legal. We DROP the existing constraint and re-add it with
--      the widened set; Postgres has no `ALTER CHECK` so a drop/add is the
--      canonical path.
--
--   2. `completed_at` must be nullable — there IS no completion timestamp
--      for a row that's still in flight. We drop the NOT NULL; existing
--      terminal rows already carry a value and stay unaffected. The
--      `ack_queue_item` UPDATE will populate it on transition out of
--      'in_progress'.
--
-- Downstream queries (`system-stats.ts` MAX(...) FILTER (WHERE status =
-- 'succeeded')) naturally exclude `in_progress` rows by virtue of the
-- WHERE filter — no query updates needed.
--
-- Read paths that surface `completed_at` to consumers (`list_my_recent_runs`)
-- coalesce null → null in the response shape; agents seeing `completed_at:
-- null` know the run is still active (status will read 'in_progress' on
-- that same row).

ALTER TABLE "run_log" DROP CONSTRAINT "run_log_status_check";

ALTER TABLE "run_log"
  ADD CONSTRAINT "run_log_status_check"
  CHECK ("run_log"."status" in ('in_progress', 'succeeded', 'failed'));

ALTER TABLE "run_log" ALTER COLUMN "completed_at" DROP NOT NULL;
