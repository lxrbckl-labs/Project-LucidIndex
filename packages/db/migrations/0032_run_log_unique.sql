-- 0032 — UNIQUE (queue_item_id, agent_token_id) on `run_log` (audit round 6).
--
-- Audit round 9 pre-flight: scan for existing duplicates before the
-- ADD CONSTRAINT below tries to back-fill its unique index, so the
-- operator gets a clear, actionable error message instead of a
-- low-level Postgres `could not create unique index "..."` failure.
-- The DO block emits a NOTICE and lets the migration continue to the
-- ALTER TABLE — Postgres will then raise the index-creation error and
-- the transaction rolls back, leaving the schema untouched. The
-- NOTICE precedes that error in the operator's psql output, which
-- gives them the dedup-runbook pointer they need to fix and retry.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT queue_item_id, agent_token_id
    FROM run_log
    GROUP BY queue_item_id, agent_token_id
    HAVING count(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE NOTICE 'Migration 0032 cannot apply — % duplicate (queue_item_id, agent_token_id) pairs in run_log. Run the dedup query in apps/mcp-dashboard/docs/MIGRATIONS.md before retrying.', dup_count;
  END IF;
END $$;


--
-- Background: `write_articles` does a find-or-create on `run_log` keyed on
-- (queue_item_id, agent_token_id). The two-step lookup (SELECT then INSERT)
-- has a race window: two concurrent `write_articles` calls from the same
-- agent on the same queue item can BOTH miss the SELECT and BOTH INSERT,
-- leaving two run_log rows for one logical run. Subsequent
-- `ack_queue_item` would then be ambiguous about which row to promote.
--
-- The fix: a UNIQUE constraint on (queue_item_id, agent_token_id) makes
-- the second INSERT fail loudly. `write_articles` is updated to use
-- `INSERT ... ON CONFLICT DO NOTHING RETURNING id`; when conflict fires
-- it re-SELECTs to pick up the winning insert's id. End state: exactly
-- one row per (queue_item_id, agent_token_id), no matter how many
-- concurrent writers race.
--
-- Existing data: this constraint is being added to a fresh-enough table
-- that no duplicate (queue_item_id, agent_token_id) pairs exist in
-- practice. If a pre-existing duplicate were present the ADD CONSTRAINT
-- would fail — we accept that as a forcing function to investigate any
-- prior corruption, rather than silently dropping rows.
--
-- This is a plain UNIQUE constraint (which creates a backing index), not
-- a separate CREATE INDEX. The constraint name is explicit so the
-- write_articles ON CONFLICT can target it by inferred column tuple
-- (Postgres prefers column-list inference over named-constraint, which
-- keeps the SQL portable if the constraint is later renamed).

ALTER TABLE "run_log"
  ADD CONSTRAINT "run_log_queue_item_agent_unique"
  UNIQUE ("queue_item_id", "agent_token_id");
